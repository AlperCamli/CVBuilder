import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import type { Request } from "express";
import { verifyGeoContext } from "../src/modules/billing/geo-context";
import { RegionalPricingService, type RegionalPricingOptions } from "../src/modules/billing/regional-pricing";
import type { StripeGateway } from "../src/modules/billing/stripe-gateway";

const secret = "test-secret-with-more-than-thirty-two-characters";
const options: RegionalPricingOptions = {
  secret, productId: "prod_cv", trialDays: 3,
  prices: { GLOBAL: { weekly: "price_us_week", monthly: "price_us_month", annual: "price_us_year" }, TR: { weekly: "price_tr_week", monthly: "price_tr_month", annual: "price_tr_year" } },
  portals: { GLOBAL: "bpc_us", TR: "bpc_tr" }, historicalPrices: { price_old_month: "monthly" }
};
function fixture() {
  const markets = new Map<string, string>();
  const db = {
    from: () => ({ select: () => ({ eq: (_: string, user: string) => ({ maybeSingle: async () => ({ data: markets.has(user) ? { market: markets.get(user) } : null, error: null }) }) }) }),
    rpc: vi.fn(async (_: string, args: { p_user_id: string; p_market: string }) => {
      if (!markets.has(args.p_user_id)) markets.set(args.p_user_id, args.p_market);
      return { data: markets.get(args.p_user_id), error: null };
    })
  };
  const gateway = {
    retrievePrice: vi.fn(async (id: string) => ({ id, active: true, product_id: "prod_cv", currency: id.includes("_tr_") ? "try" : "usd", amount: id.endsWith("week") ? 499 : id.endsWith("month") ? 1499 : 9990, interval: id.split("_").at(-1), interval_count: 1 })),
    retrievePortalConfiguration: vi.fn(async (id: string) => ({ active: true, updates_enabled: true, price_ids: Object.values(options.prices[id === "bpc_tr" ? "TR" : "GLOBAL"]) }))
  };
  return { markets, db, gateway, service: new RegionalPricingService(db as any, gateway as unknown as StripeGateway, structuredClone(options)) };
}
afterEach(() => vi.useRealTimers());

describe("trusted country context", () => {
  function request(changes: { country?: string; expires?: number; authorization?: string; path?: string; signature?: string } = {}) {
    const authorization = changes.authorization ?? "Bearer user-token";
    const payload = Buffer.from(JSON.stringify({ country: changes.country ?? "TR", expires: changes.expires ?? Math.floor(Date.now() / 1000) + 60, method: "POST", path: "/api/v1/billing/checkout", authorization: createHash("sha256").update("Bearer user-token").digest("hex") })).toString("base64url");
    const headers: Record<string, string> = { authorization, "x-cv-geo-context": payload, "x-cv-geo-signature": changes.signature ?? createHmac("sha256", secret).update(payload).digest("hex") };
    return { method: "POST", originalUrl: changes.path ?? "/api/v1/billing/checkout", header: (key: string) => headers[key] } as Request;
  }
  it("accepts a valid signed context and rejects forged, expired, or differently bound contexts", () => {
    expect(verifyGeoContext(request(), secret, true)).toBe("TR");
    for (const change of [{ signature: "0".repeat(64) }, { expires: 1 }, { authorization: "Bearer another-token" }, { path: "/api/v1/billing/prices" }]) expect(() => verifyGeoContext(request(change), secret, true)).toThrow();
    expect(() => verifyGeoContext(request(), null, true)).toThrow();
  });
  it("uses only the server fixture outside production", () => {
    expect(verifyGeoContext(request({ country: "TR" }), null, false, "US")).toBe("US");
  });
});

describe("regional pricing and immutable markets", () => {
  it("selects TRY for Turkey, USD for other/unknown countries, and prefers saved markets", async () => {
    const { service, markets } = fixture();
    expect((await service.getPrices("TR")).currency).toBe("try");
    expect((await service.getPrices(null)).currency).toBe("usd");
    markets.set("existing", "GLOBAL");
    expect((await service.getPrices("TR", "existing")).currency).toBe("usd");
    markets.set("turkish", "TR");
    expect((await service.getPrices("US", "turkish")).currency).toBe("try");
  });
  it("requires an authentic account-bound quote and resolves the Price ID on the server", async () => {
    const { service } = fixture();
    const quote = (await service.getPrices("TR", "u1")).quote!;
    expect(await service.resolveCheckout("u1", "TR", quote, "monthly")).toMatchObject({ priceId: "price_tr_month", market: "TR", currency: "try", amount: 1499 });
    expect(await service.resolveCheckout("u1", "US", quote, "weekly")).toMatchObject({ priceId: "price_tr_week" });
    await expect(service.resolveCheckout("u2", "TR", quote, "monthly")).rejects.toThrow("Pricing changed");
    await expect(service.resolveCheckout("u1", "TR", quote.replace(".", "x."), "monthly")).rejects.toThrow();
  });
  it("supports existing separate weekly, monthly and annual products in both markets", async () => {
    const { service, gateway } = fixture();
    service.options.productId = null;
    service.options.productIds = { weekly: "prod_weekly", monthly: "prod_monthly", annual: "prod_annual" };
    gateway.retrievePrice.mockImplementation(async id => ({ id, active: true, product_id: id.endsWith("week") ? "prod_weekly" : id.endsWith("month") ? "prod_monthly" : "prod_annual", currency: id.includes("_tr_") ? "try" : "usd", amount: 1000, interval: id.split("_").at(-1), interval_count: 1 }));
    expect((await service.getPrices("TR")).available).toBe(true);
    expect((await service.getPrices("US")).available).toBe(true);
    const quote = (await service.getPrices("TR", "u1")).quote!;
    expect(await service.resolveCheckout("u1", "TR", quote, "monthly")).toMatchObject({ priceId: "price_tr_month", currency: "try" });
  });
  it("rejects a plan price attached to a different plan's product", async () => {
    const { service, gateway } = fixture();
    service.options.productId = null;
    service.options.productIds = { weekly: "prod_weekly", monthly: "prod_monthly", annual: "prod_annual" };
    gateway.retrievePrice.mockImplementation(async id => ({ id, active: true, product_id: "prod_monthly", currency: "try", amount: 1000, interval: id.split("_").at(-1), interval_count: 1 }));
    expect(await service.getPrices("TR")).toMatchObject({ available: false, quote: null, plans: [] });
  });
  it("rejects changed and expired price quotes", async () => {
    vi.useFakeTimers();
    const { service, gateway } = fixture();
    const quote = (await service.getPrices("TR", "u1")).quote!;
    gateway.retrievePrice.mockImplementation(async id => ({ id, active: true, product_id: "prod_cv", currency: "try", amount: 2000, interval: id.split("_").at(-1), interval_count: 1 }));
    await expect(service.resolveCheckout("u1", "TR", quote, "monthly")).rejects.toThrow("Pricing changed");
    vi.advanceTimersByTime(16 * 60_000);
    await expect(service.resolveCheckout("u1", "TR", quote, "monthly")).rejects.toThrow("Pricing changed");
  });
  it("never falls back to USD when Turkey configuration or Stripe prices are invalid", async () => {
    const { service, gateway } = fixture();
    service.options.prices.TR.monthly = null;
    expect(await service.getPrices("TR")).toMatchObject({ market: "TR", currency: "try", available: false, plans: [] });
    service.options.prices.TR.monthly = "price_tr_month";
    gateway.retrievePrice.mockImplementation(async id => ({ id, active: true, product_id: "wrong_product", currency: "usd", amount: 1, interval: "month", interval_count: 1 }));
    expect((await service.getPrices("TR")).available).toBe(false);
  });
  it("disables pricing if the portal exposes a foreign market price", async () => {
    const { service, gateway, markets } = fixture();
    markets.set("u1", "TR");
    gateway.retrievePortalConfiguration.mockResolvedValue({ active: true, updates_enabled: true, price_ids: ["price_tr_week", "price_tr_month", "price_tr_year", "price_us_week"] });
    expect((await service.getPrices("TR")).available).toBe(false);
    await expect(service.portal("u1")).rejects.toThrow("Billing portal configuration is invalid");
  });
  it("does not change a market when concurrent first checkouts disagree", async () => {
    const { service, markets } = fixture();
    const tr = (await service.getPrices("TR", "u1")).quote!;
    const us = (await service.getPrices("US", "u1")).quote!;
    const outcomes = await Promise.allSettled([service.resolveCheckout("u1", "TR", tr, "weekly"), service.resolveCheckout("u1", "US", us, "weekly")]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(markets.get("u1")).toBe("TR");
    expect(service.planFromPrice("price_old_month")).toBe("monthly");
  });
});
