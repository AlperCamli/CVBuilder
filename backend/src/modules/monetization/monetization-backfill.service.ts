import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { AppError } from "../../shared/errors/app-error";
import type { BillingService } from "../billing/billing.service";
import type { StripeGateway } from "../billing/stripe-gateway";
import type { MonetizationRefreshResult, MonetizationRefreshService } from "./monetization-refresh.service";

// One-off import of pre-tracking history: descriptive subscription columns, past invoices,
// catalogs and monthly FX. Work already done is skipped, so a run cut short by the time
// budget continues where it stopped when called again. Status and plan are never changed.

export interface MonetizationBackfillResult {
  complete: boolean;
  dry_run: boolean;
  customers: number;
  subscriptions: number;
  locked_subscriptions: number;
  invoices: number;
  skipped_invoices: number;
  missing_customers: number;
  fx_from: string | null;
  refresh: MonetizationRefreshResult | null;
}

interface SubscriptionRow {
  id: string;
  provider_customer_id: string;
  provider_subscription_id: string | null;
  billing_interval: string | null;
  created_at: string;
}

const PAGE = 1000;

export class MonetizationBackfillService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly gateway: StripeGateway,
    private readonly billingService: Pick<BillingService, "syncInvoice">,
    private readonly refreshService: MonetizationRefreshService,
    private readonly logger: Logger
  ) {}

  // Production hides 500 details, so the failing step and item are logged here.
  async run(options: { dryRun?: boolean; budgetMs?: number } = {}): Promise<MonetizationBackfillResult> {
    const at: { step: string; item: string | null } = { step: "read_subscriptions", item: null };
    try {
      return await this.execute(options, at);
    } catch (error) {
      const details = error instanceof AppError ? error.details : undefined;
      this.logger.error({ ...at, reason: error instanceof Error ? error.message : "unknown", details }, "monetization_backfill_failed");
      throw error;
    }
  }

  private async execute(options: { dryRun?: boolean; budgetMs?: number }, at: { step: string; item: string | null }): Promise<MonetizationBackfillResult> {
    const dryRun = options.dryRun ?? false;
    const deadline = Date.now() + (options.budgetMs ?? Number.POSITIVE_INFINITY);
    const outOfTime = () => Date.now() > deadline;

    const rows = (await this.readAll<SubscriptionRow>("subscriptions", "id,provider_customer_id,provider_subscription_id,billing_interval,created_at"))
      .filter(row => row.provider_customer_id);
    const customers = [...new Set(rows.map(row => row.provider_customer_id))];
    const result: MonetizationBackfillResult = {
      complete: false, dry_run: dryRun, customers: customers.length, subscriptions: 0, locked_subscriptions: 0,
      invoices: 0, skipped_invoices: 0, missing_customers: 0, fx_from: null, refresh: null
    };

    // 1. Descriptive subscription columns, for rows not filled yet.
    at.step = "subscriptions";
    for (const row of rows) {
      const id = row.provider_subscription_id;
      if (!id || id.startsWith("lifetime_") || row.billing_interval) continue;
      if (outOfTime()) return this.finish(result);
      at.item = row.id;
      const details = (await this.gateway.retrieveSubscription(id).catch(() => null))?.details;
      if (!details) continue;
      if (!dryRun) {
        const update = await this.db.from("subscriptions").update(details).eq("id", row.id);
        // Accounts being erased or restricted reject writes; leave them to the erasure archive.
        if (update.error?.message.includes("privacy_subject_unavailable")) { result.locked_subscriptions++; continue; }
        if (update.error) throw new Error(update.error.message);
      }
      result.subscriptions++;
    }

    // 2. Every invoice of every known customer not imported yet, through the webhook path.
    if (this.gateway.listInvoiceIds) {
      at.step = "invoices"; at.item = null;
      const imported = new Set((await this.readAll<{ provider_invoice_id: string }>("billing_invoices", "provider_invoice_id")).map(row => row.provider_invoice_id));
      for (const customer of customers) {
        if (outOfTime()) return this.finish(result);
        at.item = customer;
        // Customers deleted in Stripe (or created in another mode) have nothing to import.
        const invoiceIds = await this.gateway.listInvoiceIds(customer);
        if (!invoiceIds) { result.missing_customers++; continue; }
        for (const invoiceId of invoiceIds) {
          if (imported.has(invoiceId)) continue;
          at.item = invoiceId;
          if (dryRun || await this.billingService.syncInvoice(invoiceId)) result.invoices++; else result.skipped_invoices++;
        }
      }
    }

    // 3. Catalogs, internal accounts, and monthly FX back to the first subscription.
    at.step = "refresh"; at.item = null;
    const first = rows.reduce((min, row) => (row.created_at < min ? row.created_at : min), new Date().toISOString());
    result.fx_from = first.slice(0, 7);
    if (!dryRun) {
      const months: Date[] = [];
      for (let month = new Date(`${result.fx_from}-01T00:00:00Z`); month <= new Date(); month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))) months.push(month);
      result.refresh = { ...(await this.refreshService.refresh()), fx_months: await this.refreshService.refreshFxMonths(months) };
    }
    result.complete = true;
    return this.finish(result);
  }

  private finish(result: MonetizationBackfillResult): MonetizationBackfillResult {
    this.logger.info({ backfill: result }, result.complete ? "monetization_backfill_complete" : "monetization_backfill_partial");
    return result;
  }

  private async readAll<T>(table: string, columns: string): Promise<T[]> {
    const all: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db.from(table).select(columns).order("id").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all.push(...(data as unknown as T[]));
      if (data.length < PAGE) return all;
    }
  }
}
