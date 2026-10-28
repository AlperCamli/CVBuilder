import { describe, expect, it, vi } from "vitest";
import { bucketEnd, drillHandler, drillPatch } from "./drill";
import { parseFilters, writeFilters } from "./filters";

const now = new Date("2026-10-28T12:00:00Z");
const filtersFor = (search: string) => parseFilters(new URLSearchParams(search), now);
/** The URL a drill click produces, starting from `search`. */
const drillUrl = (search: string, point: { bucket: string; dimension: string | null }) => {
  const filters = filtersFor(search);
  const patch = drillPatch(filters, filters.breakdown, point);
  return patch && writeFilters({ ...filters, ...patch }, new URLSearchParams(search)).toString();
};

describe("drill-down", () => {
  it("filters the page to a clicked breakdown value and clears the breakdown", () => {
    expect(drillUrl("breakdown=market&range=7d", { bucket: "2026-10-25", dimension: "TR" })).toBe(
      `range=7d&filters=${encodeURIComponent('{"market":"TR"}')}`,
    );
  });

  it("adds to existing dimension filters", () => {
    const search = `breakdown=locale&filters=${encodeURIComponent('{"market":"TR"}')}`;
    expect(drillUrl(search, { bucket: "2026-10-25", dimension: "tr" })).toBe(
      `filters=${encodeURIComponent('{"locale":"tr","market":"TR"}')}`,
    );
  });

  it("zooms a week or month bucket into daily data, clamped to the current range", () => {
    expect(drillUrl("grain=week", { bucket: "2026-10-12", dimension: null })).toBe("from=2026-10-12&to=2026-10-18");
    expect(drillUrl("grain=week", { bucket: "2026-09-28", dimension: null })).toBe("from=2026-09-29&to=2026-10-04");
    expect(drillUrl("grain=month&range=12m", { bucket: "2026-10-01", dimension: null })).toBe("from=2026-10-01&to=2026-10-28");
  });

  it("does nothing for Other, or for a daily bucket without a breakdown", () => {
    expect(drillUrl("breakdown=market", { bucket: "2026-10-25", dimension: null })).toBeNull();
    expect(drillUrl("", { bucket: "2026-10-25", dimension: null })).toBeNull();
    expect(drillHandler(filtersFor(""), vi.fn())).toBeUndefined();
  });

  it("computes bucket ends", () => {
    expect(bucketEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(bucketEnd("2026-10-26", "week")).toBe("2026-11-01");
    expect(bucketEnd("2026-10-26", "day")).toBe("2026-10-26");
  });
});
