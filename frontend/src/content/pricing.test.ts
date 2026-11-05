import { describe, expect, it } from "vitest";
import {
  ANNUAL_TOTAL_PRICE,
  ANNUAL_WEEKLY_EQUIVALENT,
  CHECKOUT_TARGETS,
  MONTHLY_TOTAL_PRICE,
  MONTHLY_WEEKLY_EQUIVALENT,
  PAID_PLAN_CARDS,
  PLAN_CARDS,
  PLAN_VALUE_USD,
  TRIAL_PLAN,
  WEEKLY_PRICE,
  isCheckoutTarget,
  isLegacyPaidPlanCode,
  isPaidPlanCode,
  trialPlanCode
} from "./pricing";

describe("pricing content", () => {
  it("compares the visible plans by weekly price", () => {
    expect(PLAN_CARDS.map((card) => card.code)).toEqual(["trial", "weekly", "monthly", "annual"]);

    expect(PLAN_CARDS.find((card) => card.code === "weekly")).toMatchObject({
      weeklyPrice: WEEKLY_PRICE,
      totalPrice: `${WEEKLY_PRICE} billed weekly`,
      description: "The lowest commitment, billed weekly. No free trial."
    });
    expect(PLAN_CARDS.find((card) => card.code === "weekly")?.trialEligible).toBeFalsy();
    expect(PLAN_CARDS.find((card) => card.code === "monthly")).toMatchObject({
      weeklyPrice: MONTHLY_WEEKLY_EQUIVALENT,
      totalPrice: `${MONTHLY_TOTAL_PRICE} billed monthly`,
      savings: "Save 31% vs weekly",
      trialEligible: true
    });
    expect(PLAN_CARDS.find((card) => card.code === "annual")).toMatchObject({
      weeklyPrice: ANNUAL_WEEKLY_EQUIVALENT,
      totalPrice: `${ANNUAL_TOTAL_PRICE} billed annually`,
      savings: "Save 62% vs weekly"
    });
  });

  it("attaches the free trial to Monthly, and only to Monthly", () => {
    expect(TRIAL_PLAN).toBe("monthly");
    expect(PLAN_CARDS.filter((card) => card.trialEligible).map((card) => card.code)).toEqual([TRIAL_PLAN]);
    expect(PLAN_CARDS.find((card) => card.code === "trial")?.totalPrice).toContain("Monthly Pro price");
    expect(PLAN_CARDS.some((card) => /Weekly Pro|renews weekly/i.test(`${card.totalPrice} ${card.description}`))).toBe(false);
  });

  it("reads the trial plan from the server catalog and falls back to Monthly", () => {
    const catalog = (trial: Record<string, number>) => ({
      plans: (["weekly", "monthly", "annual"] as const).map((code) => ({ code, trial_days: trial[code] ?? 0 }))
    });
    expect(trialPlanCode(catalog({ monthly: 3 }))).toBe("monthly");
    // A server that still attaches the trial elsewhere is followed, never contradicted.
    expect(trialPlanCode(catalog({ weekly: 3 }))).toBe("weekly");
    expect(trialPlanCode(catalog({}))).toBe(TRIAL_PLAN);
    expect(trialPlanCode(null)).toBe(TRIAL_PLAN);
    expect(trialPlanCode(undefined)).toBe(TRIAL_PLAN);
  });

  it("limits checkout targets to Weekly, Monthly, and Annual", () => {
    expect(CHECKOUT_TARGETS).toEqual(["weekly", "monthly", "annual"]);
    expect(PAID_PLAN_CARDS.map((card) => card.code)).toEqual(CHECKOUT_TARGETS);

    for (const code of CHECKOUT_TARGETS) {
      expect(isCheckoutTarget(code)).toBe(true);
      expect(isPaidPlanCode(code)).toBe(true);
      expect(PLAN_VALUE_USD[code]).toBeGreaterThan(0);
    }

    expect(PLAN_VALUE_USD).toEqual({
      weekly: 4.99,
      monthly: 14.99,
      annual: 99.9
    });

    expect(isCheckoutTarget("pro")).toBe(false);
    expect(isCheckoutTarget("lifetime")).toBe(false);
    expect(isLegacyPaidPlanCode("pro")).toBe(true);
    expect(isLegacyPaidPlanCode("lifetime")).toBe(true);
    expect(isPaidPlanCode("pro")).toBe(true);
    expect(isPaidPlanCode("lifetime")).toBe(true);
  });
});
