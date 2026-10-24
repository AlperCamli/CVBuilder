import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n, localeCode, translate as t } from "../localization/i18n";
import { integrationConfig } from "./config";
import { createApiClient } from "./api-client";
import {
  PLAN_CARDS,
  type CheckoutTarget,
  type PlanCard,
} from "../../content/pricing";

export interface BillingPrices {
  market: "TR" | "GLOBAL";
  currency: "try" | "usd";
  available: boolean;
  quote: string | null;
  plans: Array<{
    code: CheckoutTarget;
    amount: number;
    interval: "week" | "month" | "year";
    interval_count: number;
    trial_days: number;
  }>;
}
export function isBillingPrices(value: unknown): value is BillingPrices {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<BillingPrices>;
  if (
    !["TR", "GLOBAL"].includes(String(data.market)) ||
    !["try", "usd"].includes(String(data.currency)) ||
    typeof data.available !== "boolean" ||
    !Array.isArray(data.plans)
  )
    return false;
  if (data.quote !== null && typeof data.quote !== "string") return false;
  if (
    data.available &&
    (!data.quote ||
      data.plans.length !== 3 ||
      new Set(data.plans.map((plan) => plan?.code)).size !== 3)
  )
    return false;
  return data.plans.every(
    (plan) =>
      plan &&
      ["weekly", "monthly", "annual"].includes(plan.code) &&
      Number.isSafeInteger(plan.amount) &&
      plan.amount > 0 &&
      plan.interval ===
        ({ weekly: "week", monthly: "month", annual: "year" } as const)[
          plan.code
        ] &&
      plan.interval_count === 1 &&
      Number.isSafeInteger(plan.trial_days) &&
      plan.trial_days >= 0,
  );
}
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(localeCode(), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}
export function regionalCards(prices: BillingPrices | null): PlanCard[] {
  return PLAN_CARDS.map((card) => {
    if (card.code === "trial")
      return {
        ...card,
        name: t("3-day free trial"),
        weeklyPrice: prices ? formatMoney(0, prices.currency) : "0",
        totalPrice: prices?.available && prices.plans.some(p => p.code === "weekly") ? t("After 3 days, {{amount}} billed weekly unless cancelled.", { amount: formatMoney(prices.plans.find(p => p.code === "weekly")!.amount, prices.currency) }) : t("Card required to activate. Renewal terms confirmed at checkout."),
        billingPeriod: t("3 days"),
        description: t(card.description),
        features: card.features.map((f) => t(f)),
      };
    const plan = prices?.plans.find((p) => p.code === card.code);
    const weekly = plan
      ? Math.round(
          plan.amount *
            (plan.code === "monthly"
              ? 12 / 52
              : plan.code === "annual"
                ? 1 / 52
                : 1),
        )
      : null;
    const base = prices?.plans.find((p) => p.code === "weekly")?.amount;
    return {
      ...card,
      name: t(card.name),
      weeklyPrice:
        weekly !== null ? formatMoney(weekly, prices!.currency) : "—",
      totalPrice: plan
        ? `${formatMoney(plan.amount, prices!.currency)} ${t(plan.code === "annual" ? "billed annually" : plan.code === "monthly" ? "billed monthly" : "billed weekly")}`
        : "—",
      billingPeriod: t("per week"),
      description: t(card.description),
      features: card.features.map((f) => t(f)),
      badge: card.badge ? t(card.badge) : undefined,
      savings:
        base && weekly !== null && weekly < base && plan?.code !== "weekly"
          ? t("Save {{percent}}% vs weekly", {
              percent: Math.round((1 - weekly / base) * 100),
            })
          : undefined,
    };
  });
}
export function rememberDisplayedPrices(prices: BillingPrices) {
  try {
    sessionStorage.setItem(
      "cv-displayed-prices",
      JSON.stringify({
        market: prices.market,
        currency: prices.currency,
        plans: prices.plans,
      }),
    );
  } catch {
    /* checkout still validates on server */
  }
}
export function previouslyDisplayedPrices(): string | null {
  try {
    return sessionStorage.getItem("cv-displayed-prices");
  } catch {
    return null;
  }
}
export function useRegionalPricing() {
  useTranslation();
  const [prices, setPrices] = useState<BillingPrices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = createApiClient({
        baseUrl: integrationConfig.apiBaseUrl,
        getAccessToken: async () => {
          const { supabase } = await import("./supabase-client");
          return (
            (await supabase.auth.getSession()).data.session?.access_token ??
            null
          );
        },
      });
      const data = await client.get<unknown>("/billing/prices");
      if (!isBillingPrices(data)) throw new Error("Invalid pricing response");
      setPrices(data);
      if (data.available) rememberDisplayedPrices(data);
    } catch {
      setError("Pricing is temporarily unavailable");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return {
    prices,
    cards: regionalCards(prices),
    loading,
    error: error ? t(error) : null,
    retry: load,
    ready: Boolean(prices?.available && prices.quote),
    locale: i18n.language,
  };
}
