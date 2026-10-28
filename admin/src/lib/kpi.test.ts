import { describe, expect, it } from "vitest";
import { kpiWindows } from "./kpi";

const now = new Date("2026-10-28T09:00:00Z");

describe("kpiWindows", () => {
  it("compares complete days only when the range ends today", () => {
    expect(kpiWindows("2026-10-22", "2026-10-28", now)).toEqual({
      partial: true,
      current: { from: "2026-10-22", to: "2026-10-27" },
      previous: { from: "2026-10-16", to: "2026-10-21" },
      days: 6,
    });
  });

  it("uses the full range when it ends before today", () => {
    expect(kpiWindows("2026-10-01", "2026-10-10", now)).toMatchObject({
      partial: false,
      current: { from: "2026-10-01", to: "2026-10-10" },
      previous: { from: "2026-09-21", to: "2026-09-30" },
      days: 10,
    });
  });

  it("has nothing to compare when the range is only today", () => {
    expect(kpiWindows("2026-10-28", "2026-10-28", now)).toMatchObject({ current: null, previous: null });
  });
});
