import { describe, expect, it } from "vitest";
import { formatMoney, regionalCards, trialPlanPrice, type BillingPrices } from "./regional-pricing";

const catalog = (trial: "weekly" | "monthly" | null): BillingPrices => ({
  market: "TR", currency: "try", available: true, quote: "fixture", plans: [
    { code: "weekly", amount: 14990, interval: "week", interval_count: 1, trial_days: trial === "weekly" ? 3 : 0 },
    { code: "monthly", amount: 34990, interval: "month", interval_count: 1, trial_days: trial === "monthly" ? 3 : 0 },
    { code: "annual", amount: 149900, interval: "year", interval_count: 1, trial_days: 0 },
  ],
});

describe("trial plan in the live catalog", () => {
  it("renews the trial card at the Monthly price, not the Weekly one", () => {
    const prices = catalog("monthly");
    expect(trialPlanPrice(prices)).toMatchObject({ code: "monthly", amount: 34990 });
    const cards = regionalCards(prices);
    const trial = cards.find(card => card.code === "trial")!;
    expect(trial.totalPrice).toContain(formatMoney(34990, "try"));
    expect(trial.totalPrice).not.toContain(formatMoney(14990, "try"));
    expect(trial.totalPrice).toMatch(/month/);
    expect(trial.totalPrice).not.toMatch(/week/);
    // Only the Monthly card is the trial plan; Weekly is still sold, and the comparison with it stays.
    expect(cards.filter(card => card.trialEligible).map(card => card.code)).toEqual(["monthly"]);
    expect(cards.find(card => card.code === "monthly")!.savings).toBe("Save 46% vs weekly");
    expect(cards.find(card => card.code === "weekly")!.totalPrice).toContain(formatMoney(14990, "try"));
  });

  it("follows the server when it still attaches the trial to Weekly", () => {
    const cards = regionalCards(catalog("weekly"));
    expect(cards.find(card => card.code === "trial")!.totalPrice).toContain(formatMoney(14990, "try"));
    expect(cards.filter(card => card.trialEligible).map(card => card.code)).toEqual(["weekly"]);
  });

  it("promises no renewal price without a live catalog", () => {
    expect(trialPlanPrice(null)).toBeNull();
    expect(trialPlanPrice({ ...catalog("monthly"), available: false, quote: null })).toBeNull();
    const offline = regionalCards(null).find(card => card.code === "trial")!;
    expect(offline.totalPrice).not.toMatch(/\d/);
    // Before the catalog loads the static content says the trial is Monthly's.
    expect(regionalCards(null).filter(card => card.trialEligible).map(card => card.code)).toEqual(["monthly"]);
  });
});
