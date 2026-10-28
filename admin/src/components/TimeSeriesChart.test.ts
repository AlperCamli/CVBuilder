import { describe, expect, it } from "vitest";
import { OTHER_LABEL, pivotRows } from "./TimeSeriesChart";

describe("pivotRows", () => {
  it("renders null dimensions as a single series", () => {
    const { data, series, breakdown } = pivotRows(
      [
        { bucket: "2026-10-02", dimension: null, signups: 4 },
        { bucket: "2026-10-01", dimension: null, signups: 3 },
      ],
      "signups",
      5,
      "Signups",
    );
    expect(breakdown).toBe(false);
    expect(series).toEqual([{ key: "s0", label: "Signups", color: "var(--series-1)", dimension: null }]);
    expect(data).toEqual([
      { bucket: "2026-10-01", s0: 3 },
      { bucket: "2026-10-02", s0: 4 },
    ]);
  });

  it("keeps the top N dimensions by total and folds the rest into Other", () => {
    const rows = ["TR", "US", "DE", "GB"].flatMap((dim, i) => [
      { bucket: "2026-10-01", dimension: dim, signups: 10 - i },
      { bucket: "2026-10-02", dimension: dim, signups: 10 - i },
    ]);
    const { data, series } = pivotRows(rows, "signups", 2);
    expect(series.map((s) => s.label)).toEqual(["TR", "US", OTHER_LABEL]);
    expect(series[2].dimension).toBeNull();
    expect(data[0]).toEqual({ bucket: "2026-10-01", s0: 10, s1: 9, other: 15 });
  });

  it("does not fold a single leftover dimension", () => {
    const rows = ["TR", "US", "DE"].map((dim) => ({ bucket: "2026-10-01", dimension: dim, signups: 1 }));
    expect(pivotRows(rows, "signups", 2).series.map((s) => s.label)).toEqual(["DE", "TR", "US"]);
  });

  it("totals the sample column per series, including folded ones", () => {
    const rows = ["TR", "US", "DE", "GB"].map((dim, i) => ({ bucket: "2026-10-01", dimension: dim, revenue: 100 - i, invoices: i + 1 }));
    const { series } = pivotRows(rows, "revenue", 2, "Revenue", "invoices");
    expect(series.map((s) => [s.label, s.sample])).toEqual([
      ["TR", 1],
      ["US", 2],
      [OTHER_LABEL, 7],
    ]);
  });
});
