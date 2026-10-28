import { fireEvent, render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { MetricMeta } from "@/lib/api";
import { TimeSeriesChart, pivotMeasures, flagY } from "@/components/TimeSeriesChart";
import { BreakdownChart } from "./BreakdownChart";
import { CohortHeatmap } from "./CohortHeatmap";
import { DataTable } from "./DataTable";
import { FunnelChart } from "./FunnelChart";
import { KpiList } from "./KpiList";

// jsdom has no layout: give Recharts a fixed size so the SVG marks actually render.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 300 } as never),
  };
});

const meta = (extra: Partial<MetricMeta> = {}): MetricMeta => ({
  title: "T",
  definition: "",
  unit: "count",
  shape: "breakdown",
  breakdowns: [],
  filters: [],
  ...extra,
});

describe("BreakdownChart", () => {
  const m = meta({
    measures: { subscribers: { label: "Subscribers", unit: "count" }, ltv: { label: "LTV", unit: "currency" } },
  });
  const rows = [
    { dimension: "free", subscribers: 3, ltv: 0 },
    { dimension: "pro", subscribers: 120, ltv: 80.5 },
    { dimension: "team", subscribers: 40, ltv: 300 },
    { dimension: "edu", subscribers: 2, ltv: 10 },
    { dimension: "trial", subscribers: 1, ltv: 0 },
  ];
  const renderChart = (onBarClick?: (d: string) => void) =>
    render(
      <BreakdownChart
        rows={rows}
        meta={m}
        measure="subscribers"
        measures={["subscribers", "ltv"]}
        currency="usd"
        dimensionLabel="Plan"
        topN={2}
        minGroup={10}
        sampleMeasure="subscribers"
        onBarClick={onBarClick}
      />,
    );

  it("draws bars largest first with value labels and folds the tail into Other", () => {
    renderChart();
    const list = screen.getByRole("list", { name: "Subscribers by plan" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("[title]")?.textContent)).toEqual(["pro", "team", "Other"]);
    expect(within(items[0]).getByText("120", { selector: "span.font-medium" })).toBeTruthy();
    // 3 + 2 + 1 folded; below min_group (10) so it carries the small-sample badge.
    expect(within(items[2]).getByText("6", { selector: "span.font-medium" })).toBeTruthy();
    expect(within(items[2]).getByText("small sample")).toBeTruthy();
    const widths = within(list).getAllByTestId("bar").map((b) => (b as HTMLElement).style.width);
    expect(widths[0]).toBe("max(100%, 2px)");
  });

  it("shows secondary measures in the tooltip", () => {
    renderChart();
    fireEvent.mouseEnter(screen.getAllByRole("listitem")[1].firstElementChild!);
    const tip = screen.getByRole("tooltip");
    expect(within(tip).getByText("team")).toBeTruthy();
    expect(within(tip).getByText("$300")).toBeTruthy();
  });

  it("clicks filter by the bar's value; Other is not clickable", () => {
    const onBarClick = vi.fn();
    renderChart(onBarClick);
    fireEvent.click(screen.getByRole("button", { name: /Filter to pro/ }));
    expect(onBarClick).toHaveBeenCalledWith("pro");
    expect(screen.queryByRole("button", { name: /Filter to Other/ })).toBeNull();
  });

  it("lists every row, unfolded and sortable, in the table view", () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Subscribers by plan" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    fireEvent.click(within(table).getByRole("button", { name: /LTV \(USD\)/ }));
    const firstCells = within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent);
    expect(firstCells).toEqual(["team", "pro", "edu", "free", "trial"]);
    expect(within(table).getByRole("columnheader", { name: /LTV/ }).getAttribute("aria-sort")).toBe("descending");
  });
});

describe("FunnelChart", () => {
  const rows = [
    { step_order: 1, step: "Viewed pricing", users: 400, conversion_from_prev: null, conversion_from_start: 1 },
    { step_order: 2, step: "Started checkout", users: 100, conversion_from_prev: 0.25, conversion_from_start: 0.25 },
    { step_order: 3, step: "Paid", users: 80, conversion_from_prev: 0.8, conversion_from_start: 0.2 },
  ];

  it("labels conversions and flags the largest drop-off", () => {
    render(<FunnelChart rows={rows} currency="usd" dimensionLabel="Market" minGroup={5} />);
    const steps = within(screen.getByRole("list", { name: "Funnel" })).getAllByRole("listitem");
    expect(within(steps[1]).getByText("25% of previous")).toBeTruthy();
    expect(within(steps[2]).getByText("80% of previous")).toBeTruthy();
    expect(within(steps[2]).getByText("20% of start")).toBeTruthy();
    expect(within(steps[1]).getByText("Largest drop-off")).toBeTruthy();
    expect(steps.filter((s) => s.dataset.worst)).toHaveLength(1);
    expect((screen.getAllByTestId("funnel-bar")[2] as HTMLElement).style.width).toBe("20%");
  });

  it("renders one small multiple per dimension and drills from a step", () => {
    const onStepClick = vi.fn();
    const segmented = [
      ...rows.map((r) => ({ ...r, dimension: "TR" })),
      ...rows.map((r) => ({ ...r, users: r.users / 100, dimension: "US" })),
    ];
    render(<FunnelChart rows={segmented} currency="usd" dimensionLabel="Market" minGroup={5} onStepClick={onStepClick} />);
    expect(screen.getByRole("list", { name: "TR funnel" })).toBeTruthy();
    const us = screen.getByRole("list", { name: "US funnel" }).closest("figure")!;
    expect(within(us).getByText("small sample")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show users at Paid (TR): 80" }));
    expect(onStepClick.mock.calls[0][0].step).toBe("Paid");
    expect(onStepClick.mock.calls[0][1].dimension).toBe("TR");
  });
});

describe("CohortHeatmap", () => {
  const rows = [
    { cohort: "2026-09-07", period: 0, cohort_size: 3, active: 3, rate: 1 },
    { cohort: "2026-09-07", period: 1, cohort_size: 3, active: 1, rate: 1 / 3 },
    { cohort: "2026-09-14", period: 0, cohort_size: 250, active: 250, rate: 1 },
    { cohort: "2026-09-14", period: 1, cohort_size: 250, active: 60, rate: 0.24 },
    { cohort: "2026-09-14", period: 2, cohort_size: 250, active: 1, rate: 0.004 },
  ];

  it("formats cells, shows cohort sizes and mutes small cohorts", () => {
    render(<CohortHeatmap rows={rows} currency="usd" grain="week" minGroup={5} />);
    const table = screen.getByRole("table", { name: /Share of each cohort active/ });
    const [, small, big] = within(table).getAllByRole("row");
    expect(small.dataset.small).toBe("true");
    expect(within(small).getByText("small")).toBeTruthy();
    expect(within(small).getAllByText("100%")[0].className).toContain("opacity-35");
    expect(big.dataset.small).toBeUndefined();
    expect(within(big).getByText("250")).toBeTruthy();
    expect(within(big).getByText("24%")).toBeTruthy();
    expect(within(big).getByText("<1%")).toBeTruthy();
    // The scale tops out at the best later-period rate (33%), so 24% sits mid-ramp and 100% is the darkest step.
    expect(within(big).getByText("24%").dataset.bin).toBe("6");
    expect(within(big).getByText("100%").dataset.bin).toBe("7");
    expect(within(big).getByText("<1%").dataset.bin).toBe("1");
    // Period 2 doesn't exist yet for the older, small cohort: an empty cell, not 0%.
    expect(within(small).getAllByRole("cell").at(-1)!.textContent).toBe("");
  });

  it("shows active / cohort size in the tooltip", () => {
    render(<CohortHeatmap rows={rows} currency="usd" grain="week" minGroup={5} />);
    fireEvent.mouseEnter(screen.getByText("24%"));
    expect(within(screen.getByRole("tooltip")).getByText("60 of 250")).toBeTruthy();
  });
});

describe("KpiList", () => {
  it("lists each measure with its unit, skipping flags and showing nulls as a dash", () => {
    const m = meta({
      shape: "kpi",
      measures: { mrr: { label: "MRR", unit: "currency" }, churn_rate: { label: "Churn rate", unit: "ratio" }, arpu: { label: "ARPU", unit: "currency" } },
    });
    render(<KpiList row={{ mrr: 1200, churn_rate: 0.05, arpu: null, fx_provisional: true }} meta={m} currency="usd" />);
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    const values = screen.getAllByRole("definition").map((d) => d.textContent);
    expect(terms).toEqual(["MRR", "Churn rate", "ARPU"]);
    expect(values).toEqual(["$1,200", "5%", "—"]);
  });
});

describe("DataTable", () => {
  it("formats by measure unit and leaves undeclared numbers plain", () => {
    const m = meta({ measures: { revenue: { label: "Revenue", unit: "currency" }, rate: { label: "Rate", unit: "ratio" } } });
    render(
      <DataTable
        rows={[{ bucket: "2026-10-01", revenue: 1234.5, rate: 0.125, step_order: 2, ok: true, note: null }]}
        meta={m}
        currency="try"
        label="t"
      />,
    );
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Oct 1, 2026", "₺1,234.5", "12.5%", "2", "Yes", "—"]);
    expect(screen.getByRole("columnheader", { name: "Revenue (TRY)" })).toBeTruthy();
  });
});

describe("TimeSeriesChart with plotted measures", () => {
  const rows = [
    { bucket: "2026-08-01", dimension: null, new_mrr: 100, expansion: 20, contraction: -10, churn: -40, is_anomaly: false },
    { bucket: "2026-09-01", dimension: null, new_mrr: 80, expansion: 0, contraction: -5, churn: -120, is_anomaly: true },
    { bucket: "2026-10-01", dimension: null, new_mrr: 90, expansion: 10, contraction: null, churn: -20, is_anomaly: true },
  ];
  const measures = [
    { key: "new_mrr", label: "New" },
    { key: "expansion", label: "Expansion" },
    { key: "contraction", label: "Contraction" },
    { key: "churn", label: "Churn" },
  ];

  it("pivots one signed series per measure and keeps null gaps", () => {
    const { data, series, breakdown } = pivotMeasures(rows, measures);
    expect(breakdown).toBe(false);
    expect(series.map((s) => [s.label, s.color])).toEqual([
      ["New", "var(--series-1)"],
      ["Expansion", "var(--series-2)"],
      ["Contraction", "var(--series-3)"],
      ["Churn", "var(--series-4)"],
    ]);
    expect(data[2]).toEqual({ bucket: "2026-10-01", m0: 90, m1: 10, m2: null, m3: -20 });
    expect(flagY(data[0], ["m0", "m1", "m2", "m3"], true)).toBe(120);
    expect(flagY(data[0], ["m0", "m1", "m2", "m3"], false)).toBe(100);
  });

  it("stacks signed bars around a zero line and marks flagged points", () => {
    const { container } = render(
      <TimeSeriesChart
        rows={rows}
        measure="new_mrr"
        grain="month"
        variant="bar"
        measures={measures}
        stacked
        flags={new Set(["2026-09-01", "2026-10-01"])}
        flagLabel="Anomaly"
        formatValue={(v) => `$${v}`}
      />,
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/4 series, 3 periods.*2 marked anomaly/);
    expect(screen.getByText("Anomaly (2)")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Series" })).getAllByRole("button")).toHaveLength(4);
    expect(container.querySelectorAll(".recharts-reference-dot")).toHaveLength(2);
    const zero = container.querySelector(".recharts-reference-line line")!;
    const zeroY = Number(zero.getAttribute("y1"));
    // Churn bars sit below the zero line, new MRR bars above it.
    const layers = container.querySelectorAll(".recharts-bar");
    const ys = (layer: Element) => [...layer.querySelectorAll("path")].map((p) => Number(/M\s*[\d.]+,([\d.]+)/.exec(p.getAttribute("d") ?? "")?.[1]));
    expect(layers).toHaveLength(4);
    expect(ys(layers[0])).toHaveLength(3);
    expect(ys(layers[3])).toHaveLength(3);
    expect(ys(layers[0]).every((y) => y < zeroY)).toBe(true);
    expect(ys(layers[3]).every((y) => y >= zeroY)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Anomaly" })).toBeTruthy();
    expect(within(table).getAllByText("Yes")).toHaveLength(2);
    expect(within(table).getByText("$-120")).toBeTruthy();
  });
});
