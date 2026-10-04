import { PLAN_VALUE_USD, type CheckoutTarget } from "../../../content/pricing";

const PAYMENTS_PER_YEAR: Record<CheckoutTarget, number> = {
  weekly: 52,
  monthly: 12,
  annual: 1,
};

/** Comparison only: checkout still charges the full selected billing period. */
export function weeklyPriceComparison(period: CheckoutTarget) {
  const equivalent = PLAN_VALUE_USD[period] * (PAYMENTS_PER_YEAR[period] / 52);
  // Compare the displayed cent-rounded rates, matching public pricing. This
  // keeps the percentage and weekly saving consistent with the visible prices.
  const displayedWeekly = Number(equivalent.toFixed(2));
  return {
    price: `$${displayedWeekly.toFixed(2)}`,
    saving: `$${(PLAN_VALUE_USD.weekly - displayedWeekly).toFixed(2)}`,
    savingsPercent: Math.round(
      (1 - displayedWeekly / PLAN_VALUE_USD.weekly) * 100,
    ),
  };
}
