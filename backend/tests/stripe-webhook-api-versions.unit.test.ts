import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BillingService } from "../src/modules/billing/billing.service";
import type { StripeGateway, StripeWebhookEvent } from "../src/modules/billing/stripe-gateway";
import { SupabaseBillingSubscriptionsRepository } from "../src/modules/billing/subscriptions.repository";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { createPlanCatalog, TRIAL_CAPABLE_PLAN_CODES, trialPlanCodes } from "../src/modules/entitlements/plan-definitions";
import { UsageService } from "../src/modules/usage/usage.service";
import { InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository } from "./helpers/in-memory";

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// The live endpoint receives 2026-03-25.dahlia payloads; the period is only on the items there.
// Trimmed from evt_1UY13W5iISFfho92lppj09NZ (customer.subscription.created), times made relative to now.
const dahliaSubscription = (userId: string, start: number, end: number, status = "trialing") => ({
  id: "sub_dahlia", object: "subscription", customer: "cus_dahlia", status, cancel_at_period_end: false,
  billing_cycle_anchor: end, trial_start: start, trial_end: end, cancellation_details: { comment: null, feedback: null, reason: null },
  metadata: { app_user_id: userId, plan_code: "weekly", billing_market: "TR", billing_currency: "try" },
  items: { object: "list", data: [{
    id: "si_dahlia", object: "subscription_item", current_period_start: start, current_period_end: end,
    price: { id: "price_weekly", currency: "try", unit_amount: 14990, recurring: { interval: "week", interval_count: 1 } }
  }] }
});

// Pre-basil versions (the SDK's 2024-06-20) carry the period on the subscription itself.
const legacySubscription = (userId: string, start: number, end: number, status = "trialing") => {
  const { items, ...subscription } = dahliaSubscription(userId, start, end, status);
  return {
    ...subscription, id: "sub_legacy", current_period_start: start, current_period_end: end,
    items: { ...items, data: items.data.map(({ current_period_start: _start, current_period_end: _end, ...item }) => item) }
  };
};

async function fixture() {
  const users = new InMemoryUsersRepository();
  const subscriptions = new InMemorySubscriptionsRepository();
  const user = await users.ensureByAuthIdentity({ auth_user_id: "00000000-0000-0000-0000-0000000000a1", email: "periods@example.invalid", full_name: "Period Test", locale: "en" });
  const gateway = {
    constructWebhookEvent: (payload: Buffer): StripeWebhookEvent => {
      const event = JSON.parse(payload.toString("utf8")) as { id: string; type: string; data: { object: unknown } };
      return { id: event.id, type: event.type, object: event.data.object };
    },
    retrieveCustomer: async () => null
  } as unknown as StripeGateway;
  const billing = new BillingService(users, subscriptions, new UsageService(new InMemoryUsageRepository()),
    new EntitlementsService(createPlanCatalog({ freeUsageLimitsEnabled: false, weeklyStripePriceId: "price_weekly" })), gateway, {
      requireSubscription: true, provider: "stripe", trialPeriodDays: 3, stripeWebhookSecret: "whsec_test",
      checkoutSuccessUrl: "http://localhost:5173/app/checkout", checkoutCancelUrl: "http://localhost:5173/app/checkout", portalReturnUrl: "http://localhost:5173/app/pricing"
    });
  const webhook = (object: unknown, type = "customer.subscription.updated") =>
    billing.handleWebhook(Buffer.from(JSON.stringify({ id: `evt_${Math.random()}`, type, data: { object } })), "sig_test");
  const access = async () => (await billing.getBillingPlan(user.id)).app_access;
  return { billing, subscriptions, userId: user.id, webhook, access };
}

describe("Stripe webhook payloads across API versions", () => {
  it("reads the billing period from the subscription (2024-06-20) and from its items (dahlia)", async () => {
    const f = await fixture();
    const start = now() - DAY;
    const end = now() + 2 * DAY;
    for (const object of [legacySubscription(f.userId, start, end), dahliaSubscription(f.userId, start, end)]) {
      expect((await f.webhook(object)).processed).toBe(true);
      expect(await f.subscriptions.findByProviderSubscriptionId("stripe", object.id)).toMatchObject({
        status: "trialing", plan_code: "weekly", current_period_start: iso(start), current_period_end: iso(end)
      });
    }
  });

  it("prefers the subscription's own period and spans every item when items differ", async () => {
    const f = await fixture();
    const base = now();
    const both = { ...dahliaSubscription(f.userId, base, base + 7 * DAY, "active"), current_period_start: base + 1, current_period_end: base + 7 * DAY + 1 };
    await f.webhook(both);
    expect(await f.subscriptions.findByProviderSubscriptionId("stripe", "sub_dahlia")).toMatchObject({ current_period_start: iso(base + 1), current_period_end: iso(base + 7 * DAY + 1) });

    const mixed = dahliaSubscription(f.userId, base, base + 7 * DAY, "active");
    mixed.items.data.push({ ...mixed.items.data[0], id: "si_second", current_period_start: base - DAY, current_period_end: base + 30 * DAY });
    await f.webhook(mixed);
    expect(await f.subscriptions.findByProviderSubscriptionId("stripe", "sub_dahlia")).toMatchObject({ current_period_start: iso(base - DAY), current_period_end: iso(base + 30 * DAY) });
  });

  it("keeps Pro for a dahlia trial until its end, and not after", async () => {
    const f = await fixture();
    await f.webhook(dahliaSubscription(f.userId, now() - DAY, now() + 2 * DAY), "customer.subscription.created");
    expect(await f.access()).toBe(true);
    // The trial ended but the webhook that converts or cancels it has not arrived yet.
    await f.webhook(dahliaSubscription(f.userId, now() - 3 * DAY, now() - 60));
    expect(await f.access()).toBe(false);
  });

  it("bounds a trialing row without a period end by its trial end, and never extends an ended period", async () => {
    const accessFor = async (trialEnd: string | null, periodEnd: string | null) => {
      const f = await fixture();
      f.subscriptions.seed({
        id: "row_seed", user_id: f.userId, provider: "stripe", provider_customer_id: "cus_seed", provider_subscription_id: "sub_seed",
        plan_code: "weekly", status: "trialing", current_period_start: null, current_period_end: periodEnd, trial_end: trialEnd,
        cancel_at_period_end: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
      return f.access();
    };
    expect(await accessFor(iso(now() + DAY), null)).toBe(true);
    expect(await accessFor(iso(now() - 60), null)).toBe(false);
    expect(await accessFor(null, null)).toBe(false);
    expect(await accessFor(iso(now() + DAY), iso(now() - 60))).toBe(false);
  });

  // The cancel-flow fields (20261111120000) are top-level in dahlia too: the cancellation comment naming the
  // replacement, and the pending plan change in the metadata.
  it("keeps a dahlia trial replaced by the cancel-flow offer as superseded, and reads a pending plan change", async () => {
    const f = await fixture();
    const start = now() - DAY;
    const end = now() + 2 * DAY;
    await f.webhook(dahliaSubscription(f.userId, start, end), "customer.subscription.created");
    const ended = { ...dahliaSubscription(f.userId, start, end, "canceled"), ended_at: now(), canceled_at: now(),
      cancellation_details: { comment: "replaced_by:sub_offer_monthly", feedback: null, reason: "cancellation_requested" } };
    expect((await f.webhook(ended, "customer.subscription.deleted")).processed).toBe(true);
    expect(await f.subscriptions.findByProviderSubscriptionId("stripe", "sub_dahlia")).toMatchObject({
      status: "inactive", cancel_at_period_end: false, current_period_start: iso(start), current_period_end: iso(end)
    });

    const g = await fixture();
    const changeAt = now() + 5 * DAY;
    const active = dahliaSubscription(g.userId, now() - 2 * DAY, changeAt, "active");
    await g.webhook({ ...active, metadata: { ...active.metadata, cv_scheduled_plan_code: "monthly", cv_scheduled_change_at: String(changeAt) } });
    expect(await g.subscriptions.findByProviderSubscriptionId("stripe", "sub_dahlia")).toMatchObject({
      current_period_end: iso(changeAt), scheduled_plan_code: "monthly", scheduled_change_at: iso(changeAt)
    });
  });

  it("loads the trial end with the subscription row", async () => {
    const row = {
      id: "row_1", user_id: "user_1", provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", plan_code: "weekly",
      status: "trialing", current_period_start: null, current_period_end: null, trial_end: "2026-11-05T09:13:29+00:00", cancel_at_period_end: false,
      created_at: "2026-11-02T09:13:29+00:00", updated_at: "2026-11-02T09:13:29+00:00"
    };
    // Every query builder call returns the builder; awaiting it yields the one row.
    const builder: Record<string, unknown> = new Proxy({}, {
      get: (_target, key) => key === "then" ? (resolve: (value: unknown) => void) => resolve({ data: [row], error: null }) : () => builder
    });
    const repository = new SupabaseBillingSubscriptionsRepository({ from: () => builder } as unknown as SupabaseClient);
    expect(await repository.getCurrentForUser("user_1")).toMatchObject({ trial_end: "2026-11-05T09:13:29+00:00", current_period_end: null });
  });
});

describe("trial eligibility query", () => {
  it("counts a used trial in one query: a real, activated subscription on any plan that has carried the trial, or any Stripe trial", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = new Proxy({}, {
      get: (_target, key) => key === "then"
        ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null })
        : (...args: unknown[]) => { calls.push([String(key), args]); return builder; }
    });
    const repository = new SupabaseBillingSubscriptionsRepository({ from: () => builder } as unknown as SupabaseClient);
    expect(await repository.hasUsedTrial("user_1")).toBe(false);
    expect(calls).toEqual([
      ["select", ["id"]],
      ["eq", ["user_id", "user_1"]],
      ["or", ["and(plan_code.in.(pro,weekly,monthly),provider_subscription_id.not.is.null,status.not.in.(incomplete,incomplete_expired)),trial_start.not.is.null"]],
      ["limit", [1]]
    ]);
  });

  it("keeps every plan that grants the trial today in the trial history", () => {
    expect(trialPlanCodes(createPlanCatalog())).toEqual(["monthly"]);
    for (const plan of trialPlanCodes(createPlanCatalog())) expect(TRIAL_CAPABLE_PLAN_CODES).toContain(plan);
  });
});
