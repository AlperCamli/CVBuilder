import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { InternalServerError } from "../../shared/errors/app-error";

// Records billing facts for analysis. Nothing here is read back to make access decisions,
// so request-path writes are best-effort and never fail the user's request.

export type CheckoutOutcome = "open" | "completed" | "expired" | "canceled" | "rejected_pending" | "rejected_active" | "rejected_pricing_changed" | "failed";
export type DenialReason = "no_subscription" | "subscription_inactive" | "trial_expired" | "free_limit";

export interface InvoiceRow {
  user_id: string;
  subscription_id: string | null;
  provider_invoice_id: string;
  provider_subscription_id: string | null;
  status: string;
  currency: string;
  amount_subtotal: number;
  amount_discount: number;
  amount_tax: number;
  amount_total: number;
  amount_paid: number;
  amount_refunded: number;
  billing_reason: string | null;
  plan_code: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface CheckoutAttemptRow {
  user_id: string;
  plan_code: string;
  market: string | null;
  currency: string | null;
  amount: number | null;
  trial_requested: boolean;
  trial_applied: boolean;
  checkout_session_id: string | null;
  outcome: CheckoutOutcome;
}

export interface EntitlementDenial {
  user_id: string;
  plan_code: string;
  action: string;
  surface?: string | null;
  reason: DenialReason;
}

export interface PriceCatalogRow {
  provider_price_id: string;
  plan_code: string;
  market: string | null;
  currency: string | null;
  unit_amount: number | null;
  billing_interval: string | null;
  interval_count: number | null;
  product_id: string | null;
  stripe_active: boolean | null;
  is_configured: boolean;
}

export interface PlanCatalogRow {
  plan_code: string;
  name: string;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  checkout_allowed: boolean;
  trial_supported: boolean;
  trial_days: number;
  legacy: boolean;
}

export interface FxRateRow {
  rate_month: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  sample_days: number;
  source: string;
  is_final: boolean;
}

export interface MonetizationRepository {
  // Throws so a failed webhook is retried by Stripe; the upsert is idempotent.
  upsertInvoice(row: InvoiceRow): Promise<void>;
  recordCheckoutAttempt(row: CheckoutAttemptRow): Promise<void>;
  resolveCheckoutAttempt(checkoutSessionId: string, outcome: CheckoutOutcome): Promise<void>;
  recordEntitlementDenial(denial: EntitlementDenial): Promise<void>;
  recordUserActivity(userId: string): Promise<void>;
  upsertPriceCatalog(rows: PriceCatalogRow[]): Promise<void>;
  upsertPlanCatalog(rows: PlanCatalogRow[]): Promise<void>;
  upsertFxRates(rows: FxRateRow[]): Promise<void>;
  markInternalUsers(emails: string[]): Promise<number>;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

export class SupabaseMonetizationRepository implements MonetizationRepository {
  // Activity is stored once per user per day; skip repeat writes from this instance.
  private activityDay = utcDay();
  private readonly activitySeen = new Set<string>();

  constructor(private readonly db: SupabaseClient, private readonly logger: Pick<Logger, "warn">) {}

  async upsertInvoice(row: InvoiceRow): Promise<void> {
    const { error } = await this.db.from("billing_invoices")
      .upsert({ ...row, synced_at: new Date().toISOString() }, { onConflict: "provider_invoice_id" });
    if (error) throw new InternalServerError("Failed to record invoice", { reason: error.message });
  }

  async recordCheckoutAttempt(row: CheckoutAttemptRow): Promise<void> {
    // A retried Checkout reuses the same Stripe session; keep the first attempt row.
    await this.quietly("CHECKOUT_ATTEMPT_NOT_RECORDED", () => row.checkout_session_id
      ? this.db.from("checkout_attempts").upsert(row, { onConflict: "checkout_session_id", ignoreDuplicates: true })
      : this.db.from("checkout_attempts").insert({ ...row, resolved_at: new Date().toISOString() }));
  }

  async resolveCheckoutAttempt(checkoutSessionId: string, outcome: CheckoutOutcome): Promise<void> {
    await this.quietly("CHECKOUT_ATTEMPT_NOT_RESOLVED", () => this.db.from("checkout_attempts")
      .update({ outcome, resolved_at: new Date().toISOString() })
      .eq("checkout_session_id", checkoutSessionId)
      .eq("outcome", "open"));
  }

  async recordEntitlementDenial(denial: EntitlementDenial): Promise<void> {
    await this.quietly("ENTITLEMENT_DENIAL_NOT_RECORDED", () => this.db.rpc("record_entitlement_denial", {
      p_user: denial.user_id, p_plan: denial.plan_code, p_action: denial.action, p_surface: denial.surface ?? null, p_reason: denial.reason
    }));
  }

  async recordUserActivity(userId: string): Promise<void> {
    const day = utcDay();
    if (day !== this.activityDay) { this.activityDay = day; this.activitySeen.clear(); }
    if (this.activitySeen.has(userId)) return;
    this.activitySeen.add(userId);
    await this.quietly("USER_ACTIVITY_NOT_RECORDED", () => this.db.rpc("record_user_activity", { p_user: userId }));
  }

  async upsertPriceCatalog(rows: PriceCatalogRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db.from("billing_price_catalog")
      .upsert(rows.map(row => ({ ...row, refreshed_at: new Date().toISOString() })), { onConflict: "provider_price_id" });
    if (error) throw new InternalServerError("Failed to refresh price catalog", { reason: error.message });
  }

  async upsertPlanCatalog(rows: PlanCatalogRow[]): Promise<void> {
    const { error } = await this.db.from("billing_plan_catalog")
      .upsert(rows.map(row => ({ ...row, refreshed_at: new Date().toISOString() })), { onConflict: "plan_code" });
    if (error) throw new InternalServerError("Failed to refresh plan catalog", { reason: error.message });
  }

  async upsertFxRates(rows: FxRateRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db.from("fx_rates")
      .upsert(rows.map(row => ({ ...row, updated_at: new Date().toISOString() })), { onConflict: "rate_month,base_currency,quote_currency" });
    if (error) throw new InternalServerError("Failed to refresh FX rates", { reason: error.message });
  }

  // Only ever adds the flag (case-insensitive match); returns the number of accounts newly marked.
  async markInternalUsers(emails: string[]): Promise<number> {
    if (!emails.length) return 0;
    const { data, error } = await this.db.rpc("mark_internal_users", { p_emails: emails });
    if (error) throw new InternalServerError("Failed to mark internal accounts", { reason: error.message });
    return typeof data === "number" ? data : 0;
  }

  private async quietly(code: string, write: () => PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    try {
      const { error } = await write();
      if (error) this.logger.warn({ code, reason: error.message }, "Monetization tracking write failed");
    } catch (error) {
      this.logger.warn({ code, reason: error instanceof Error ? error.message : "unknown" }, "Monetization tracking write failed");
    }
  }
}
