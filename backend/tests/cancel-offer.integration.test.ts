import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService, pendingChange } from "../src/modules/billing/billing.service";
import type { BillingMarket, BillingPrices, RegionalPricingService } from "../src/modules/billing/regional-pricing";
import {
  StripeBillingGateway,
  replacedByOf,
  toSubscriptionDetails,
  type ApplyStripeRenewalDiscountInput,
  type CreateStripeCheckoutInput,
  type CreateStripePortalInput,
  type ScheduleStripeSubscriptionChangeInput,
  type StripeCheckoutSessionSummary,
  type StripeGateway,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent
} from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import type { CheckoutAttemptRow, MonetizationRepository } from "../src/modules/monetization/monetization.repository";
import { SupabasePromotionsRepository, type PromotionsRepository } from "../src/modules/promotions/promotions.repository";
import { PromotionsService } from "../src/modules/promotions/promotions.service";
import type { CancelFlowPromotion, CancelOfferAudience, CancelOfferRow, CancelOfferSubject, CancelOffersPort, PromotionRow } from "../src/modules/promotions/promotions.types";
import { UsageService } from "../src/modules/usage/usage.service";
import type { SubscriptionRecord } from "../src/shared/types/domain";
import { createTestConfig, FakeAuthProvider, InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository } from "./helpers/in-memory";

const HOUR = 3600_000;
const PROMOTION: CancelFlowPromotion = { id: "22222222-2222-4222-8222-222222222222", audience: "trial", slug: "trial-cancel-save50", percent_off: 50, plan_code: "monthly", coupon_id: "coupon_save50" };
const PAID_PROMOTIONS: Record<"weekly" | "monthly", CancelFlowPromotion> = {
  weekly: { id: "33333333-3333-4333-8333-333333333333", audience: "weekly", slug: "weekly-cancel-save50", percent_off: 50, plan_code: "monthly", coupon_id: "coupon_weekly50" },
  monthly: { id: "44444444-4444-4444-8444-444444444444", audience: "monthly", slug: "monthly-cancel-save50", percent_off: 50, plan_code: "monthly", coupon_id: "coupon_monthly50" }
};

const prices = (market: BillingMarket): BillingPrices => market === "TR"
  ? { market, currency: "try", available: true, quote: "q", plans: [
    { code: "weekly", amount: 14990, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: 34990, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: 149900, interval: "year", interval_count: 1, trial_days: 0 }] }
  : { market, currency: "usd", available: true, quote: "q", plans: [
    { code: "weekly", amount: 499, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: 1499, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: 9990, interval: "year", interval_count: 1, trial_days: 0 }] };

class InMemoryCancelOffers implements CancelOffersPort {
  promotion: CancelFlowPromotion | null = { ...PROMOTION };
  readonly paid: Partial<Record<CancelOfferAudience, CancelFlowPromotion>> = { ...PAID_PROMOTIONS };
  readonly rows = new Map<string, CancelOfferRow>();
  readonly declined: string[] = [];
  async activeCancelPromotion(audience: CancelOfferAudience) { return audience === "trial" ? this.promotion : this.paid[audience] ?? null; }
  async findCancelOffer(promotionId: string, userId: string) { return this.rows.get(`${promotionId}:${userId}`) ?? null; }
  async recordCancelOfferShown(s: CancelOfferSubject) {
    const row = this.rows.get(`${s.promotionId}:${s.userId}`);
    if (row) row.show_count += 1;
    else this.rows.set(`${s.promotionId}:${s.userId}`, { promotion_id: s.promotionId, user_id: s.userId, provider_subscription_id: s.providerSubscriptionId, from_plan_code: s.fromPlanCode, show_count: 1, declined_at: null, last_checkout_at: null, accepted_at: null });
  }
  async hasAcceptedCancelOffer(userId: string) { return [...this.rows.values()].some(row => row.user_id === userId && row.accepted_at); }
  async recordCancelOfferDeclined(userId: string) { this.declined.push(userId); }
  async recordCancelOfferCheckout(s: CancelOfferSubject) {
    const row = this.rows.get(`${s.promotionId}:${s.userId}`);
    if (row) row.last_checkout_at = new Date().toISOString();
  }
  async markCancelOfferAccepted(s: CancelOfferSubject) {
    if (!this.rows.has(`${s.promotionId}:${s.userId}`)) await this.recordCancelOfferShown(s);
    this.rows.get(`${s.promotionId}:${s.userId}`)!.accepted_at ??= new Date().toISOString();
  }
}

class OfferGateway implements StripeGateway {
  readonly checkouts: CreateStripeCheckoutInput[] = [];
  readonly canceled: Array<[string, string]> = [];
  readonly portals: CreateStripePortalInput[] = [];
  readonly subscriptions = new Map<string, StripeSubscriptionSummary>();
  readonly sessions = new Map<string, StripeCheckoutSessionSummary>();
  async createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary> {
    this.checkouts.push(input);
    const id = `cs_offer_${this.checkouts.length}`;
    return { id, url: `https://checkout.stripe.test/${id}`, customer_id: input.customer_id, subscription_id: null, metadata: input.metadata };
  }
  /** What Stripe holds once the offer's checkout is paid: a monthly subscription carrying the session metadata. */
  pay(sessionIndex = 0, status = "active") {
    const input = this.checkouts[sessionIndex];
    const id = `sub_monthly_${sessionIndex + 1}`;
    this.subscriptions.set(id, {
      id, customer_id: input.customer_id, status, cancel_at_period_end: false, trial_start: null,
      current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      metadata: input.metadata, price_ids: [input.price_id]
    });
    const session = { id: `cs_offer_${sessionIndex + 1}`, url: null, status: "complete", payment_status: "paid", customer_id: input.customer_id, subscription_id: id, metadata: input.metadata };
    this.sessions.set(session.id, session);
    return session;
  }
  async cancelReplacedSubscription(subscriptionId: string, replacedBy: string) {
    this.canceled.push([subscriptionId, replacedBy]);
    const current = this.subscriptions.get(subscriptionId)!;
    const ended = { ...current, status: "canceled", replaced_by: replacedBy };
    this.subscriptions.set(subscriptionId, ended);
    return ended;
  }
  readonly scheduled: ScheduleStripeSubscriptionChangeInput[] = [];
  readonly released: string[] = [];
  readonly discounted: ApplyStripeRenewalDiscountInput[] = [];
  async scheduleSubscriptionChange(input: ScheduleStripeSubscriptionChangeInput) {
    this.scheduled.push(input);
    const current = this.subscriptions.get(input.subscription_id)!;
    const updated = { ...current, details: { ...current.details!, scheduled_plan_code: input.plan_code, scheduled_change_at: current.current_period_end } };
    this.subscriptions.set(updated.id, updated);
    return updated;
  }
  async releaseScheduledChange(subscriptionId: string) {
    this.released.push(subscriptionId);
    const current = this.subscriptions.get(subscriptionId)!;
    const updated = { ...current, details: { ...current.details!, scheduled_plan_code: null, scheduled_change_at: null } };
    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }
  async applyRenewalDiscount(input: ApplyStripeRenewalDiscountInput) {
    this.discounted.push(input);
    const current = this.subscriptions.get(input.subscription_id)!;
    const updated = { ...current, metadata: { ...current.metadata, ...input.metadata } };
    this.subscriptions.set(updated.id, updated);
    return updated;
  }
  async retrieveCheckoutSession(id: string) { return this.sessions.get(id) ?? null; }
  async createCustomer(): Promise<never> { throw new Error("not used"); }
  async createPortalSession(input: CreateStripePortalInput) { this.portals.push(input); return { url: "https://billing.stripe.test/portal" }; }
  constructWebhookEvent(payload: Buffer): StripeWebhookEvent {
    const parsed = JSON.parse(payload.toString("utf8")) as { id: string; type: string; data: { object: unknown } };
    return { id: parsed.id, type: parsed.type, object: parsed.data.object };
  }
  async retrieveSubscription(id: string) { return this.subscriptions.get(id) ?? null; }
  async retrieveCustomer(id: string) { return { id, email: null, name: null, metadata: {} }; }
}

const fixture = async (options: { market?: BillingMarket | null; status?: string; plan?: string; cancelScheduled?: boolean; trialEndsIn?: number; pricesAvailable?: boolean; noOfferSupport?: boolean } = {}) => {
  const config = createTestConfig();
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const authProvider = new FakeAuthProvider({ "owner-token": { auth_user_id: "auth-owner", email: "owner@example.test", full_name: "Owner", locale: "tr" } });
  const owner = await usersRepository.ensureByAuthIdentity({ auth_user_id: "auth-owner", email: "owner@example.test", full_name: "Owner", locale: "tr" });
  const market = options.market === undefined ? "TR" : options.market;
  const trialEnd = new Date(Date.now() + (options.trialEndsIn ?? 48 * HOUR)).toISOString();
  const trialStart = new Date(Date.now() - 24 * HOUR).toISOString();
  const subscription: SubscriptionRecord = {
    id: "local-sub", user_id: owner.id, provider: "stripe", provider_customer_id: "cus_owner", provider_subscription_id: "sub_trial",
    plan_code: options.plan ?? "weekly", status: options.status ?? "trialing", current_period_start: trialStart, current_period_end: trialEnd,
    cancel_at_period_end: options.cancelScheduled ?? false, created_at: trialStart, updated_at: trialStart
  };
  subscriptionsRepository.seed(subscription);
  const gateway = new OfferGateway();
  gateway.subscriptions.set("sub_trial", {
    id: "sub_trial", customer_id: "cus_owner", status: subscription.status, cancel_at_period_end: subscription.cancel_at_period_end, trial_start: trialStart,
    current_period_start: trialStart, current_period_end: trialEnd, metadata: { app_user_id: owner.id, plan_code: subscription.plan_code },
    price_ids: [`${market === "GLOBAL" ? "price_usd" : "price_tr"}_${subscription.plan_code}`],
    details: { trial_start: null, trial_end: null, canceled_at: null, ended_at: null, cancellation_reason: null, cancellation_feedback: null, unit_amount: null, currency: null, billing_interval: null, scheduled_plan_code: null, scheduled_change_at: null }
  });
  if (options.noOfferSupport) (gateway as { cancelReplacedSubscription?: unknown }).cancelReplacedSubscription = undefined;
  const ids = { GLOBAL: { weekly: "price_usd_weekly", monthly: "price_usd_monthly", annual: "price_usd_annual" }, TR: { weekly: "price_tr_weekly", monthly: "price_tr_monthly", annual: "price_tr_annual" } };
  const regional = {
    options: { prices: ids },
    savedMarket: async () => market,
    getPrices: async () => (options.pricesAvailable === false ? { ...prices(market ?? "GLOBAL"), available: false, plans: [] } : prices(market ?? "GLOBAL")),
    portal: async () => "bpc_test",
    planFromPrice: (id: string) => {
      for (const plans of Object.values(ids)) for (const [plan, price] of Object.entries(plans)) if (price === id) return plan;
      return null;
    }
  } as unknown as RegionalPricingService;
  const cancelOffers = new InMemoryCancelOffers();
  const attempts: CheckoutAttemptRow[] = [];
  const resolved: Array<[string, string]> = [];
  const monetization = {
    recordCheckoutAttempt: async (row: CheckoutAttemptRow) => { attempts.push(row); },
    resolveCheckoutAttempt: async (id: string, outcome: string) => { resolved.push([id, outcome]); }
  } as unknown as MonetizationRepository;
  const billingService = new BillingService(usersRepository, subscriptionsRepository, new UsageService(new InMemoryUsageRepository()), new EntitlementsService(createPlanCatalog()), gateway, {
    provider: "stripe", regionalPricing: regional, checkoutSuccessUrl: config.billing.checkoutSuccessUrl, checkoutCancelUrl: config.billing.checkoutCancelUrl,
    portalReturnUrl: config.billing.portalReturnUrl, stripeWebhookSecret: "whsec_test", trialPeriodDays: 3, cancelOffers, monetization
  });
  const app = createApp({
    config,
    services: { authService: new AuthService(authProvider, usersRepository), billingService },
    serviceOverrides: { usersRepository, billingSubscriptionsRepository: subscriptionsRepository, authProvider, stripeGateway: gateway }
  });
  const auth = (req: request.Test) => req.set("Authorization", "Bearer owner-token");
  const origin = new URL(config.billing.checkoutSuccessUrl).origin;
  const urls = { success_url: `${origin}/app/checkout?plan=monthly&trial=0&checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/app/cancel-trial?checkout=cancel` };
  const rows = async () => {
    const trial = await subscriptionsRepository.findByProviderSubscriptionId("stripe", "sub_trial");
    const current = await subscriptionsRepository.getCurrentForUser(owner.id);
    return { trial: trial?.status, current: current && `${current.provider_subscription_id}:${current.plan_code}:${current.status}` };
  };
  return {
    owner, gateway, cancelOffers, subscriptionsRepository, trialEnd, billingService, attempts, resolved, urls, rows,
    getOffer: () => auth(request(app).get("/api/v1/billing/cancel-offer")),
    checkout: (body: Record<string, unknown> = urls) => auth(request(app).post("/api/v1/billing/cancel-offer/checkout")).send(body),
    accept: (body: Record<string, unknown> = {}) => auth(request(app).post("/api/v1/billing/cancel-offer/accept")).send(body),
    planChange: (plan_code: string) => auth(request(app).post("/api/v1/billing/plan-change")).send({ plan_code }),
    keepPlan: () => auth(request(app).delete("/api/v1/billing/plan-change")),
    confirm: (sessionId: string) => auth(request(app).post("/api/v1/billing/checkout/confirm")).send({ session_id: sessionId }),
    portal: (body: Record<string, unknown>) => auth(request(app).post("/api/v1/billing/portal")).send(body),
    webhook: (id: string, type: string, object: unknown) => billingService.handleWebhook(Buffer.from(JSON.stringify({ id, type, data: { object } })), "t=1,v1=sig"),
    anonymous: request(app)
  };
};

const sessionObject = (session: StripeCheckoutSessionSummary) => ({ id: session.id, mode: "subscription", customer: session.customer_id, subscription: session.subscription_id, metadata: session.metadata });

describe("cancel-flow offer", () => {
  it("offers the promoted plan at its discounted first month in the trial's market and records the show", async () => {
    const f = await fixture();
    const response = await f.getOffer();
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toEqual({
      status: "available",
      offer: { slug: "trial-cancel-save50", percent_off: 50, plan_code: "monthly", currency: "try", amount: 34990, discounted_amount: 17495, current_plan_code: "weekly", current_amount: 14990, period_end: f.trialEnd, kind: "checkout" }
    });
    // The response never carries the coupon, price ids or provider ids.
    expect(JSON.stringify(response.body.data)).not.toMatch(/coupon|price_|sub_|cus_/);
    expect(f.cancelOffers.rows.get(`${PROMOTION.id}:${f.owner.id}`)).toMatchObject({ provider_subscription_id: "sub_trial", from_plan_code: "weekly", show_count: 1, accepted_at: null });
    await f.getOffer();
    expect(f.cancelOffers.rows.get(`${PROMOTION.id}:${f.owner.id}`)!.show_count).toBe(2);
  });

  it("prices a GLOBAL trial in USD", async () => {
    const f = await fixture({ market: "GLOBAL" });
    expect((await f.getOffer()).body.data.offer).toMatchObject({ currency: "usd", amount: 1499, discounted_amount: 749, current_amount: 499 });
  });

  it.each([
    ["a paid annual plan with no annual promotion", { status: "active", plan: "annual" }],
    ["a trial whose cancellation is already scheduled", { cancelScheduled: true }],
    ["a trial that has already ended", { trialEndsIn: -1 }],
    ["a trial with less than two hours left (its checkout could outlive it)", { trialEndsIn: 2 * HOUR - 60_000 }],
    ["a trial on the annual plan", { plan: "annual" }],
    ["a past-due subscription", { status: "past_due" }],
    ["an account without a locked billing market", { market: null }],
    ["unavailable regional prices", { pricesAvailable: false }],
    ["a gateway that cannot end the replaced trial", { noOfferSupport: true }]
  ] as const)("is unavailable for %s, without recording a show or opening checkout", async (_label, options) => {
    const f = await fixture(options);
    expect((await f.getOffer()).body.data).toEqual({ status: "unavailable", offer: null });
    expect(f.cancelOffers.rows.size).toBe(0);
    const checkout = await f.checkout();
    expect(checkout.status).toBe(409);
    expect(checkout.body.error.details).toEqual({ reason: "cancel_offer_unavailable" });
    expect(f.gateway.checkouts).toHaveLength(0);
  });

  it("is unavailable without an active cancel-flow promotion", async () => {
    const f = await fixture();
    f.cancelOffers.promotion = null;
    expect((await f.getOffer()).body.data.status).toBe("unavailable");
  });

  it("Keep Pro opens a paid checkout for the discounted monthly plan and leaves the trial running until payment", async () => {
    const f = await fixture();
    await f.getOffer();
    const response = await f.checkout();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ checkout_url: "https://checkout.stripe.test/cs_offer_1", checkout_session_id: "cs_offer_1", currency: "try", amount: 34990, amount_due: 17495 });
    const [input] = f.gateway.checkouts;
    expect(input).toMatchObject({
      customer_id: "cus_owner", price_id: "price_tr_monthly", currency: "try", mode: "subscription", trial_period_days: null,
      discounts: [{ coupon: "coupon_save50" }], success_url: f.urls.success_url, cancel_url: f.urls.cancel_url,
      metadata: { app_user_id: f.owner.id, plan_code: "monthly", billing_market: "TR", billing_currency: "try", promotion_slug: "trial-cancel-save50", promotion_id: PROMOTION.id, cancel_offer: "1", replaces_subscription: "sub_trial", replaces_plan_code: "weekly" }
    });
    // The session closes within 60-90 minutes; the offer needs two hours of trial left.
    const minutesOpen = (input.expires_at! * 1000 - Date.now()) / 60_000;
    expect(minutesOpen).toBeGreaterThan(59);
    expect(minutesOpen).toBeLessThanOrEqual(90);
    expect(f.attempts).toEqual([expect.objectContaining({ outcome: "open", plan_code: "monthly", checkout_session_id: "cs_offer_1", trial_requested: false, trial_applied: false, promotion_id: PROMOTION.id })]);
    expect(f.cancelOffers.rows.get(`${PROMOTION.id}:${f.owner.id}`)).toMatchObject({ accepted_at: null });
    expect(f.cancelOffers.rows.get(`${PROMOTION.id}:${f.owner.id}`)!.last_checkout_at).not.toBeNull();
    // Nothing is ended before payment.
    expect(f.gateway.canceled).toEqual([]);
    expect(await f.rows()).toEqual({ trial: "trialing", current: "sub_trial:weekly:trialing" });
    // A second click reuses the same Stripe session (same idempotency key).
    await f.checkout();
    expect(f.gateway.checkouts[1].idempotency_key).toBe(input.idempotency_key);
  });

  it("on payment (webhook), ends the trial at Stripe so the weekly price is never charged, and starts Pro", async () => {
    const f = await fixture();
    await f.getOffer();
    await f.checkout();
    const session = f.gateway.pay();
    expect((await f.webhook("evt_paid", "checkout.session.completed", sessionObject(session))).processed).toBe(true);
    expect(f.gateway.canceled).toEqual([["sub_trial", "sub_monthly_1"]]);
    // Pro Monthly is the current plan; the trial is kept as superseded, not as a canceled trial.
    expect(await f.rows()).toEqual({ trial: "inactive", current: "sub_monthly_1:monthly:active" });
    expect(f.cancelOffers.rows.get(`${PROMOTION.id}:${f.owner.id}`)!.accepted_at).not.toBeNull();
    expect(f.resolved).toEqual([["cs_offer_1", "completed"]]);
    // Replays and the trial's own "deleted" event change nothing and never knock out the paid plan.
    await f.webhook("evt_paid", "checkout.session.completed", sessionObject(session));
    await f.webhook("evt_trial_deleted", "customer.subscription.deleted", {
      id: "sub_trial", customer: "cus_owner", status: "canceled", cancel_at_period_end: false, metadata: { app_user_id: f.owner.id },
      cancellation_details: { reason: "cancellation_requested", comment: "replaced_by:sub_monthly_1" }, items: { data: [{ price: { id: "price_tr_weekly" } }] }
    });
    expect(f.gateway.canceled).toHaveLength(1);
    expect(await f.rows()).toEqual({ trial: "inactive", current: "sub_monthly_1:monthly:active" });
    // The plan the app reports: Pro Monthly, active.
    expect(await f.billingService.getBillingPlan(f.owner.id)).toMatchObject({ plan_code: "monthly", subscription_status: "active", app_access: true });
    // One offer per account: now on paid Monthly, the Monthly offer does not show either.
    expect((await f.getOffer()).body.data.status).toBe("unavailable");
  });

  it("the return page's confirmation ends the trial too, when it arrives before the webhook", async () => {
    const f = await fixture();
    await f.checkout();
    const session = f.gateway.pay();
    const confirmed = await f.confirm(session.id);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ plan_code: "monthly", subscription_status: "active" });
    expect(f.gateway.canceled).toEqual([["sub_trial", "sub_monthly_1"]]);
    await f.webhook("evt_paid", "checkout.session.completed", sessionObject(session));
    expect(f.gateway.canceled).toHaveLength(1);
  });

  it("waits for a payment that is still incomplete, and finishes when the subscription turns active", async () => {
    const f = await fixture();
    await f.checkout();
    const session = f.gateway.pay(0, "incomplete");
    await f.webhook("evt_paid", "checkout.session.completed", sessionObject(session));
    expect(f.gateway.canceled).toEqual([]);
    const monthly = f.gateway.subscriptions.get("sub_monthly_1")!;
    await f.webhook("evt_active", "customer.subscription.updated", {
      id: monthly.id, customer: monthly.customer_id, status: "active", cancel_at_period_end: false, metadata: monthly.metadata, items: { data: [{ price: { id: "price_tr_monthly" } }] }
    });
    expect(f.gateway.canceled).toEqual([["sub_trial", "sub_monthly_1"]]);
  });

  it("never ends a subscription of another customer, or anything for a checkout that is not the offer's", async () => {
    const f = await fixture();
    await f.checkout();
    f.gateway.subscriptions.set("sub_trial", { ...f.gateway.subscriptions.get("sub_trial")!, customer_id: "cus_someone_else" });
    await f.webhook("evt_paid", "checkout.session.completed", sessionObject(f.gateway.pay()));
    expect(f.gateway.canceled).toEqual([]);
    const g = await fixture();
    await g.checkout();
    const session = g.gateway.pay();
    const monthly = g.gateway.subscriptions.get(session.subscription_id!)!;
    const { cancel_offer: _offer, ...plain } = monthly.metadata;
    g.gateway.subscriptions.set(monthly.id, { ...monthly, metadata: plain });
    await g.webhook("evt_plain", "checkout.session.completed", { ...sessionObject(session), metadata: plain });
    expect(g.gateway.canceled).toEqual([]);
  });

  it("records a decline when the cancellation opens, and leaves the portal's cancel step unchanged", async () => {
    const f = await fixture();
    await f.getOffer();
    const response = await f.portal({ flow: "cancel" });
    expect(response.status).toBe(200);
    expect(f.cancelOffers.declined).toEqual([f.owner.id]);
    expect(f.gateway.portals[0].flow).toEqual({ type: "subscription_cancel", subscription_id: "sub_trial" });
    // Other portal visits are not declines.
    await f.portal({});
    await f.portal({ flow: "payment_method" });
    expect(f.cancelOffers.declined).toHaveLength(1);
  });

  it("requires a session, accepts only return URLs, and only on the app's own origin", async () => {
    const f = await fixture();
    expect((await f.anonymous.get("/api/v1/billing/cancel-offer")).status).toBe(401);
    expect((await f.anonymous.post("/api/v1/billing/cancel-offer/checkout")).status).toBe(401);
    expect((await f.checkout({ percent_off: 100 })).status).toBe(400);
    expect((await f.checkout({ success_url: "https://evil.example/app" })).status).toBe(400);
    expect(f.gateway.checkouts).toHaveLength(0);
  });
});

describe("cancel offers for paid plans", () => {
  const paid = (plan: string) => fixture({ status: "active", plan, trialEndsIn: 5 * 24 * HOUR });

  it("paid weekly: Monthly from the end of the paid week, first month 50% off, nothing charged now", async () => {
    const f = await paid("weekly");
    const offer = await f.getOffer();
    expect(offer.body.data).toEqual({ status: "available", offer: {
      kind: "switch_at_period_end", slug: "weekly-cancel-save50", percent_off: 50, plan_code: "monthly", currency: "try", amount: 34990, discounted_amount: 17495,
      current_plan_code: "weekly", current_amount: 14990, period_end: f.trialEnd
    } });
    // Paid plans never go through the trial's checkout.
    expect((await f.checkout()).status).toBe(409);
    const accepted = await f.accept();
    expect(accepted.status).toBe(200);
    expect(f.gateway.scheduled).toEqual([{
      subscription_id: "sub_trial", price_id: "price_tr_monthly", coupon_id: "coupon_weekly50", plan_code: "monthly",
      metadata: { plan_code: "monthly", promotion_slug: "weekly-cancel-save50", promotion_id: PAID_PROMOTIONS.weekly.id, cancel_offer: "1" },
      idempotency_key: `cv-cancel-offer-${PAID_PROMOTIONS.weekly.id}-sub_trial`
    }]);
    expect(f.gateway.checkouts).toEqual([]);
    expect(accepted.body.data).toMatchObject({ accepted: true, offer: { kind: "switch_at_period_end" }, plan: { plan_code: "weekly", subscription_status: "active", scheduled_change: { plan_code: "monthly", starts_at: f.trialEnd } } });
    expect(f.cancelOffers.rows.get(`${PAID_PROMOTIONS.weekly.id}:${f.owner.id}`)!.accepted_at).not.toBeNull();
    expect((await f.getOffer()).body.data.status).toBe("unavailable");
  });

  it("monthly: the next renewal 50% off on the same plan, nothing charged now", async () => {
    const f = await paid("monthly");
    expect((await f.getOffer()).body.data.offer).toMatchObject({ kind: "renewal_discount", plan_code: "monthly", current_plan_code: "monthly", discounted_amount: 17495, period_end: f.trialEnd });
    const accepted = await f.accept();
    expect(accepted.status).toBe(200);
    expect(f.gateway.discounted).toEqual([{
      subscription_id: "sub_trial", coupon_id: "coupon_monthly50",
      metadata: { plan_code: "monthly", promotion_slug: "monthly-cancel-save50", promotion_id: PAID_PROMOTIONS.monthly.id, cancel_offer: "1" },
      idempotency_key: `cv-cancel-offer-${PAID_PROMOTIONS.monthly.id}-sub_trial`
    }]);
    expect(f.gateway.scheduled).toEqual([]);
    expect(accepted.body.data.plan).toMatchObject({ plan_code: "monthly", subscription_status: "active", scheduled_change: null });
    expect((await f.accept()).status).toBe(409);
    expect(f.gateway.discounted).toHaveLength(1);
  });

  it("annual has no offer unless an annual promotion exists, and the trial's accept route refuses a trial", async () => {
    const f = await paid("annual");
    expect((await f.getOffer()).body.data.status).toBe("unavailable");
    f.cancelOffers.paid.annual = { id: "55555555-5555-4555-8555-555555555555", audience: "annual", slug: "annual-cancel-20", percent_off: 20, plan_code: "annual", coupon_id: "coupon_annual20" };
    expect((await f.getOffer()).body.data.offer).toMatchObject({ kind: "renewal_discount", plan_code: "annual", percent_off: 20, amount: 149900, discounted_amount: 119920 });
    const trial = await fixture();
    expect((await trial.accept()).status).toBe(409);
  });

  it("offers nothing while a plan change is waiting", async () => {
    const f = await paid("monthly");
    await f.planChange("weekly");
    expect((await f.getOffer()).body.data.status).toBe("unavailable");
  });
});

describe("changing plans", () => {
  const paid = (plan: string, extra: Parameters<typeof fixture>[0] = {}) => fixture({ status: "active", plan, trialEndsIn: 5 * 24 * HOUR, ...extra });

  it("a downgrade waits for the end of the paid period, and can be dropped to keep the current plan", async () => {
    const f = await paid("annual");
    const scheduled = await f.planChange("monthly");
    expect(scheduled.status).toBe(200);
    expect(f.gateway.scheduled).toEqual([expect.objectContaining({ subscription_id: "sub_trial", price_id: "price_tr_monthly", plan_code: "monthly", metadata: { plan_code: "monthly" } })]);
    expect(f.gateway.scheduled[0].coupon_id).toBeUndefined();
    expect(scheduled.body.data).toMatchObject({ plan_code: "annual", subscription_status: "active", scheduled_change: { plan_code: "monthly", starts_at: f.trialEnd } });
    // One waiting change at a time, and an upgrade is not possible while it waits.
    expect((await f.planChange("weekly")).body.error.details).toEqual({ reason: "plan_change_pending" });
    expect((await f.portal({ flow: "change_plan", plan_code: "monthly" })).body.error.details).toEqual({ reason: "plan_change_pending" });
    const kept = await f.keepPlan();
    expect(kept.status).toBe(200);
    expect(f.gateway.released).toEqual(["sub_trial"]);
    expect(kept.body.data).toMatchObject({ plan_code: "annual", scheduled_change: null });
    // Dropping again changes nothing.
    await f.keepPlan();
    expect(f.gateway.released).toHaveLength(1);
  });

  it("an upgrade opens Stripe's confirmation with the amount due, in the account's market", async () => {
    const f = await paid("weekly");
    const response = await f.portal({ flow: "change_plan", plan_code: "annual" });
    expect(response.status).toBe(200);
    expect(f.gateway.portals[0].flow).toEqual({ type: "subscription_update_confirm", subscription_id: "sub_trial", price_id: "price_tr_annual" });
    // Upgrades never go through the schedule; downgrades never through Stripe's confirmation.
    expect((await f.planChange("monthly")).body.error.details).toEqual({ reason: "plan_change_not_downgrade" });
    const g = await paid("annual");
    expect((await g.portal({ flow: "change_plan", plan_code: "weekly" })).body.error.details).toEqual({ reason: "plan_change_downgrade" });
    expect(g.gateway.portals).toEqual([]);
  });

  it("a trial changes plan through Stripe's confirmation (the trial is kept), never through the schedule", async () => {
    const f = await fixture();
    expect((await f.portal({ flow: "change_plan", plan_code: "monthly" })).status).toBe(200);
    expect(f.gateway.portals[0].flow).toEqual({ type: "subscription_update_confirm", subscription_id: "sub_trial", price_id: "price_tr_monthly" });
    expect((await f.planChange("weekly")).status).toBe(409);
  });

  it("refuses a plan set to end, the current plan, a renewal that is too close, and malformed requests", async () => {
    expect((await (await paid("annual", { cancelScheduled: true })).planChange("monthly")).body.error.details).toEqual({ reason: "plan_change_unavailable" });
    expect((await (await paid("monthly")).planChange("monthly")).body.error.details).toEqual({ reason: "plan_change_unavailable" });
    expect((await (await paid("monthly", { trialEndsIn: 30 * 60_000 })).planChange("weekly")).body.error.details).toEqual({ reason: "plan_change_unavailable" });
    const f = await paid("monthly");
    expect((await f.planChange("lifetime")).status).toBe(400);
    expect((await f.portal({ flow: "change_plan" })).status).toBe(400);
    expect((await f.portal({ plan_code: "weekly" })).status).toBe(400);
    expect((await f.anonymous.post("/api/v1/billing/plan-change").send({ plan_code: "weekly" })).status).toBe(401);
    expect(f.gateway.scheduled).toEqual([]);
  });

  it("shows a change as pending only before it starts", () => {
    const future = new Date(Date.now() + HOUR).toISOString();
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(pendingChange({ plan_code: "annual", scheduled_plan_code: "monthly", scheduled_change_at: future })).toEqual({ plan_code: "monthly", starts_at: future });
    // After the switch the metadata stays, but the change is done.
    expect(pendingChange({ plan_code: "monthly", scheduled_plan_code: "monthly", scheduled_change_at: past })).toBeNull();
    expect(pendingChange({ plan_code: "annual", scheduled_plan_code: "monthly", scheduled_change_at: past })).toBeNull();
    expect(pendingChange({ plan_code: "annual", scheduled_plan_code: null, scheduled_change_at: null })).toBeNull();
  });
});

describe("cancel-flow promotions in PromotionsService", () => {
  const repository = (promotion: Partial<PromotionRow> | null, failWrites = false) => ({
    activeCancelPromotion: async () => promotion && ({ id: "p", slug: "s", name: "n", percent_off: 50, plan_codes: ["monthly"], duration: "once", duration_in_months: null, replaces_trial: false, stripe_coupon_id: "c", archived_at: null, ...promotion } as PromotionRow),
    recordCancelOfferShown: async () => { if (failWrites) throw new Error("db down"); },
    recordCancelOfferDeclined: async () => { if (failWrites) throw new Error("db down"); },
    markCancelOfferAccepted: async () => { if (failWrites) throw new Error("db down"); }
  }) as unknown as PromotionsRepository;

  it("returns the promotion's single plan and coupon, and ignores a malformed one", async () => {
    expect(await new PromotionsService(repository({}), null).activeCancelPromotion("weekly")).toEqual({ id: "p", audience: "weekly", slug: "s", percent_off: 50, plan_code: "monthly", coupon_id: "c" });
    expect(await new PromotionsService(repository({ plan_codes: ["monthly", "annual"] }), null).activeCancelPromotion("trial")).toBeNull();
    expect(await new PromotionsService(repository({ plan_codes: ["lifetime"] }), null).activeCancelPromotion("trial")).toBeNull();
    expect(await new PromotionsService(repository(null), null).activeCancelPromotion("trial")).toBeNull();
  });

  it("never fails the request over a show or decline it could not record, but does over an acceptance", async () => {
    const warnings: unknown[] = [];
    const service = new PromotionsService(repository({}, true), null, { logger: { warn: (entry: unknown) => { warnings.push(entry); } } as never });
    const subject = { promotionId: "p", userId: "u", providerSubscriptionId: "sub", fromPlanCode: "weekly" };
    await expect(service.recordCancelOfferShown(subject)).resolves.toBeUndefined();
    await expect(service.recordCancelOfferDeclined("u")).resolves.toBeUndefined();
    expect(warnings).toHaveLength(2);
    await expect(service.markCancelOfferAccepted(subject)).rejects.toThrow("db down");
  });
});

describe("ending the replaced trial on the Stripe wire", () => {
  const withStripe = async (subscription: Record<string, unknown>, run: (gateway: StripeBillingGateway, requests: Array<{ method: string; path: string; body: URLSearchParams; idempotency: string | undefined }>) => Promise<void>) => {
    const requests: Array<{ method: string; path: string; body: URLSearchParams; idempotency: string | undefined }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      // stripe-node sends DELETE parameters in the query string.
      const body = new URLSearchParams(Buffer.concat(chunks).toString() || new URL(req.url!, "http://stripe.test").search);
      requests.push({ method: req.method!, path: req.url!, body, idempotency: req.headers["idempotency-key"] as string | undefined });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.method === "DELETE"
        ? { ...subscription, status: "canceled", cancellation_details: { reason: "cancellation_requested", comment: body.get("cancellation_details[comment]") } }
        : subscription));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const gateway = new StripeBillingGateway("sk_test_fixture");
      (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", { apiVersion: "2024-06-20", host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "http", maxNetworkRetries: 0 });
      await run(gateway, requests);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
  const trialing = { id: "sub_trial", object: "subscription", customer: "cus_owner", status: "trialing", cancel_at_period_end: false, trial_start: 1793800000, current_period_start: 1793800000, current_period_end: 1794070041, metadata: {}, items: { data: [{ id: "si_1", price: { id: "price_tr_weekly" } }] } };

  it("cancels at once without an invoice or proration, names the replacement, and sends no metadata update", async () => {
    await withStripe(trialing, async (gateway, requests) => {
      const summary = await gateway.cancelReplacedSubscription("sub_trial", "sub_monthly");
      // No POST: an update would send a "still trialing" webhook.
      expect(requests.map(r => `${r.method} ${r.path.split("?")[0]}`)).toEqual(["GET /v1/subscriptions/sub_trial", "DELETE /v1/subscriptions/sub_trial"]);
      const body = requests[1].body;
      expect(body.get("invoice_now")).toBe("false");
      expect(body.get("prorate")).toBe("false");
      expect(body.get("cancellation_details[comment]")).toBe("replaced_by:sub_monthly");
      expect(requests[1].idempotency).toBe("cv-replace-cancel-sub_trial-sub_monthly");
      expect(summary).toMatchObject({ id: "sub_trial", status: "canceled", replaced_by: "sub_monthly" });
    });
  });

  it("leaves an already-ended subscription alone", async () => {
    await withStripe({ ...trialing, status: "canceled" }, async (gateway, requests) => {
      await gateway.cancelReplacedSubscription("sub_trial", "sub_monthly");
      expect(requests.map(r => r.method)).toEqual(["GET"]);
    });
  });

  it("reads the replacement only from its own cancellation comment", () => {
    expect(replacedByOf({ cancellation_details: { comment: "replaced_by:sub_monthly" } })).toBe("sub_monthly");
    expect(replacedByOf({ cancellation_details: { comment: "too expensive" } })).toBeNull();
    expect(replacedByOf({ cancellation_details: { comment: "replaced_by:" } })).toBeNull();
    expect(replacedByOf({})).toBeNull();
  });
});

describe("plan changes and renewal discounts on the Stripe wire", () => {
  type Req = { method: string; path: string; body: URLSearchParams; idempotency: string | undefined };
  const withStripe = async (routes: (req: Req) => unknown, run: (gateway: StripeBillingGateway, requests: Req[]) => Promise<void>) => {
    const requests: Req[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const url = new URL(req.url!, "http://stripe.test");
      const entry = { method: req.method!, path: url.pathname, body: new URLSearchParams(Buffer.concat(chunks).toString() || url.search), idempotency: req.headers["idempotency-key"] as string | undefined };
      requests.push(entry);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(routes(entry)));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const gateway = new StripeBillingGateway("sk_test_fixture");
      (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", { apiVersion: "2024-06-20", host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "http", maxNetworkRetries: 0 });
      await run(gateway, requests);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
  const active = { id: "sub_1", object: "subscription", customer: "cus_1", status: "active", cancel_at_period_end: false, current_period_start: 1793800000, current_period_end: 1796392000,
    metadata: { app_user_id: "u1", plan_code: "annual" }, schedule: null, discount: null, discounts: [], items: { data: [{ id: "si_1", quantity: 1, price: { id: "price_annual" } }] } };
  const input = { subscription_id: "sub_1", price_id: "price_monthly", plan_code: "monthly", metadata: { plan_code: "monthly" }, idempotency_key: "cv-plan-change-sub_1" };

  it("schedules the new price from the period end, keeps the current period as it is, and records the pending change", async () => {
    await withStripe(req => {
      if (req.path === "/v1/subscription_schedules") return { id: "sub_sched_1", object: "subscription_schedule", metadata: {}, phases: [] };
      if (req.path.startsWith("/v1/subscription_schedules/")) return { id: "sub_sched_1", object: "subscription_schedule" };
      if (req.method === "POST") return { ...active, metadata: { ...active.metadata, cv_scheduled_plan_code: "monthly", cv_scheduled_change_at: "1796392000" } };
      return active;
    }, async (gateway, requests) => {
      const summary = await gateway.scheduleSubscriptionChange({ ...input, coupon_id: "coupon_weekly50" });
      expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(["GET /v1/subscriptions/sub_1", "POST /v1/subscription_schedules", "POST /v1/subscription_schedules/sub_sched_1", "POST /v1/subscriptions/sub_1"]);
      expect(requests[1].body.get("from_subscription")).toBe("sub_1");
      const phases = requests[2].body;
      expect(Object.fromEntries([...phases].filter(([key]) => !key.includes("[metadata]")))).toEqual({
        end_behavior: "release", "metadata[cv_managed]": "1",
        "phases[0][items][0][price]": "price_annual", "phases[0][items][0][quantity]": "1", "phases[0][start_date]": "1793800000", "phases[0][end_date]": "1796392000", "phases[0][proration_behavior]": "none",
        "phases[1][items][0][price]": "price_monthly", "phases[1][items][0][quantity]": "1", "phases[1][iterations]": "1", "phases[1][proration_behavior]": "none", "phases[1][discounts][0][coupon]": "coupon_weekly50"
      });
      expect(phases.get("phases[0][metadata][plan_code]")).toBe("annual");
      expect(phases.get("phases[1][metadata][plan_code]")).toBe("monthly");
      expect(phases.get("phases[1][metadata][app_user_id]")).toBe("u1");
      expect(requests[3].body.get("metadata[cv_scheduled_plan_code]")).toBe("monthly");
      expect(requests[3].body.get("metadata[cv_scheduled_change_at]")).toBe("1796392000");
      expect(requests.slice(1).map(r => r.idempotency)).toEqual(["cv-plan-change-sub_1-schedule", "cv-plan-change-sub_1-phases", "cv-plan-change-sub_1-pending"]);
      expect(summary.details).toMatchObject({ scheduled_plan_code: "monthly", scheduled_change_at: new Date(1796392000 * 1000).toISOString() });
    });
  });

  it("refuses a schedule it did not create, and a subscription that is ending or not active", async () => {
    await withStripe(req => req.path.startsWith("/v1/subscription_schedules/") ? { id: "sub_sched_x", object: "subscription_schedule", metadata: {} } : { ...active, schedule: "sub_sched_x" }, async (gateway, requests) => {
      await expect(gateway.scheduleSubscriptionChange(input)).rejects.toMatchObject({ statusCode: 409, details: { reason: "plan_change_unavailable" } });
      expect(requests.filter(r => r.method === "POST")).toEqual([]);
    });
    for (const change of [{ cancel_at_period_end: true }, { status: "trialing" }, { status: "past_due" }]) {
      await withStripe(() => ({ ...active, ...change }), async (gateway, requests) => {
        await expect(gateway.scheduleSubscriptionChange(input)).rejects.toMatchObject({ statusCode: 409 });
        await expect(gateway.applyRenewalDiscount({ subscription_id: "sub_1", coupon_id: "c", metadata: {}, idempotency_key: "k" })).rejects.toMatchObject({ statusCode: 409 });
        expect(requests.filter(r => r.method === "POST")).toEqual([]);
      });
    }
  });

  it("drops only its own pending change and clears the pending-change metadata", async () => {
    await withStripe(req => req.method === "GET"
      ? { ...active, schedule: { id: "sub_sched_1", object: "subscription_schedule", status: "active", metadata: { cv_managed: "1" } } }
      : req.path.endsWith("/release") ? { id: "sub_sched_1", object: "subscription_schedule" } : active, async (gateway, requests) => {
      await gateway.releaseScheduledChange("sub_1");
      expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(["GET /v1/subscriptions/sub_1", "POST /v1/subscription_schedules/sub_sched_1/release", "POST /v1/subscriptions/sub_1"]);
      expect(requests[2].body.get("metadata[cv_scheduled_plan_code]")).toBe("");
      expect(requests[2].body.get("metadata[cv_scheduled_change_at]")).toBe("");
    });
  });

  it("puts a once coupon on the subscription without proration, and never over an existing discount", async () => {
    await withStripe(() => active, async (gateway, requests) => {
      await gateway.applyRenewalDiscount({ subscription_id: "sub_1", coupon_id: "coupon_monthly50", metadata: { cancel_offer: "1" }, idempotency_key: "cv-cancel-offer-p-sub_1" });
      const body = requests[1].body;
      expect(body.get("discounts[0][coupon]")).toBe("coupon_monthly50");
      expect(body.get("proration_behavior")).toBe("none");
      expect(body.get("metadata[cancel_offer]")).toBe("1");
      expect(requests[1].idempotency).toBe("cv-cancel-offer-p-sub_1");
    });
    await withStripe(() => ({ ...active, discount: { coupon: { id: "flash50" } } }), async (gateway, requests) => {
      await expect(gateway.applyRenewalDiscount({ subscription_id: "sub_1", coupon_id: "c", metadata: {}, idempotency_key: "k" })).rejects.toMatchObject({ statusCode: 409 });
      expect(requests.filter(r => r.method === "POST")).toEqual([]);
    });
  });

  it("opens Stripe's plan-change confirmation for the subscription's own item", async () => {
    await withStripe(req => req.path === "/v1/billing_portal/sessions" ? { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.test/p/1" } : active, async (gateway, requests) => {
      await gateway.createPortalSession({ customer_id: "cus_1", return_url: "http://localhost/app/pricing", flow: { type: "subscription_update_confirm", subscription_id: "sub_1", price_id: "price_monthly" } });
      const body = requests.find(r => r.path === "/v1/billing_portal/sessions")!.body;
      expect(body.get("flow_data[type]")).toBe("subscription_update_confirm");
      expect(body.get("flow_data[subscription_update_confirm][subscription]")).toBe("sub_1");
      expect(body.get("flow_data[subscription_update_confirm][items][0][id]")).toBe("si_1");
      expect(body.get("flow_data[subscription_update_confirm][items][0][price]")).toBe("price_monthly");
      expect(body.get("flow_data[after_completion][redirect][return_url]")).toBe("http://localhost/app/pricing");
    });
  });

  it("reads a pending change from the subscription metadata", () => {
    expect(toSubscriptionDetails({ metadata: { cv_scheduled_plan_code: "weekly", cv_scheduled_change_at: "1796392000" } })).toMatchObject({ scheduled_plan_code: "weekly", scheduled_change_at: new Date(1796392000 * 1000).toISOString() });
    expect(toSubscriptionDetails({ metadata: { cv_scheduled_plan_code: "", cv_scheduled_change_at: "" } })).toMatchObject({ scheduled_plan_code: null, scheduled_change_at: null });
  });
});

describe("Supabase cancel-offer queries", () => {
  const fakeDb = (results: Array<{ data: unknown; error: null }>) => {
    const calls: Array<Array<[string, unknown[]]>> = [];
    const from = (table: string) => {
      const chain: Array<[string, unknown[]]> = [["from", [table]]];
      calls.push(chain);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "update", "upsert", "eq", "is", "order", "limit"]) builder[method] = (...args: unknown[]) => { chain.push([method, args]); return builder; };
      builder.maybeSingle = async () => results.shift();
      builder.then = (resolve: (value: unknown) => unknown) => resolve(results.shift());
      return builder;
    };
    return { db: { from } as never, calls };
  };

  it("selects only the newest unarchived cancel-flow promotion for the audience", async () => {
    const f = fakeDb([{ data: null, error: null }]);
    expect(await new SupabasePromotionsRepository(f.db).activeCancelPromotion("monthly")).toBeNull();
    expect(f.calls[0]).toEqual(expect.arrayContaining([["from", ["promotions"]], ["eq", ["channel", "cancel_flow"]], ["eq", ["cancel_audience", "monthly"]], ["is", ["archived_at", null]], ["order", ["created_at", { ascending: false }]], ["limit", [1]]]));
  });

  it("never rewrites an accepted offer when recording a decline or a repeat show", async () => {
    const decline = fakeDb([{ data: null, error: null }]);
    await new SupabasePromotionsRepository(decline.db).recordCancelOfferDeclined("user");
    expect(decline.calls[0]).toEqual(expect.arrayContaining([["eq", ["user_id", "user"]], ["is", ["accepted_at", null]]]));
    // Repeat show: the insert is ignored, the row is re-read, then counted.
    const shown = fakeDb([{ data: [], error: null }, { data: { show_count: 2 }, error: null }, { data: null, error: null }]);
    await new SupabasePromotionsRepository(shown.db).recordCancelOfferShown({ promotionId: "p", userId: "user", providerSubscriptionId: "sub", fromPlanCode: "weekly" });
    expect(shown.calls[0]).toEqual(expect.arrayContaining([["upsert", [expect.anything(), { onConflict: "promotion_id,user_id", ignoreDuplicates: true }]]]));
    expect(shown.calls[2]).toEqual(expect.arrayContaining([["update", [expect.objectContaining({ show_count: 3 })]], ["is", ["accepted_at", null]]]));
  });
});
