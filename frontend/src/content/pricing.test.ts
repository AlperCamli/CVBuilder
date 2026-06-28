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
  WEEKLY_PRICE,
  isCheckoutTarget,
  isLegacyPaidPlanCode,
  isPaidPlanCode
} from "./pricing";

describe("pricing content", () => {
  it("shows weekly-emphasized pricing for the visible plans", () => {
    expect(PLAN_CARDS.map((card) => card.code)).toEqual(["free", "weekly", "monthly", "annual"]);

    expect(PLAN_CARDS.find((card) => card.code === "weekly")).toMatchObject({
      weeklyPrice: WEEKLY_PRICE,
      totalPrice: "$5 billed weekly",
      trialEligible: true
    });
    expect(PLAN_CARDS.find((card) => card.code === "monthly")).toMatchObject({
      weeklyPrice: MONTHLY_WEEKLY_EQUIVALENT,
      totalPrice: `${MONTHLY_TOTAL_PRICE} billed monthly`,
      savings: "Save 31% vs weekly"
    });
    expect(PLAN_CARDS.find((card) => card.code === "annual")).toMatchObject({
      weeklyPrice: ANNUAL_WEEKLY_EQUIVALENT,
      totalPrice: `${ANNUAL_TOTAL_PRICE} billed annually`,
      savings: "Save 62% vs weekly"
    });
  });

  it("limits checkout targets to Weekly, Monthly, and Annual", () => {
    expect(CHECKOUT_TARGETS).toEqual(["weekly", "monthly", "annual"]);
    expect(PAID_PLAN_CARDS.map((card) => card.code)).toEqual(CHECKOUT_TARGETS);

    for (const code of CHECKOUT_TARGETS) {
      expect(isCheckoutTarget(code)).toBe(true);
      expect(isPaidPlanCode(code)).toBe(true);
      expect(PLAN_VALUE_USD[code]).toBeGreaterThan(0);
    }

    expect(isCheckoutTarget("pro")).toBe(false);
    expect(isCheckoutTarget("lifetime")).toBe(false);
    expect(isLegacyPaidPlanCode("pro")).toBe(true);
    expect(isLegacyPaidPlanCode("lifetime")).toBe(true);
    expect(isPaidPlanCode("pro")).toBe(true);
    expect(isPaidPlanCode("lifetime")).toBe(true);
  });
});
