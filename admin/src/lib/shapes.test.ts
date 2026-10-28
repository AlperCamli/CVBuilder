import { describe, expect, it } from "vitest";
import type { MetricMeta } from "./api";
import {
  barGeometry,
  buildCohortGrid,
  buildFunnels,
  flaggedBuckets,
  formatCellRate,
  groupByUnit,
  inferShape,
  measureKeys,
  OTHER_LABEL,
  primaryMeasure,
  rankBreakdown,
  rateBin,
  sortRows,
} from "./shapes";

const meta = (extra: Partial<MetricMeta> = {}): MetricMeta => ({
  title: "T",
  definition: "",
  unit: "count",
  shape: "breakdown",
  breakdowns: [],
  filters: [],
  ...extra,
});

describe("rankBreakdown", () => {
  const rows = [
    { dimension: "free", users: 5, ltv: 0.1 },
    { dimension: "pro", users: 40, ltv: 0.5 },
    { dimension: "team", users: 12, ltv: 0.4 },
    { dimension: null, users: 3, ltv: null },
    { dimension: "edu", users: 1, ltv: 0.2 },
  ];

  it("sorts by the primary measure, largest first, and labels null dimensions", () => {
    const { bars } = rankBreakdown(rows, "users", { measures: ["users", "ltv"], topN: 8 });
    expect(bars.map((b) => b.label)).toEqual(["pro", "team", "free", "Unknown", "edu"]);
    expect(bars[3].dimension).toBeNull();
    expect(bars[0].values).toEqual({ users: 40, ltv: 0.5 });
  });

  it("folds a tail longer than one row into Other, summing only summable measures", () => {
    const { bars, hidden } = rankBreakdown(rows, "users", {
      measures: ["users", "ltv"],
      topN: 2,
      summable: (k) => k === "users",
      sampleMeasure: "users",
      minGroup: 10,
    });
    expect(hidden).toBe(0);
    expect(bars.map((b) => b.label)).toEqual(["pro", "team", OTHER_LABEL]);
    expect(bars[2]).toMatchObject({ dimension: null, value: 9, folded: 3, values: { users: 9, ltv: null }, small: true });
    expect(bars[0].small).toBeUndefined();
  });

  it("never folds a single leftover row", () => {
    const { bars } = rankBreakdown(rows.slice(0, 3), "users", { measures: ["users"], topN: 2 });
    expect(bars.map((b) => b.label)).toEqual(["pro", "team", "free"]);
  });

  it("truncates instead of folding when the primary measure can't be summed", () => {
    const { bars, hidden } = rankBreakdown(rows, "ltv", { measures: ["ltv", "users"], topN: 2, summable: () => false });
    expect(bars.map((b) => b.label)).toEqual(["pro", "team"]);
    expect(hidden).toBe(3);
  });
});

describe("barGeometry", () => {
  it("anchors bars at zero, splitting the track when values are negative", () => {
    expect(barGeometry(50, 0, 100)).toEqual({ zero: 0, start: 0, width: 50 });
    expect(barGeometry(-25, -50, 50)).toEqual({ zero: 50, start: 25, width: 25 });
    expect(barGeometry(0, 0, 0)).toEqual({ zero: 0, start: 0, width: 0 });
  });
});

describe("buildFunnels", () => {
  const steps = (dimension: string | null, users: number[]) =>
    users.map((u, i) => ({ step_order: i + 1, step: `S${i + 1}`, users: u, conversion_from_prev: null, conversion_from_start: null, dimension }));

  it("computes conversions when the rows don't carry them and flags the steepest drop", () => {
    const [f] = buildFunnels(steps(null, [200, 150, 30, 24]));
    expect(f.dimension).toBeNull();
    expect(f.steps.map((s) => s.fromPrev)).toEqual([null, 0.75, 0.2, 0.8]);
    expect(f.steps.map((s) => s.fromStart)).toEqual([1, 0.75, 0.15, 0.12]);
    expect(f.worst).toBe(2);
  });

  it("prefers the conversions the SQL returns and orders steps by step_order", () => {
    const [f] = buildFunnels([
      { step_order: 2, step: "Paid", users: 10, conversion_from_prev: 0.1, conversion_from_start: 0.1 },
      { step_order: 1, step: "Visited", users: 100, conversion_from_prev: null, conversion_from_start: 1 },
    ]);
    expect(f.steps.map((s) => s.step)).toEqual(["Visited", "Paid"]);
    expect(f.steps[1]).toMatchObject({ previous: 100, fromPrev: 0.1, fromStart: 0.1 });
  });

  it("has no worst step when nobody drops off", () => {
    expect(buildFunnels(steps(null, [10, 10]))[0].worst).toBe(-1);
  });

  it("splits by dimension, largest first, folding the tail into Other with recomputed conversions", () => {
    const funnels = buildFunnels(
      [...steps("TR", [100, 50]), ...steps("US", [300, 30]), ...steps("DE", [10, 5]), ...steps("GB", [20, 10])],
      2,
    );
    expect(funnels.map((f) => f.label)).toEqual(["US", "TR", OTHER_LABEL]);
    const other = funnels[2];
    expect(other.dimension).toBeNull();
    expect(other.steps.map((s) => s.users)).toEqual([30, 15]);
    expect(other.steps[1].fromPrev).toBe(0.5);
  });
});

describe("cohort grid", () => {
  const rows = [
    { cohort: "2026-10-05", period: 0, cohort_size: 200, active: 200, rate: 1 },
    { cohort: "2026-10-05", period: 1, cohort_size: 200, active: 60, rate: 0.3 },
    { cohort: "2026-09-28", period: 0, cohort_size: 4, active: 4, rate: null },
    { cohort: "2026-09-28", period: 2, cohort_size: 4, active: 1, rate: null },
  ];

  it("orders cohorts and periods, computes missing rates and scales to the best later period", () => {
    const grid = buildCohortGrid(rows);
    expect(grid.cohorts.map((c) => c.cohort)).toEqual(["2026-09-28", "2026-10-05"]);
    expect(grid.periods).toEqual([0, 1, 2]);
    expect(grid.cohorts[0].cells.get(2)).toEqual({ rate: 0.25, active: 1 });
    expect(grid.cohorts[0].cells.has(1)).toBe(false);
    expect(grid.max).toBe(0.3);
  });

  it("bins rates on the sequential scale, clamping at the top", () => {
    expect(rateBin(0, 0.3)).toBe(0);
    expect(rateBin(0.15, 0.3)).toBe(3);
    expect(rateBin(0.3, 0.3)).toBe(6);
    expect(rateBin(1, 0.3)).toBe(6);
    expect(rateBin(0.5, 0)).toBe(0);
  });

  it("formats cells as whole percents, with <1% for tiny non-zero rates", () => {
    expect(formatCellRate(0.2349)).toBe("23%");
    expect(formatCellRate(0.004)).toBe("<1%");
    expect(formatCellRate(0)).toBe("0%");
    expect(formatCellRate(1)).toBe("100%");
  });
});

describe("timeseries helpers", () => {
  it("collects flagged buckets from a boolean column", () => {
    const rows = [
      { bucket: "2026-10-01", cost: 1, is_anomaly: false },
      { bucket: "2026-10-02", cost: 9, is_anomaly: true },
      { bucket: "2026-10-03", cost: 1, is_anomaly: "true" },
    ];
    expect([...flaggedBuckets(rows, "is_anomaly")]).toEqual(["2026-10-02"]);
    expect(flaggedBuckets(rows, undefined).size).toBe(0);
  });

  it("groups plotted measures by unit so each group shares one axis", () => {
    const m = meta({
      measures: { runs: { label: "Runs", unit: "count" }, failure_rate: { label: "Failure rate", unit: "ratio" }, failed: { label: "Failed", unit: "count" } },
    });
    expect(groupByUnit(m, ["runs", "failure_rate", "failed"])).toEqual([
      { unit: "count", keys: ["runs", "failed"] },
      { unit: "ratio", keys: ["failure_rate"] },
    ]);
  });
});

describe("table helpers", () => {
  it("sorts numbers numerically and text alphabetically, nulls last either way", () => {
    const rows = [{ v: 10, s: "b" }, { v: null, s: null }, { v: 2, s: "a" }, { v: 33, s: "c" }];
    expect(sortRows(rows, "v", "desc").map((r) => r.v)).toEqual([33, 10, 2, null]);
    expect(sortRows(rows, "v", "asc").map((r) => r.v)).toEqual([2, 10, 33, null]);
    expect(sortRows(rows, "s", "asc").map((r) => r.s)).toEqual(["a", "b", "c", null]);
  });

  it("lists measures in the rows' column order and skips structural, flag and non-numeric columns", () => {
    const m = meta({ flag_column: "is_anomaly", measures: { cost: { label: "Cost", unit: "currency" }, gone: { label: "Gone", unit: "count" } } });
    const rows = [{ bucket: "2026-10-01", dimension: null, runs: 3, cost: 1.5, is_anomaly: true, note: "x" }];
    expect(measureKeys(m, rows)).toEqual(["runs", "cost"]);
    // A declared column that is null in every row is still a measure; a column only later rows carry comes last.
    expect(measureKeys(m, [{ cost: null, runs: 1 }, { cost: null, runs: 2, extra: 4 }])).toEqual(["cost", "runs", "extra"]);
  });

  it("takes the primary measure from the column order, not the jsonb-reordered meta.measures", () => {
    // Postgres jsonb stores shorter keys first, so the comment's declaration order (active_users, rate) is lost.
    const m = meta({ measures: { rate: { label: "Rate", unit: "ratio" }, active_users: { label: "Active users", unit: "count" } } });
    const rows = [{ bucket: "2026-10-01", dimension: null, active_users: 10, rate: 0.5 }];
    expect(primaryMeasure("engagement", m, rows)).toBe("active_users");
    // The column named like the metric wins wherever it sits.
    expect(primaryMeasure("rate", m, rows)).toBe("rate");
    // Before rows arrive: plot first, then any declared measure.
    expect(primaryMeasure("engagement", meta({ ...m, plot: ["active_users"] }), undefined)).toBe("active_users");
    expect(primaryMeasure("engagement", m, [])).toBe("rate");
    expect(primaryMeasure("engagement", undefined, undefined)).toBe("engagement");
  });

  it("infers a shape from the columns when the catalog is unavailable", () => {
    expect(inferShape(undefined, [{ bucket: "2026-10-01", x: 1 }])).toBe("timeseries");
    expect(inferShape(undefined, [{ step: "a", users: 1 }])).toBe("funnel");
    expect(inferShape(undefined, [{ cohort: "2026-10-01", period: 0 }])).toBe("cohort");
    expect(inferShape(undefined, [{ dimension: "pro", n: 1 }, { dimension: "free", n: 2 }])).toBe("breakdown");
    expect(inferShape(undefined, [{ n: 1 }])).toBe("kpi");
    expect(inferShape(meta({ shape: "table" }), [{ bucket: "x" }])).toBe("table");
  });
});
