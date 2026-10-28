import { describe, expect, it } from "vitest";
import { formatDuration, formatValue, notFilteredBy, unitSuffix } from "./format";

describe("format", () => {
  it("shows ratios as percentages, like percent", () => {
    expect(formatValue(0.5, "ratio", "usd")).toBe("50%");
    expect(formatValue(1 / 3, "percent", "usd")).toBe("33.33%");
    expect(unitSuffix("ratio", "usd")).toBe("%");
    expect(unitSuffix("ratio", "usd", true)).toBe("fraction 0–1");
  });

  it("names filters that don't apply", () => {
    expect(notFilteredBy(["plan"])).toBe("Not filtered by plan");
    expect(notFilteredBy(["market", "plan"])).toBe("Not filtered by market or plan");
    expect(notFilteredBy([])).toBe("");
  });

  it("formats durations", () => {
    expect(formatDuration(350)).toBe("350 ms");
    expect(formatDuration(1840)).toBe("1.8 s");
    expect(formatDuration(62_000)).toBe("1 m 02 s");
  });
});
