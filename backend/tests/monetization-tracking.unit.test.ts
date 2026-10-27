import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import {
  toInvoiceSummary,
  type StripeGateway,
  type StripeInvoiceSummary,
  type StripeWebhookEvent
} from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { MonetizationRefreshService } from "../src/modules/monetization/monetization-refresh.service";
import type { MonetizationRepository } from "../src/modules/monetization/monetization.repository";
import { UsageService } from "../src/modules/usage/usage.service";
import { ConflictError, ForbiddenError } from "../src/shared/errors/app-error";
import {
  FakeAuthProvider,
  InMemorySubscriptionsRepository,
  InMemoryUsageRepository,
  InMemoryUsersRepository,
  createTestConfig
} from "./helpers/in-memory";

const recordingRepository = () => ({
  upsertInvoice: vi.fn(async () => {}),
  recordCheckoutAttempt: vi.fn(async () => {}),
  resolveCheckoutAttempt: vi.fn(async () => {}),
  recordEntitlementDenial: vi.fn(async () => {}),
  recordUserActivity: vi.fn(async () => {}),
  upsertPriceCatalog: vi.fn(async () => {}),
  upsertPlanCatalog: vi.fn(async () => {}),
  upsertFxRates: vi.fn(async () => {}),
  markInternalUsers: vi.fn(async () => {})
}) satisfies MonetizationRepository;

const invoice = (overrides: Partial<StripeInvoiceSummary> = {}): StripeInvoiceSummary => ({
  id: "in_1", customer_id: "cus_1", subscription_id: "sub_1", status: "paid", currency: "try",
  amount_subtotal: 29900, amount_discount: 0, amount_tax: 0, amount_total: 29900, amount_paid: 29900, amount_refunded: 0,
  billing_reason: "subscription_cycle", price_ids: [], period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-10-08T00:00:00.000Z",
  paid_at: "2026-10-01T00:05:00.000Z", created_at: "2026-10-01T00:00:00.000Z", metadata: {}, ...overrides
});

const build = (options: { requireSubscription?: boolean } = {}) => {
  const config = createTestConfig();
  const users = new InMemoryUsersRepository();
  const subscriptions = new InMemorySubscriptionsRepository();
  const monetization = recordingRepository();
  const invoices = new Map<string, StripeInvoiceSummary>();
  const gateway = {
    hasBillableSubscription: async () => false,
    createCustomer: async () => ({ id: "cus_1", email: null, name: null, metadata: {} }),
    createCheckoutSession: async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1", customer_id: "cus_1", subscription_id: null, metadata: {} }),
    createPortalSession: async () => ({ url: "https://billing.stripe.test" }),
    constructWebhookEvent: (payload: Buffer) => JSON.parse(payload.toString("utf8")) as StripeWebhookEvent,
    retrieveSubscription: async () => null,
    retrieveCustomer: async () => ({ id: "cus_1", email: null, name: null, metadata: {} }),
    retrieveInvoice: async (id: string) => invoices.get(id) ?? null,
    retrieveChargeInvoiceId: vi.fn(async () => "in_1")
  } satisfies StripeGateway;
  const billing = new BillingService(
    users, subscriptions, new UsageService(new InMemoryUsageRepository()),
    new EntitlementsService(createPlanCatalog({ weeklyStripePriceId: config.billing.stripeWeeklyPriceId })),
    gateway,
    {
      provider: "stripe", requireSubscription: options.requireSubscription ?? false, checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
      checkoutCancelUrl: config.billing.checkoutCancelUrl, portalReturnUrl: config.billing.portalReturnUrl,
      stripeWebhookSecret: "whsec_test", trialPeriodDays: 3, monetization
    }
  );
  const webhook = (type: string, object: unknown, id = `evt_${type}`) =>
    billing.handleWebhook(Buffer.from(JSON.stringify({ id, type, created: "2026-10-01T00:00:00.000Z", object })), "sig");
  const user = () => users.ensureByAuthIdentity({ auth_user_id: "auth-1", email: "payer@example.invalid", full_name: null, locale: "en" });
  return { config, billing, subscriptions, monetization, invoices, gateway, webhook, user };
};

describe("monetization tracking", () => {
  it("passes the Stripe event and descriptive subscription fields to the sync without changing access fields", async () => {
    const f = build();
    const user = await f.user();
    const upsert = vi.spyOn(f.subscriptions, "upsertProviderSubscription");
    await f.webhook("customer.subscription.updated", {
      id: "sub_1", customer: "cus_1", status: "canceled", cancel_at_period_end: true,
      current_period_start: 1790000000, current_period_end: 1790604800, trial_start: 1789740800, trial_end: 1790000000,
      canceled_at: 1789900000, ended_at: 1790604800, cancellation_details: { reason: "cancellation_requested", feedback: "too_expensive", comment: "free text" },
      metadata: { app_user_id: user.id },
      items: { data: [{ price: { id: f.config.billing.stripeWeeklyPriceId, unit_amount: 6990, currency: "try", recurring: { interval: "week" } } }] }
    }, "evt_sub");

    const input = upsert.mock.calls[0][0];
    expect(input).toMatchObject({ plan_code: "weekly", status: "canceled", cancel_at_period_end: true });
    expect(input.tracking).toEqual({
      trial_start: "2026-09-18T14:13:20.000Z", trial_end: "2026-09-21T14:13:20.000Z",
      canceled_at: "2026-09-20T10:26:40.000Z", ended_at: "2026-09-28T14:13:20.000Z",
      cancellation_reason: "cancellation_requested", cancellation_feedback: "too_expensive",
      unit_amount: 6990, currency: "try", billing_interval: "week",
      last_provider_event_id: "evt_sub", last_provider_event_at: "2026-10-01T00:00:00.000Z"
    });
  });

  it("stores invoices as Stripe reports them, linked to the subscription and plan at invoice time", async () => {
    const f = build();
    const user = await f.user();
    f.subscriptions.seed({ id: "row-1", user_id: user.id, provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", plan_code: "weekly", status: "active", current_period_start: null, current_period_end: null, cancel_at_period_end: false, created_at: "2026-10-01", updated_at: "2026-10-01" });
    f.invoices.set("in_1", invoice({ price_ids: [f.config.billing.stripeWeeklyPriceId!], amount_refunded: 10000, status: "partially_refunded" }));

    expect((await f.webhook("invoice.paid", { id: "in_1" })).processed).toBe(true);
    expect(f.monetization.upsertInvoice).toHaveBeenCalledWith(expect.objectContaining({
      user_id: user.id, subscription_id: "row-1", provider_invoice_id: "in_1", status: "partially_refunded",
      currency: "try", amount_total: 29900, amount_refunded: 10000, plan_code: "weekly", billing_reason: "subscription_cycle"
    }));

    // Refunds resolve the invoice through the charge when the event omits it.
    expect((await f.webhook("charge.refunded", { id: "ch_1" })).processed).toBe(true);
    expect(f.gateway.retrieveChargeInvoiceId).toHaveBeenCalledWith("ch_1");
  });

  it("does not store invoices for unknown or erased accounts", async () => {
    const f = build();
    f.invoices.set("in_2", invoice({ id: "in_2", customer_id: "cus_gone", subscription_id: "sub_gone" }));
    expect((await f.webhook("invoice.paid", { id: "in_2" })).processed).toBe(false);
    expect(f.monetization.upsertInvoice).not.toHaveBeenCalled();
  });

  it("records each checkout attempt and resolves it from Stripe", async () => {
    const f = build();
    const user = await f.user();
    const response = await f.billing.createCheckoutSession(user.id, { plan_code: "weekly" });
    expect(response.checkout_session_id).toBe("cs_1");
    expect(f.monetization.recordCheckoutAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      user_id: user.id, plan_code: "weekly", trial_requested: true, trial_applied: true, checkout_session_id: "cs_1", outcome: "open"
    }));

    await f.webhook("checkout.session.expired", { id: "cs_1" });
    expect(f.monetization.resolveCheckoutAttempt).toHaveBeenCalledWith("cs_1", "expired");

    f.subscriptions.seed({ id: "row-1", user_id: user.id, provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", plan_code: "weekly", status: "active", current_period_start: null, current_period_end: null, cancel_at_period_end: false, created_at: "2026-10-01", updated_at: "2026-10-01" });
    const rejected = f.billing.createCheckoutSession(user.id, { plan_code: "monthly", with_trial: false });
    await expect(rejected).rejects.toBeInstanceOf(ConflictError);
    expect(f.monetization.recordCheckoutAttempt).toHaveBeenLastCalledWith(expect.objectContaining({
      plan_code: "monthly", trial_requested: false, checkout_session_id: null, outcome: "rejected_active"
    }));
  });

  it("counts paywall hits with the gate and reason, but not the existing-CV exemption", async () => {
    const f = build({ requireSubscription: true });
    const user = await f.user();
    await expect(f.billing.assertSubscriptionAccess(user.id, false, { action: "app_access", surface: "ai" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.monetization.recordEntitlementDenial).toHaveBeenLastCalledWith({ user_id: user.id, plan_code: "free", action: "app_access", surface: "ai", reason: "no_subscription" });

    f.subscriptions.seed({ id: "row-1", user_id: user.id, provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", plan_code: "weekly", status: "trialing", current_period_start: null, current_period_end: "2026-01-01T00:00:00.000Z", cancel_at_period_end: false, created_at: "2026-01-01", updated_at: "2026-01-01" });
    await expect(f.billing.assertActionAllowed(user.id, "export_pdf")).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.monetization.recordEntitlementDenial).toHaveBeenLastCalledWith(expect.objectContaining({ action: "export_pdf", reason: "trial_expired" }));

    f.monetization.recordEntitlementDenial.mockClear();
    f.subscriptions.transitionGrants.set(user.id, { redeemed_at: null });
    await f.billing.assertSubscriptionAccess(user.id, true);
    expect(f.monetization.recordEntitlementDenial).not.toHaveBeenCalled();
  });

  it("records one activity per authenticated request through the tracker", async () => {
    const users = new InMemoryUsersRepository();
    const activity = { recordUserActivity: vi.fn(async () => {}) };
    const auth = new AuthService(new FakeAuthProvider({ token: { auth_user_id: "auth-1", email: "a@example.invalid", full_name: null, locale: "en" } }), users, undefined, activity);
    const context = await auth.authenticate("token");
    expect(activity.recordUserActivity).toHaveBeenCalledWith(context.appUser.id);
  });

  it("maps Stripe invoices with discounts, refunds and the service period of the plan line", () => {
    const summary = toInvoiceSummary({
      id: "in_1", customer: "cus_1", subscription: "sub_1", status: "paid", currency: "usd", subtotal: 1000, total: 800, tax: null,
      amount_paid: 800, billing_reason: "subscription_update", created: 1790000000, metadata: {},
      total_discount_amounts: [{ amount: 150, discount: "di_1" }, { amount: 50, discount: "di_2" }],
      status_transitions: { paid_at: 1790000100 }, charge: { amount_refunded: 800 },
      lines: { data: [
        { type: "subscription", proration: true, price: { id: "price_old" }, period: { start: 1, end: 2 } },
        { type: "subscription", proration: false, price: { id: "price_new" }, period: { start: 1790000000, end: 1790604800 } }
      ] }
    } as unknown as Stripe.Invoice);
    expect(summary).toMatchObject({
      status: "refunded", amount_discount: 200, amount_tax: 0, amount_refunded: 800, price_ids: ["price_new", "price_old"],
      period_start: "2026-09-21T14:13:20.000Z", period_end: "2026-09-28T14:13:20.000Z", paid_at: "2026-09-21T14:15:00.000Z"
    });
  });
});

describe("monetization reference refresh", () => {
  const refreshService = (fetchImpl: typeof fetch, gateway: Partial<StripeGateway> | null = null) => {
    const repository = recordingRepository();
    const service = new MonetizationRefreshService(repository, gateway as StripeGateway | null, new EntitlementsService(createPlanCatalog()), {
      prices: { GLOBAL: { weekly: "price_usd_week", monthly: null, annual: null }, TR: { weekly: "price_try_week", monthly: null, annual: null } },
      legacyPrices: { pro: null, lifetime: null },
      historicalPrices: { price_old_try: "weekly" },
      trialDays: 3,
      adminEmails: ["admin@example.invalid"],
      fetchImpl
    });
    return { repository, service };
  };

  it("stores monthly USD->TRY averages and finalises only closed months", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const october = String(url).includes("2026-10-01");
      return new Response(JSON.stringify({ rates: october ? { "2026-10-01": { TRY: 50 }, "2026-10-02": { TRY: 52 } } : { "2026-09-01": { TRY: 48 }, "2026-09-30": { TRY: 49 } } }));
    }) as unknown as typeof fetch;
    const { repository, service } = refreshService(fetchImpl);
    const result = await service.refresh(new Date("2026-10-27T10:00:00Z"));
    expect(result.failures).toEqual([]);
    expect(String((fetchImpl as any).mock.calls[1][0])).toContain("2026-10-01..2026-10-27");
    expect(repository.upsertFxRates).toHaveBeenCalledWith([
      expect.objectContaining({ rate_month: "2026-09-01", rate: 48.5, sample_days: 2, is_final: true }),
      expect.objectContaining({ rate_month: "2026-10-01", rate: 51, sample_days: 2, is_final: false })
    ]);
    expect(repository.markInternalUsers).toHaveBeenCalledWith(["admin@example.invalid"]);
    expect(repository.upsertPlanCatalog).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ plan_code: "weekly", trial_days: 3 }),
      expect.objectContaining({ plan_code: "free", trial_days: 0, limits: expect.objectContaining({ exports: 5 }) })
    ]));
  });

  it("catalogs configured and historical prices with their real amounts, and reports failures without throwing", async () => {
    const prices: Record<string, { currency: string; amount: number }> = { price_usd_week: { currency: "usd", amount: 499 }, price_try_week: { currency: "try", amount: 6990 }, price_old_try: { currency: "try", amount: 4990 } };
    const gateway = { retrievePrice: async (id: string) => ({ id, active: true, product_id: "prod_1", interval: "week", interval_count: 1, ...prices[id] }) };
    const { repository, service } = refreshService((async () => new Response("down", { status: 503 })) as unknown as typeof fetch, gateway);
    const result = await service.refresh(new Date("2026-10-27T10:00:00Z"));
    expect(result.failures).toEqual(["fx: FX source returned 503"]);
    expect(repository.upsertPriceCatalog).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ provider_price_id: "price_try_week", market: "TR", unit_amount: 6990, is_configured: true }),
      expect.objectContaining({ provider_price_id: "price_old_try", market: "TR", unit_amount: 4990, is_configured: false })
    ]));
  });
});
