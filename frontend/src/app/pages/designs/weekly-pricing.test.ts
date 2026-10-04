import { describe, expect, it } from "vitest";
import { PLAN_CARDS } from "../../../content/pricing";
import { weeklyPriceComparison } from "./weekly-pricing";

describe("weekly comparison for guided pricing", () => {
  it.each([
    ["weekly", "$4.99", "$0.00", 0],
    ["monthly", "$3.46", "$1.53", 31],
    ["annual", "$1.92", "$3.07", 62],
  ] as const)(
    "compares %s on the same 52-week basis as the public site",
    (period, price, saving, savingsPercent) => {
      expect(weeklyPriceComparison(period)).toEqual({
        price,
        saving,
        savingsPercent,
      });
      expect(price).toBe(
        PLAN_CARDS.find((card) => card.code === period)?.weeklyPrice,
      );
    },
  );
});
