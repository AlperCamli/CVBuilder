import Stripe from "stripe";
import type { BillingMarket, PurchasePlan } from "./regional-pricing";

export interface PortalPlanPrice {
  plan: PurchasePlan;
  productId: string;
  priceId: string;
}

/** Works with either one shared product or three existing plan products. */
export function regionalPortalParameters(
  market: BillingMarket,
  prices: PortalPlanPrice[],
  appOrigin: string,
  returnUrl: string,
): Stripe.BillingPortal.ConfigurationCreateParams {
  const grouped = new Map<string, string[]>();
  for (const price of prices) {
    grouped.set(price.productId, [
      ...(grouped.get(price.productId) ?? []),
      price.priceId,
    ]);
  }
  return {
    business_profile: {
      headline: "JobSpecificCV",
      privacy_policy_url: `${appOrigin}/privacy`,
    },
    default_return_url: returnUrl,
    login_page: { enabled: false },
    metadata: {
      integration: "cv-builder-regional-pricing-v1",
      billing_market: market,
    },
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ["name", "email", "address"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: [...grouped].map(([product, allowedPrices]) => ({
          product,
          prices: allowedPrices,
        })),
      },
    },
  };
}

export function portalMatchesPrices(
  configuration: Stripe.BillingPortal.Configuration,
  prices: PortalPlanPrice[],
): boolean {
  if (!configuration.active) return false;
  if (!configuration.features.subscription_update.enabled) return true;
  const expected = new Set(prices.map((price) => price.priceId));
  const configured = (
    configuration.features.subscription_update.products ?? []
  ).flatMap((product) => product.prices);
  return (
    configured.length === expected.size &&
    new Set(configured).size === expected.size &&
    configured.every((id) => expected.has(id))
  );
}
