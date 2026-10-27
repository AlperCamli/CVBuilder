import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { StripeGateway } from "../src/modules/billing/stripe-gateway";
import { MonetizationBackfillService } from "../src/modules/monetization/monetization-backfill.service";
import type { MonetizationRefreshService } from "../src/modules/monetization/monetization-refresh.service";

const details = { trial_start: null, trial_end: null, canceled_at: null, ended_at: null, cancellation_reason: null, cancellation_feedback: null, unit_amount: 999, currency: "usd", billing_interval: "week" };

// Minimal PostgREST stand-in: paged selects and recorded subscription updates.
const fakeDb = (tables: Record<string, object[]>) => {
  const updates: Array<{ id: unknown; values: object }> = [];
  const db = {
    from: (table: string) => ({
      select: () => ({ order: () => ({ range: async (from: number, to: number) => ({ data: (tables[table] ?? []).slice(from, to + 1), error: null }) }) }),
      update: (values: object) => ({ eq: async (_column: string, id: unknown) => { updates.push({ id, values }); return { error: null }; } })
    })
  };
  return { db: db as unknown as SupabaseClient, updates };
};

const setup = () => {
  const { db, updates } = fakeDb({
    subscriptions: [
      { id: "s1", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", billing_interval: null, created_at: "2026-08-15T00:00:00Z" },
      { id: "s2", provider_customer_id: "cus_2", provider_subscription_id: "sub_2", billing_interval: "month", created_at: "2026-09-01T00:00:00Z" },
      { id: "s3", provider_customer_id: null, provider_subscription_id: null, billing_interval: null, created_at: "2026-01-01T00:00:00Z" }
    ],
    billing_invoices: [{ provider_invoice_id: "in_old" }]
  });
  const gateway = {
    retrieveSubscription: vi.fn(async () => ({ id: "sub_1", customer_id: "cus_1", status: "active", details })),
    listInvoiceIds: vi.fn(async (customer: string) => (customer === "cus_1" ? ["in_old", "in_new"] : ["in_other"]))
  };
  const billing = { syncInvoice: vi.fn(async (id: string) => id !== "in_other") };
  const refresh = {
    refresh: vi.fn(async () => ({ prices: 1, plans: 1, fx_months: [], internal_accounts: 0, failures: [] })),
    refreshFxMonths: vi.fn(async (months: Date[]) => months.map(month => month.toISOString().slice(0, 10)))
  };
  const logger = { info: vi.fn() } as unknown as Logger;
  const service = new MonetizationBackfillService(db, gateway as unknown as StripeGateway, billing, refresh as unknown as MonetizationRefreshService, logger);
  return { service, updates, gateway, billing, refresh };
};

describe("monetization backfill", () => {
  it("fills only missing subscription details and invoices not imported yet, then loads FX from the first subscription", async () => {
    const { service, updates, gateway, billing, refresh } = setup();
    const result = await service.run();

    expect(gateway.retrieveSubscription).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([{ id: "s1", values: details }]);
    expect(billing.syncInvoice.mock.calls.map(([id]) => id)).toEqual(["in_new", "in_other"]);
    expect(refresh.refreshFxMonths.mock.calls[0][0][0].toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(result).toMatchObject({ complete: true, customers: 2, subscriptions: 1, invoices: 1, skipped_invoices: 1, fx_from: "2026-08" });
  });

  it("writes nothing on a dry run and stops early when the time budget is spent", async () => {
    const dry = setup();
    expect(await dry.service.run({ dryRun: true })).toMatchObject({ complete: true, subscriptions: 1, invoices: 2, refresh: null });
    expect(dry.updates).toEqual([]);
    expect(dry.billing.syncInvoice).not.toHaveBeenCalled();
    expect(dry.refresh.refresh).not.toHaveBeenCalled();

    const late = setup();
    expect(await late.service.run({ budgetMs: -1 })).toMatchObject({ complete: false, subscriptions: 0, invoices: 0 });
    expect(late.refresh.refresh).not.toHaveBeenCalled();
  });
});
