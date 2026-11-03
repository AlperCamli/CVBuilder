import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import type { BillingPrices, RegionalPricingService } from "../src/modules/billing/regional-pricing";
import {
  StripeBillingGateway,
  type CreateStripeCheckoutInput,
  type StripeCheckoutSessionSummary,
  type StripeCustomerSummary,
  type StripeGateway,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent
} from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import type { CheckoutAttemptRow, MonetizationRepository } from "../src/modules/monetization/monetization.repository";
import { SupabasePromotionsRepository, type PromotionsRepository } from "../src/modules/promotions/promotions.repository";
import { discountedAmount, PromotionsService } from "../src/modules/promotions/promotions.service";
import type { PromotionCohortRow, PromotionRecipientRow, PromotionRow, ResolvedPromotionToken } from "../src/modules/promotions/promotions.types";
import { UsageService } from "../src/modules/usage/usage.service";
import { createTestConfig, FakeAuthProvider, InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository } from "./helpers/in-memory";

const STARTS = "2026-11-04T07:00:00.000Z";
const ENDS = "2026-11-05T07:00:00.000Z";
const at = (iso: string, offsetMs = 0) => Date.parse(iso) + offsetMs;

class InMemoryPromotionsRepository implements PromotionsRepository {
  promotion: PromotionRow = {
    id: "11111111-1111-4111-8111-111111111111", slug: "flash50-2026-11", name: "Flash sale", percent_off: 50, plan_codes: ["monthly"],
    duration: "once", duration_in_months: null, replaces_trial: true, stripe_coupon_id: "coupon_flash50", archived_at: null
  };
  cohort: PromotionCohortRow = { id: "cohort-a", key: "A", label: "10:00 Istanbul", starts_at: STARTS, ends_at: ENDS };
  readonly recipients = new Map<string, PromotionRecipientRow>();
  readonly ineligible = new Set<string>();

  add(token: string, userId: string) {
    this.recipients.set(token, { promotion_id: this.promotion.id, user_id: userId, cohort_id: this.cohort.id, first_opened_at: null, open_count: 0, redeemed_at: null, redeemed_checkout_session_id: null });
  }
  async findByToken(token: string): Promise<ResolvedPromotionToken | null> {
    const recipient = this.recipients.get(token);
    return recipient ? { recipient: { ...recipient }, promotion: { ...this.promotion }, cohort: { ...this.cohort } } : null;
  }
  async recordOpen(recipient: PromotionRecipientRow) {
    const row = [...this.recipients.values()].find(r => r.user_id === recipient.user_id && r.promotion_id === recipient.promotion_id)!;
    row.open_count += 1;
    row.first_opened_at ??= new Date().toISOString();
  }
  async isAccountIneligible(userId: string) { return this.ineligible.has(userId); }
  async markRedeemed(promotionId: string, userId: string, sessionId: string) {
    const row = [...this.recipients.values()].find(r => r.user_id === userId && r.promotion_id === promotionId);
    if (!row || row.redeemed_at) return false;
    row.redeemed_at = new Date().toISOString();
    row.redeemed_checkout_session_id = sessionId;
    return true;
  }
}

const tryPrices = (): BillingPrices => ({
  market: "TR", currency: "try", available: true, quote: "signed-quote",
  plans: [
    { code: "weekly", amount: 6990, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: 29990, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: 149990, interval: "year", interval_count: 1, trial_days: 0 }
  ]
});

describe("promotional offer resolution", () => {
  const build = (now: number) => {
    const repository = new InMemoryPromotionsRepository();
    repository.add("tok_owner", "user-1");
    const pricingCalls: Array<[string | null, string | undefined]> = [];
    const pricing = { getPrices: async (country: string | null, userId?: string) => { pricingCalls.push([country, userId]); return tryPrices(); } };
    return { repository, pricingCalls, service: new PromotionsService(repository, pricing, { now: () => now }) };
  };

  it.each([
    ["one millisecond before the cohort starts", at(STARTS, -1), "upcoming"],
    ["exactly at starts_at", at(STARTS), "active"],
    ["one millisecond before ends_at", at(ENDS, -1), "active"],
    ["exactly at ends_at", at(ENDS), "ended"]
  ] as const)("resolves the window %s", async (_label, now, status) => {
    const { service } = build(now);
    expect((await service.getOffer("tok_owner", "TR")).status).toBe(status);
  });

  it("returns invalid with no promotion or prices for an unknown token", async () => {
    const { service, pricingCalls } = build(at(STARTS));
    expect(await service.getOffer("tok_unknown", "TR")).toEqual({ status: "invalid", promotion: null, prices: null });
    expect(pricingCalls).toHaveLength(0);
  });

  it("prices only the promoted plans in the token owner's market with Stripe rounding, and never exposes the account", async () => {
    const { service, pricingCalls } = build(at(STARTS, 3600_000));
    const offer = await service.getOffer("tok_owner", "US");
    expect(offer).toEqual({
      status: "active",
      promotion: { slug: "flash50-2026-11", percent_off: 50, plan_codes: ["monthly"], duration: "once", duration_in_months: null, replaces_trial: true, starts_at: STARTS, ends_at: ENDS },
      prices: { market: "TR", currency: "try", plans: [{ code: "monthly", amount: 29990, discounted_amount: 14995 }] }
    });
    // The owner's id selects the saved market; the request country is only the fallback.
    expect(pricingCalls).toEqual([["US", "user-1"]]);
    expect(JSON.stringify(offer)).not.toMatch(/user-1|email|name|quote|coupon/);
    expect(discountedAmount(1499, 50)).toBe(749);
    expect(discountedAmount(999, 15)).toBe(849);
  });

  it("counts every open and keeps the first open time", async () => {
    const { service, repository } = build(at(STARTS));
    await service.getOffer("tok_owner", null);
    const first = repository.recipients.get("tok_owner")!.first_opened_at;
    expect(first).not.toBeNull();
    await service.getOffer("tok_owner", null);
    expect(repository.recipients.get("tok_owner")).toMatchObject({ open_count: 2, first_opened_at: first });
  });

  it("reports redeemed, ineligible and archived offers", async () => {
    const { service, repository } = build(at(STARTS));
    repository.ineligible.add("user-1");
    expect((await service.getOffer("tok_owner", null)).status).toBe("ineligible");
    repository.recipients.get("tok_owner")!.redeemed_at = "2026-11-04T08:00:00.000Z";
    expect((await service.getOffer("tok_owner", null)).status).toBe("redeemed");
    const fresh = build(at(STARTS));
    fresh.repository.promotion.archived_at = "2026-11-04T09:00:00.000Z";
    expect((await fresh.service.getOffer("tok_owner", null)).status).toBe("ended");
  });

  it("validates a checkout token for its owner, window, plan and redemption", async () => {
    const { service, repository } = build(at(STARTS));
    await expect(service.resolveForCheckout("user-1", "tok_owner", "monthly")).resolves.toEqual({
      id: repository.promotion.id, slug: "flash50-2026-11", cohort_key: "A", percent_off: 50, coupon_id: "coupon_flash50", replaces_trial: true
    });
    const detail = (promise: Promise<unknown>) => promise.then(() => null, (error: { statusCode: number; details: Record<string, unknown> }) => ({ status: error.statusCode, ...error.details }));
    expect(await detail(service.resolveForCheckout("user-1", "tok_unknown", "monthly"))).toEqual({ status: 409, reason: "promotion_unavailable", detail: "invalid" });
    expect(await detail(service.resolveForCheckout("user-2", "tok_owner", "monthly"))).toMatchObject({ detail: "wrong_account" });
    expect(await detail(service.resolveForCheckout("user-1", "tok_owner", "annual"))).toMatchObject({ detail: "plan_not_eligible" });
    expect(await detail(build(at(STARTS, -1)).service.resolveForCheckout("user-1", "tok_owner", "monthly"))).toMatchObject({ detail: "upcoming" });
    expect(await detail(build(at(ENDS)).service.resolveForCheckout("user-1", "tok_owner", "monthly"))).toMatchObject({ detail: "ended" });
    repository.recipients.get("tok_owner")!.redeemed_at = "2026-11-04T08:00:00.000Z";
    expect(await detail(service.resolveForCheckout("user-1", "tok_owner", "monthly"))).toMatchObject({ detail: "redeemed" });
  });

  it("serves GET /promotions/offer publicly and requires a token", async () => {
    const { service } = build(at(STARTS));
    const app = createApp({ config: createTestConfig(), services: { promotionsService: service } });
    const offer = await request(app).get("/api/v1/promotions/offer").query({ token: "tok_owner", utm_source: "email" });
    expect(offer.status).toBe(200);
    expect(offer.headers["cache-control"]).toBe("no-store");
    expect(offer.body.data).toMatchObject({ status: "active", prices: { currency: "try" } });
    expect((await request(app).get("/api/v1/promotions/offer").query({ token: "nope" })).body.data.status).toBe("invalid");
    expect((await request(app).get("/api/v1/promotions/offer")).status).toBe(400);
  });
});

class CapturingGateway implements StripeGateway {
  checkouts: CreateStripeCheckoutInput[] = [];
  private readonly customers = new Map<string, StripeCustomerSummary>();
  readonly subscriptions = new Map<string, StripeSubscriptionSummary>();
  async createCustomer(input: { email: string; name: string | null; metadata: Record<string, string> }) {
    const customer = { id: "cus_promo", email: input.email, name: input.name, metadata: input.metadata };
    this.customers.set(customer.id, customer);
    return customer;
  }
  async createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary> {
    this.checkouts.push(input);
    this.subscriptions.set("sub_promo", {
      id: "sub_promo", customer_id: input.customer_id, status: "active", cancel_at_period_end: false,
      current_period_start: "2026-11-04T08:00:00.000Z", current_period_end: "2026-12-04T08:00:00.000Z", metadata: input.metadata, price_ids: [input.price_id]
    });
    return { id: `cs_promo_${this.checkouts.length}`, url: "https://checkout.stripe.test/promo", customer_id: input.customer_id, subscription_id: null, metadata: input.metadata };
  }
  async createPortalSession() { return { url: "https://billing.stripe.test/portal" }; }
  constructWebhookEvent(payload: Buffer): StripeWebhookEvent {
    const parsed = JSON.parse(payload.toString("utf8")) as { id: string; type: string; data: { object: unknown } };
    return { id: parsed.id, type: parsed.type, object: parsed.data.object };
  }
  async retrieveSubscription(id: string) { return this.subscriptions.get(id) ?? null; }
  async retrieveCustomer(id: string) { return this.customers.get(id) ?? null; }
}

const promoFixture = async (options: { planCodes?: string[]; now?: number } = {}) => {
  const config = createTestConfig();
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const authProvider = new FakeAuthProvider({
    "owner-token": { auth_user_id: "auth-owner", email: "owner@example.test", full_name: "Owner", locale: "tr" },
    "other-token": { auth_user_id: "auth-other", email: "other@example.test", full_name: "Other", locale: "en" }
  });
  const owner = await usersRepository.ensureByAuthIdentity({ auth_user_id: "auth-owner", email: "owner@example.test", full_name: "Owner", locale: "tr" });
  const repository = new InMemoryPromotionsRepository();
  if (options.planCodes) repository.promotion.plan_codes = options.planCodes;
  repository.add("tok_owner", owner.id);
  const reservationKeys: string[] = [];
  const regional = {
    resolveCheckout: async (_userId: string, _country: string | null, _quote: string | undefined, plan: "weekly" | "monthly" | "annual") => {
      const amount = tryPrices().plans.find(p => p.code === plan)!.amount;
      return { priceId: `price_tr_${plan}`, market: "TR", currency: "try", amount };
    },
    reserveCheckout: async (_userId: string, key: string) => { reservationKeys.push(key); return { nonce: `nonce-${reservationKeys.length}`, expires_at: new Date(Date.now() + 31 * 60_000).toISOString() }; },
    rememberCheckout: async () => {},
    planFromPrice: (id: string) => (id.startsWith("price_tr_") ? id.slice("price_tr_".length) : null)
  } as unknown as RegionalPricingService;
  const attempts: CheckoutAttemptRow[] = [];
  const monetization = { recordCheckoutAttempt: async (row: CheckoutAttemptRow) => { attempts.push(row); }, resolveCheckoutAttempt: async () => {} } as unknown as MonetizationRepository;
  const gateway = new CapturingGateway();
  const promotionsService = new PromotionsService(repository, null, { now: () => options.now ?? at(STARTS, 60_000) });
  const billingService = new BillingService(usersRepository, subscriptionsRepository, new UsageService(new InMemoryUsageRepository()), new EntitlementsService(createPlanCatalog()), gateway, {
    provider: "stripe", regionalPricing: regional, checkoutSuccessUrl: config.billing.checkoutSuccessUrl, checkoutCancelUrl: config.billing.checkoutCancelUrl,
    portalReturnUrl: config.billing.portalReturnUrl, stripeWebhookSecret: "whsec_promo", trialPeriodDays: 3, monetization, promotions: promotionsService
  });
  const app = createApp({
    config,
    services: { authService: new AuthService(authProvider, usersRepository), billingService, promotionsService },
    serviceOverrides: { usersRepository, billingSubscriptionsRepository: subscriptionsRepository, authProvider, stripeGateway: gateway }
  });
  const checkout = (body: Record<string, unknown>, token = "owner-token") =>
    request(app).post("/api/v1/billing/checkout").set("Authorization", `Bearer ${token}`).send({ pricing_quote: "signed-quote", ...body });
  const webhook = (event: unknown) => billingService.handleWebhook(Buffer.from(JSON.stringify(event)), "t=1,v1=sig");
  return { app, owner, repository, gateway, attempts, reservationKeys, checkout, webhook, subscriptionsRepository };
};

describe("promotional checkout", () => {
  it("applies the coupon, tags the session and reports the discounted first payment", async () => {
    const f = await promoFixture();
    const response = await f.checkout({ plan_code: "monthly", promotion_token: "tok_owner" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      plan_code: "monthly", currency: "try", amount: 29990, trial_applied: false, trial_period_days: null,
      promotion: { slug: "flash50-2026-11", percent_off: 50, amount_due: 14995 }
    });
    const [input] = f.gateway.checkouts;
    expect(input.discounts).toEqual([{ coupon: "coupon_flash50" }]);
    expect(input.price_id).toBe("price_tr_monthly");
    expect(input.metadata).toMatchObject({ app_user_id: f.owner.id, plan_code: "monthly", promotion_slug: "flash50-2026-11", promotion_cohort: "A", promotion_id: f.repository.promotion.id });
    expect(f.attempts).toEqual([expect.objectContaining({ outcome: "open", checkout_session_id: "cs_promo_1", promotion_id: f.repository.promotion.id })]);
  });

  it("forces the trial off even for a trial-eligible weekly checkout, and never reports a trial change", async () => {
    const f = await promoFixture({ planCodes: ["weekly"] });
    const response = await f.checkout({ plan_code: "weekly", with_trial: true, promotion_token: "tok_owner" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ trial_applied: false, trial_period_days: null, promotion: { amount_due: 3495 } });
    expect(f.gateway.checkouts[0].trial_period_days).toBeNull();
    expect(f.gateway.checkouts[0].submit_message).toBeUndefined();
    // A user who already used a trial gets no "Trial eligibility changed" 409 for a promotional checkout.
    const g = await promoFixture({ planCodes: ["weekly"] });
    g.subscriptionsRepository.seed({ id: "prior", user_id: g.owner.id, provider: "stripe", provider_customer_id: "cus_prior", provider_subscription_id: "sub_prior", plan_code: "weekly", status: "canceled", current_period_start: "2026-01-01T00:00:00.000Z", current_period_end: "2026-01-04T00:00:00.000Z", cancel_at_period_end: false, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-04T00:00:00.000Z" });
    expect((await g.checkout({ plan_code: "weekly", promotion_token: "tok_owner" })).status).toBe(200);
    expect(g.gateway.checkouts[0].trial_period_days).toBeNull();
  });

  it("puts the coupon in the checkout reservation key and leaves regular checkouts untagged", async () => {
    const promo = await promoFixture();
    await promo.checkout({ plan_code: "monthly", promotion_token: "tok_owner" });
    const regular = await promoFixture();
    expect((await regular.checkout({ plan_code: "monthly" })).status).toBe(200);
    expect(promo.reservationKeys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(promo.reservationKeys[0]).not.toBe(regular.reservationKeys[0]);
    expect(regular.gateway.checkouts[0].discounts).toBeUndefined();
    expect(Object.keys(regular.gateway.checkouts[0].metadata).some(key => key.startsWith("promotion_"))).toBe(false);
    expect(regular.attempts[0]).not.toHaveProperty("promotion_id");
  });

  it.each([
    ["an unknown token", { promotion_token: "tok_unknown" }, "owner-token", {}, "invalid"],
    ["another account's token", { promotion_token: "tok_owner" }, "other-token", {}, "wrong_account"],
    ["a plan outside plan_codes", { promotion_token: "tok_owner", plan_code: "annual" }, "owner-token", {}, "plan_not_eligible"],
    ["a cohort that has not started", { promotion_token: "tok_owner" }, "owner-token", { now: at(STARTS, -1) }, "upcoming"],
    ["a cohort that has ended", { promotion_token: "tok_owner" }, "owner-token", { now: at(ENDS) }, "ended"]
  ] as const)("refuses %s with 409 promotion_unavailable and creates no session", async (_label, body, token, options, detail) => {
    const f = await promoFixture(options);
    const response = await f.checkout({ plan_code: "monthly", ...body }, token);
    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual({ reason: "promotion_unavailable", detail });
    expect(f.gateway.checkouts).toHaveLength(0);
    expect(f.reservationKeys).toHaveLength(0);
  });

  it("redeems once from checkout.session.completed and then refuses the token", async () => {
    const f = await promoFixture();
    await f.checkout({ plan_code: "monthly", promotion_token: "tok_owner" });
    const metadata = f.gateway.checkouts[0].metadata;
    const completed = (id: string, session: string) => ({ id, type: "checkout.session.completed", data: { object: { id: session, mode: "subscription", customer: "cus_promo", subscription: "sub_promo", metadata } } });
    expect((await f.webhook(completed("evt_1", "cs_promo_1"))).processed).toBe(true);
    const redeemed = f.repository.recipients.get("tok_owner")!;
    expect(redeemed).toMatchObject({ redeemed_checkout_session_id: "cs_promo_1" });
    const redeemedAt = redeemed.redeemed_at;
    expect(redeemedAt).not.toBeNull();
    // A replayed or second completion keeps the first redemption.
    await f.webhook(completed("evt_1", "cs_promo_1"));
    await f.webhook(completed("evt_2", "cs_promo_other"));
    expect(f.repository.recipients.get("tok_owner")).toMatchObject({ redeemed_at: redeemedAt, redeemed_checkout_session_id: "cs_promo_1" });
    // Sessions without a promotion do not touch recipients.
    const { promotion_id: _id, ...plain } = metadata;
    await f.webhook({ id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_plain", mode: "subscription", customer: "cus_promo", subscription: "sub_promo", metadata: plain } } });
    expect(f.repository.recipients.get("tok_owner")!.redeemed_checkout_session_id).toBe("cs_promo_1");
  });

  it("refuses an already redeemed token at checkout", async () => {
    const f = await promoFixture();
    f.repository.recipients.get("tok_owner")!.redeemed_at = "2026-11-04T08:00:00.000Z";
    const response = await f.checkout({ plan_code: "monthly", promotion_token: "tok_owner" });
    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual({ reason: "promotion_unavailable", detail: "redeemed" });
  });
});

describe("promotional checkout on the Stripe wire", () => {
  it("sends discounts and the promotion metadata on the session and the subscription", async () => {
    const bodies: URLSearchParams[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.push(new URLSearchParams(Buffer.concat(chunks).toString()));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_promo", object: "checkout.session", url: "https://checkout.stripe.test/promo", customer: "cus_promo", subscription: null, metadata: {} }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const gateway = new StripeBillingGateway("sk_test_fixture");
      (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", { apiVersion: "2024-06-20", host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "http", maxNetworkRetries: 0 });
      const metadata = { app_user_id: "owner", promotion_slug: "flash50-2026-11", promotion_cohort: "A", promotion_id: "promo-id" };
      await gateway.createCheckoutSession({ customer_id: "cus_promo", price_id: "price_tr_monthly", success_url: "http://localhost/ok", cancel_url: "http://localhost/cancel", client_reference_id: "owner", metadata, trial_period_days: null, discounts: [{ coupon: "coupon_flash50" }] });
      expect(bodies[0].get("discounts[0][coupon]")).toBe("coupon_flash50");
      expect(bodies[0].has("subscription_data[trial_period_days]")).toBe(false);
      for (const [key, value] of Object.entries(metadata)) {
        expect(bodies[0].get(`metadata[${key}]`)).toBe(value);
        expect(bodies[0].get(`subscription_data[metadata][${key}]`)).toBe(value);
      }
      await gateway.createCheckoutSession({ customer_id: "cus_promo", price_id: "price_tr_monthly", success_url: "http://localhost/ok", cancel_url: "http://localhost/cancel", client_reference_id: "owner", metadata: { app_user_id: "owner" } });
      expect([...bodies[1].keys()].some(key => key.startsWith("discounts"))).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

describe("Supabase promotions repository", () => {
  // Records each query chain; every chain resolves to the next queued result.
  const fakeDb = (results: Array<{ data: unknown; error: null }>) => {
    const calls: Array<Array<[string, unknown[]]>> = [];
    const from = (table: string) => {
      const chain: Array<[string, unknown[]]> = [["from", [table]]];
      calls.push(chain);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "update", "eq", "is", "in", "neq", "limit"]) builder[method] = (...args: unknown[]) => { chain.push([method, args]); return builder; };
      builder.maybeSingle = async () => results.shift();
      builder.then = (resolve: (value: unknown) => unknown) => resolve(results.shift());
      return builder;
    };
    return { db: { from } as never, calls };
  };

  it("redeems only an unredeemed recipient and increments opens with compare-and-set", async () => {
    const redeem = fakeDb([{ data: [], error: null }]);
    expect(await new SupabasePromotionsRepository(redeem.db).markRedeemed("promo", "user", "cs_1")).toBe(false);
    expect(redeem.calls[0]).toEqual(expect.arrayContaining([["eq", ["promotion_id", "promo"]], ["eq", ["user_id", "user"]], ["is", ["redeemed_at", null]]]));
    // The first compare-and-set loses a race; the re-read count is used for the second.
    const open = fakeDb([{ data: [], error: null }, { data: { open_count: 4, first_opened_at: "2026-11-04T07:30:00.000Z" }, error: null }, { data: [{ open_count: 5 }], error: null }]);
    await new SupabasePromotionsRepository(open.db).recordOpen({ promotion_id: "promo", user_id: "user", cohort_id: "c", first_opened_at: null, open_count: 3, redeemed_at: null, redeemed_checkout_session_id: null });
    expect(open.calls[0]).toEqual(expect.arrayContaining([["eq", ["open_count", 3]]]));
    expect(open.calls[2]).toEqual(expect.arrayContaining([["update", [{ open_count: 5, first_opened_at: "2026-11-04T07:30:00.000Z" }]], ["eq", ["open_count", 4]]]));
  });
});
