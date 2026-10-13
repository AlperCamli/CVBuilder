import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  regionalPortalParameters,
  portalMatchesPrices,
  type PortalPlanPrice,
} from "../src/modules/billing/portal-setup";

const prices: PortalPlanPrice[] = [
  { plan: "weekly", productId: "prod_weekly", priceId: "price_tr_week" },
  { plan: "monthly", productId: "prod_monthly", priceId: "price_tr_month" },
  { plan: "annual", productId: "prod_annual", priceId: "price_tr_year" },
];
describe("regional Stripe portal setup", () => {
  it("offers exactly this market's prices across the existing three products", () => {
    const result = regionalPortalParameters(
      "TR",
      prices,
      "https://app.example",
      "https://app.example/app/pricing",
    );
    expect(result.features.subscription_update).toMatchObject({
      default_allowed_updates: ["price"],
      products: [
        { product: "prod_weekly", prices: ["price_tr_week"] },
        { product: "prod_monthly", prices: ["price_tr_month"] },
        { product: "prod_annual", prices: ["price_tr_year"] },
      ],
    });
    expect(result.features.subscription_cancel?.mode).toBe("at_period_end");
    expect(result.login_page?.enabled).toBe(false);
  });
  it("groups prices when all plans share one product", () => {
    const result = regionalPortalParameters(
      "GLOBAL",
      prices.map((price) => ({ ...price, productId: "prod_shared" })),
      "https://app.example",
      "https://app.example/app/pricing",
    );
    expect(result.features.subscription_update?.products).toEqual([
      { product: "prod_shared", prices: prices.map((price) => price.priceId) },
    ]);
  });
  it("rejects inactive portals and configurations offering foreign or missing prices", () => {
    const config = {
      active: true,
      features: {
        subscription_update: {
          enabled: true,
          products: prices.map((price) => ({
            product: price.productId,
            prices: [price.priceId],
          })),
        },
      },
    } as Stripe.BillingPortal.Configuration;
    expect(portalMatchesPrices(config, prices)).toBe(true);
    expect(portalMatchesPrices({ ...config, active: false }, prices)).toBe(
      false,
    );
    config.features.subscription_update.products![0].prices.push(
      "price_us_week",
    );
    expect(portalMatchesPrices(config, prices)).toBe(false);
    config.features.subscription_update.products!.shift();
    expect(portalMatchesPrices(config, prices)).toBe(false);
  });
});
