import { describe, expect, it, vi } from "vitest";
import { catalogSchema, type MetricMeta } from "./api";
import { bucketEnd, drillHandler, drillPatch, pointHandler } from "./drill";
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

describe("drill wiring", () => {
  const meta = (drill?: boolean) =>
    ({ title: "Failed AI runs", definition: "", unit: "count", shape: "timeseries", breakdowns: [], filters: [], drill }) as MetricMeta;
  const setup = (search: string, drill?: boolean) => {
    const filters = filtersFor(search);
    const setFilters = vi.fn();
    const openDrill = vi.fn();
    const handler = pointHandler({
      metric: "ai_failures",
      title: "Failed AI runs",
      meta: meta(drill),
      filters,
      setFilters,
      dims: filters.filters,
      breakdown: filters.breakdown,
      openDrill,
    });
    return { handler, setFilters, openDrill };
  };

  it("opens the users drawer for metrics with meta.drill, even on a daily bucket", () => {
    const { handler, setFilters, openDrill } = setup(`range=30d&filters=${encodeURIComponent('{"market":"TR"}')}`, true);
    handler!({ bucket: "2026-10-25", dimension: null });
    expect(openDrill).toHaveBeenCalledWith({
      metric: "ai_failures",
      title: "Failed AI runs",
      filters: { market: "TR" },
      from: "2026-10-25",
      to: "2026-10-25",
    });
    expect(setFilters).not.toHaveBeenCalled();
  });

  it("scopes the drawer to the clicked series and the bucket's days (clamped)", () => {
    const { handler, openDrill } = setup("grain=week&breakdown=ai_flow", true);
    handler!({ bucket: "2026-10-26", dimension: "tailoring" });
    expect(openDrill).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { ai_flow: "tailoring" }, from: "2026-10-26", to: "2026-10-28" }),
    );
    handler!({ bucket: "2026-10-26", dimension: null }); // "Other" has no single value
    expect(openDrill).toHaveBeenCalledTimes(1);
  });

  it("keeps filtering the page for metrics without meta.drill", () => {
    const { handler, setFilters, openDrill } = setup("breakdown=market", false);
    handler!({ bucket: "2026-10-25", dimension: "TR" });
    expect(setFilters).toHaveBeenCalledWith({ filters: { market: "TR" }, breakdown: undefined });
    expect(openDrill).not.toHaveBeenCalled();
    expect(setup("", undefined).handler).toBeUndefined();
  });

  it("parses meta.drill: true or a documented keys object; anything else is false", () => {
    const entry = (drill: unknown) => ({ name: "m", kind: "metric", meta: { title: "M", drill } });
    const { metrics } = catalogSchema.parse({
      metrics: [entry(true), entry({ keys: ["bucket"] }), entry("yes"), entry(1), { name: "n", kind: "metric", meta: { title: "N" } }],
    });
    expect(metrics.map((m) => m.meta.drill)).toEqual([true, true, false, false, undefined]);
  });
});
