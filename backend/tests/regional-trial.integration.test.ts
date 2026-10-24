import { createHash, createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import request from "supertest";
import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import { RegionalPricingService, type BillingMarket, type PurchasePlan } from "../src/modules/billing/regional-pricing";
import { StripeBillingGateway } from "../src/modules/billing/stripe-gateway";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { UsageService } from "../src/modules/usage/usage.service";
import { createTestConfig, FakeAuthProvider, InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository } from "./helpers/in-memory";

const secret = "regional-trial-test-secret-at-least-32-characters";
const authorization = "Bearer valid-token";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())); });

// Exercise the real HTTP routes, signed geography, pricing service, billing
// service and Stripe SDK. Only Stripe's remote server and database are fakes;
// no real customer, checkout, subscription or payment can be created.
async function fixture(country: "TR" | "US", trialDays = 3) {
  const prices = {
    GLOBAL: { weekly: "price_us_week", monthly: "price_us_month", annual: "price_us_year" },
    TR: { weekly: "price_tr_week", monthly: "price_tr_month", annual: "price_tr_year" }
  };
  const amounts = { GLOBAL: { weekly: 499, monthly: 1499, annual: 9999 }, TR: { weekly: 6990, monthly: 24900, annual: 149990 } };
  const markets = new Map<string, BillingMarket>();
  const checkouts: Array<{ body: URLSearchParams; idempotencyKey: string | undefined }> = [];
  let checkoutUserId = "";
  let checkoutPriceId = "";
  const subscription = () => ({
    id: "sub_trial", object: "subscription", customer: "cus_trial", status: "trialing",
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 3 * 86400,
    cancel_at_period_end: false,
    metadata: { app_user_id: checkoutUserId, plan_code: "weekly" },
    items: { data: [{ price: { id: checkoutPriceId } }] }
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    let payload: unknown;
    if (url.pathname.startsWith("/v1/prices/")) {
      const id = url.pathname.split("/").at(-1)!;
      const market = id.includes("_tr_") ? "TR" : "GLOBAL";
      const plan = (Object.keys(prices[market]) as PurchasePlan[]).find(plan => prices[market][plan] === id)!;
      payload = { id, object: "price", active: true, product: `prod_${plan}`, currency: market === "TR" ? "try" : "usd", unit_amount: amounts[market][plan], recurring: { interval: { weekly: "week", monthly: "month", annual: "year" }[plan], interval_count: 1 } };
    } else if (url.pathname.startsWith("/v1/billing_portal/configurations/")) {
      const market = url.pathname.endsWith("bpc_tr") ? "TR" : "GLOBAL";
      payload = { id: `bpc_${market}`, object: "billing_portal.configuration", active: true, features: { subscription_update: { enabled: true, products: [{ product: "prod_weekly", prices: Object.values(prices[market]) }] } } };
    } else if (url.pathname === "/v1/customers" && req.method === "POST") {
      checkoutUserId = body.get("metadata[app_user_id]")!;
      payload = { id: "cus_trial", object: "customer", email: body.get("email"), metadata: { app_user_id: checkoutUserId } };
    } else if (url.pathname === "/v1/customers/cus_trial") {
      payload = { id: "cus_trial", object: "customer", metadata: { app_user_id: checkoutUserId } };
    } else if (url.pathname === "/v1/subscriptions") {
      payload = { object: "list", data: [], has_more: false, url: "/v1/subscriptions" };
    } else if (url.pathname === "/v1/subscriptions/sub_trial") {
      payload = subscription();
    } else if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
      checkouts.push({ body, idempotencyKey: req.headers["idempotency-key"] as string | undefined });
      checkoutPriceId = body.get("line_items[0][price]")!;
      payload = { id: "cs_test_trial", object: "checkout.session", url: "https://checkout.stripe.test/trial", customer: "cus_trial", subscription: null, metadata: { app_user_id: checkoutUserId } };
    } else {
      res.statusCode = 404;
      payload = { error: { message: `Unexpected Stripe request: ${req.method} ${url.pathname}` } };
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const gateway = new StripeBillingGateway("sk_test_fixture");
  (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", {
    apiVersion: "2024-06-20", host: "127.0.0.1", port: (server.address() as AddressInfo).port,
    protocol: "http", maxNetworkRetries: 0, timeout: 2000
  });
  const db = {
    from: () => ({
      select: () => ({ eq: (_: string, userId: string) => ({ maybeSingle: async () => ({ data: markets.has(userId) ? { market: markets.get(userId) } : null, error: null }) }) }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) })
    }),
    rpc: async (name: string, args: { p_user_id: string; p_market?: BillingMarket }) => {
      if (name === "lock_billing_market") {
        if (!markets.has(args.p_user_id)) markets.set(args.p_user_id, args.p_market!);
        return { data: markets.get(args.p_user_id), error: null };
      }
      if (name === "reserve_billing_checkout") return { data: { nonce: "regional-trial-reservation", expires_at: new Date(Date.now() + 31 * 60000).toISOString() }, error: null };
      throw new Error(`Unexpected database RPC: ${name}`);
    }
  } as unknown as SupabaseClient;
  const regional = new RegionalPricingService(db, gateway, {
    secret, productIds: { weekly: "prod_weekly", monthly: "prod_monthly", annual: "prod_annual" },
    prices, portals: { GLOBAL: "bpc_us", TR: "bpc_tr" }, trialDays
  });
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const usageRepository = new InMemoryUsageRepository();
  const config = createTestConfig();
  config.appEnv = "staging"; // Require the same signed geo headers as production.
  config.billing.geoSecret = secret;
  const billingService = new BillingService(usersRepository, subscriptionsRepository, new UsageService(usageRepository), new EntitlementsService(createPlanCatalog()), gateway, {
    provider: "stripe", regionalPricing: regional, checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
    checkoutCancelUrl: config.billing.checkoutCancelUrl, portalReturnUrl: config.billing.portalReturnUrl,
    stripeWebhookSecret: "whsec_regional_trial", trialPeriodDays: trialDays
  });
  const authProvider = new FakeAuthProvider({ "valid-token": { auth_user_id: "regional-trial-user", email: "trial@example.test", full_name: "Trial Test", locale: country === "TR" ? "tr" : "en" } });
  const app = createApp({ config, services: { authService: new AuthService(authProvider, usersRepository), billingService }, serviceOverrides: { usersRepository, billingSubscriptionsRepository: subscriptionsRepository, usageRepository, authProvider, stripeGateway: gateway } });
  const headers = (method: string, path: string) => {
    const encoded = Buffer.from(JSON.stringify({ country, expires: Math.floor(Date.now() / 1000) + 60, method, path, authorization: createHash("sha256").update(authorization).digest("hex") })).toString("base64url");
    return { Authorization: authorization, "x-cv-geo-context": encoded, "x-cv-geo-signature": createHmac("sha256", secret).update(encoded).digest("hex") };
  };
  const get = (path: string) => request(app).get(path).set(headers("GET", path));
  const checkout = (input: Record<string, unknown>) => request(app).post("/api/v1/billing/checkout").set(headers("POST", "/api/v1/billing/checkout")).send(input);
  const webhook = (event: unknown) => {
    const payload = JSON.stringify(event);
    return request(app).post("/api/v1/billing/webhooks").set("Content-Type", "application/json").set("stripe-signature", Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_regional_trial" })).send(payload);
  };
  return { app, get, checkout, webhook, subscription, prices, amounts, markets, checkouts, usersRepository, subscriptionsRepository };
}

describe("regional free trial through HTTP and the Stripe SDK", () => {
  it.each(["TR", "US"] as const)("preserves the three-day trial with %s pricing and unlocks access after signed checkout completion", async country => {
    const f = await fixture(country);
    const market = country === "TR" ? "TR" : "GLOBAL";
    const currency = country === "TR" ? "try" : "usd";
    const before = await f.get("/api/v1/billing/plan");
    expect(before.body.data).toMatchObject({ plan_code: "free", trial_eligible: true });
    const prices = await f.get("/api/v1/billing/prices");
    expect(prices.status).toBe(200);
    expect(prices.body.data).toMatchObject({ available: true, market, currency });
    expect(prices.body.data.plans.find((p: { code: string }) => p.code === "weekly")).toMatchObject({ trial_days: 3, amount: f.amounts[market].weekly });
    const checkout = await f.checkout({ plan_code: "weekly", pricing_quote: prices.body.data.quote });
    expect(checkout.status).toBe(200);
    expect(checkout.body.data).toMatchObject({ plan_code: "weekly", currency, amount: f.amounts[market].weekly, trial_applied: true, trial_period_days: 3 });
    expect(f.checkouts).toHaveLength(1);
    const { body, idempotencyKey } = f.checkouts[0];
    expect(body.get("line_items[0][price]")).toBe(f.prices[market].weekly);
    expect(body.get("currency")).toBe(currency);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("subscription_data[trial_period_days]")).toBe("3");
    expect(body.get("subscription_data[metadata][billing_market]")).toBe(market);
    expect(body.get("locale")).toBe(country === "TR" ? "tr" : "en");
    expect(idempotencyKey).toBe("regional-trial-reservation");
    // Creating a session alone must not grant Pro access.
    expect((await f.get("/api/v1/billing/plan")).body.data.plan_code).toBe("free");
    const completed = await f.webhook({ id: "evt_trial_checkout_completed", type: "checkout.session.completed", data: { object: { id: "cs_test_trial", mode: "subscription", customer: "cus_trial", subscription: "sub_trial", metadata: f.subscription().metadata } } });
    expect(completed.status).toBe(200);
    expect(completed.body.data.processed).toBe(true);
    const after = await f.get("/api/v1/billing/plan");
    expect(after.body.data).toMatchObject({ plan_code: "weekly", subscription_status: "trialing", trial_eligible: false });
    const end = Date.parse(after.body.data.current_period_end);
    expect(end - Date.now()).toBeGreaterThan(3 * 86400000 - 10000);
    const usage = await f.get("/api/v1/billing/usage");
    expect(usage.body.data.limits).toMatchObject({ exports: null, tailored_cv_generations: null, ai_actions: null });
    const duplicate = await f.checkout({ plan_code: "weekly", pricing_quote: prices.body.data.quote });
    expect(duplicate.status).toBe(409);
    expect(f.checkouts).toHaveLength(1);
    const canceled = await f.webhook({ id: "evt_trial_canceled", type: "customer.subscription.deleted", data: { object: { ...f.subscription(), status: "canceled" } } });
    expect(canceled.status).toBe(200);
    expect((await f.get("/api/v1/billing/plan")).body.data).toMatchObject({ plan_code: "free", trial_eligible: false });
    const repeated = await f.checkout({ plan_code: "weekly", pricing_quote: prices.body.data.quote });
    expect(repeated.status).toBe(409);
    expect(f.checkouts).toHaveLength(1);
  });

  it.each(["monthly", "annual"] as const)("does not accidentally grant a trial to regional %s checkout", async plan => {
    const f = await fixture("TR");
    const prices = await f.get("/api/v1/billing/prices");
    const checkout = await f.checkout({ plan_code: plan, pricing_quote: prices.body.data.quote, with_trial: true });
    expect(checkout.status).toBe(200);
    expect(checkout.body.data).toMatchObject({ plan_code: plan, currency: "try", trial_applied: false, trial_period_days: null });
    expect(f.checkouts[0].body.get("line_items[0][price]")).toBe(f.prices.TR[plan]);
    expect(f.checkouts[0].body.has("subscription_data[trial_period_days]")).toBe(false);
  });

  it("requires explicit paid consent when trials are disabled", async () => {
    const f = await fixture("TR", 0);
    expect((await f.get("/api/v1/billing/plan")).body.data.trial_eligible).toBe(false);
    const prices = await f.get("/api/v1/billing/prices");
    const rejected = await f.checkout({ plan_code: "weekly", pricing_quote: prices.body.data.quote });
    expect(rejected.status).toBe(409);
    expect(f.checkouts).toHaveLength(0);
    const paid = await f.checkout({ plan_code: "weekly", pricing_quote: prices.body.data.quote, with_trial: false });
    expect(paid.status).toBe(200);
    expect(paid.body.data.trial_applied).toBe(false);
    expect(f.checkouts[0].body.has("subscription_data[trial_period_days]")).toBe(false);
  });

  it("rejects an anonymous price quote and unsigned geographic headers before creating a trial", async () => {
    const f = await fixture("TR");
    const authenticated = await f.get("/api/v1/billing/prices");
    const encoded = authenticated.body.data.quote.split(".")[0];
    const payload = { ...JSON.parse(Buffer.from(encoded, "base64url").toString()), subject: null };
    const changed = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const quote = `${changed}.${createHmac("sha256", secret).update(changed).digest("hex")}`;
    expect((await f.checkout({ plan_code: "weekly", pricing_quote: quote })).status).toBe(409);
    expect((await request(f.app).get("/api/v1/billing/prices").set("Authorization", authorization)).status).toBe(403);
    expect(f.checkouts).toHaveLength(0);
  });
});
