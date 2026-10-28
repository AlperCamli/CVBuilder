import { useState, type ReactNode } from "react";
import { BreakdownChart } from "@/components/charts/BreakdownChart";
import { CohortHeatmap } from "@/components/charts/CohortHeatmap";
import { DataTable } from "@/components/charts/DataTable";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { KpiList } from "@/components/charts/KpiList";
import { NotAvailableCard } from "@/components/charts/NotAvailableCard";
import { ChartCard } from "@/components/ChartCard";
import { DrillDrawer } from "@/components/DrillDrawer";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { controlClass } from "@/components/ui/control";
import { DEFAULT_MIN_GROUP, downloadCsv, ignoredFilters, measureOf, useCatalog, useCatalogEntry, useMetric, type MetricMeta } from "@/lib/api";
import { useAnomalyBuckets } from "@/lib/anomalies";
import { pointHandler, withDrillKey, type DrillFilters, type DrillTarget } from "@/lib/drill";
import { erasFor } from "@/lib/eras";
import type { Currency, Dimension, GlobalFilters } from "@/lib/filters";
import { csvHeaders, DIMENSION_LABELS, formatValue, humanize, labelWithUnit, notFilteredBy, unitSuffix } from "@/lib/format";
import { dataAsOf, useRecomputeStatus } from "@/lib/recompute";
import { flaggedBuckets, groupByUnit, inferShape, measureKeys, primaryMeasure, type Row, type Shape } from "@/lib/shapes";

interface MetricChartCardProps {
  name: string;
  filters: GlobalFilters;
  setFilters: (patch: Partial<GlobalFilters>) => void;
  /** Primary column; defaults to the column named like the metric, else the first declared measure. */
  measure?: string;
  /**
   * What the "native" currency means for this metric: "usd" for USD-by-nature amounts (AI cost),
   * "split" when rows come back per invoice currency in `dimension` and breakdowns are rejected (revenue).
   */
  native?: "usd" | "split";
  /** Count column behind each series/bar for the small-sample badge; defaults to the measure when it is a count. */
  sampleMeasure?: string;
  /** Secondary figures under the chart, computed from the loaded rows. */
  footnote?: (rows: Row[], meta: MetricMeta | undefined, currency: Currency) => ReactNode;
  /** Markers next to the title, computed from the loaded rows (e.g. FX provisional). */
  badges?: (rows: Row[], meta: MetricMeta | undefined, currency: Currency) => ReactNode;
  variant?: "line" | "bar";
  topN?: number;
  height?: number;
  className?: string;
  /**
   * A timeseries metric whose `is_anomaly` days are marked on this chart (e.g. `ai_cost_anomalies` on AI cost),
   * fetched with the same range, grain and filters and without the breakdown. Skipped when the catalog lacks it.
   */
  anomalies?: string;
  /** Title until the catalog provides one (and for the "Not available yet" card). */
  title?: string;
  headingLevel?: 2 | 3;
}

const FACET_CURRENCY: Record<string, Currency> = { USD: "usd", TRY: "try" };
const WIDE_SHAPES = new Set<Shape>(["timeseries", "cohort"]);

/** Timeseries and cohort heatmaps span the full grid; breakdowns, funnels, KPI lists and tables take half. */
export const isWideShape = (shape: Shape | undefined) => Boolean(shape && WIDE_SHAPES.has(shape));

/** `is_anomaly` → "Anomaly" unless the measure declares its own label. */
const flagLabelOf = (meta: MetricMeta | undefined, column: string) =>
  meta?.measures?.[column]?.label ?? humanize(column.replace(/^is_/, ""));

/**
 * One catalog metric wired end to end: query, shape renderer picked by `meta.shape`, breakdown picker,
 * click-to-filter / drill drawer, CSV export. A metric the catalog doesn't list renders "Not available yet".
 */
export function MetricChartCard(props: MetricChartCardProps) {
  const { name, filters, setFilters, native, footnote, badges, variant, topN, height, className, headingLevel } = props;
  const { entry } = useCatalogEntry(name);
  const catalog = useCatalog();
  const plot = entry?.meta.shape === "timeseries" && entry.meta.plot?.length ? entry.meta.plot : undefined;
  const multi = Boolean(plot && plot.length > 1);
  const split = native === "split" && filters.currency === "native";
  // Several plotted measures already use the series slots, so the page breakdown doesn't apply here.
  const metric = useMetric(name, split || multi ? { ...filters, breakdown: undefined } : filters);
  const [drill, setDrillTarget] = useState<DrillTarget | null>(null);
  const { meta, params, data } = metric;
  const title = meta?.title ?? props.title ?? name;
  const rows = data?.rows;
  const isTimeseries = (meta?.shape ?? "timeseries") === "timeseries";
  const anomalyBuckets = useAnomalyBuckets(props.anomalies, params, Boolean(meta && isTimeseries && !meta.flag_column));
  // Pre-computed metrics are as fresh as the last materialized-view build, not the request time.
  const recompute = useRecomputeStatus(Boolean(meta?.precomputed));
  const asOf = (meta?.precomputed ? dataAsOf(recompute.data) : null) ?? data?.generated_at;
  const setDrill = (target: DrillTarget) => setDrillTarget(withDrillKey(target, catalog.data?.metrics, filters.grain));

  if (metric.missing) return <NotAvailableCard name={name} title={props.title ?? humanize(name)} className={className} />;

  const shape = inferShape(meta, rows);
  const currency: Currency = native === "usd" && filters.currency === "native" ? "usd" : filters.currency;
  const measure = props.measure ?? plot?.[0] ?? primaryMeasure(name, meta, rows);
  const plotted = measureOf(meta, measure, title);
  const minGroup = meta?.min_group ?? DEFAULT_MIN_GROUP;
  const dim: Dimension | undefined = params.breakdown ?? meta?.breakdown_dimension;
  const dimensionLabel = dim ? DIMENSION_LABELS[dim] : (meta?.measures?.dimension?.label ?? "Segment");
  const allMeasures = rows ? measureKeys(meta, rows) : [];
  const sampleMeasure =
    props.sampleMeasure ?? (plotted.unit === "count" ? measure : allMeasures.find((k) => measureOf(meta, k).unit === "count"));

  const openDrill = (extra: DrillFilters) =>
    setDrill({ metric: name, title, filters: { ...params.filters, ...extra }, from: params.from, to: params.to });

  const pickable = meta && meta.breakdowns.length > 0 && !split && !multi && shape !== "cohort" && shape !== "kpi" && shape !== "table";
  const defaultDim = shape !== "timeseries" ? meta?.breakdown_dimension : undefined;
  const picker = pickable && (
    <select
      aria-label={`Break down ${title}`}
      className={controlClass}
      value={params.breakdown ?? ""}
      onChange={(e) => setFilters({ breakdown: (e.target.value || undefined) as Dimension | undefined })}
    >
      <option value="">{defaultDim ? `By ${DIMENSION_LABELS[defaultDim].toLowerCase()}` : "No breakdown"}</option>
      {meta.breakdowns
        .filter((d) => d !== defaultDim)
        .map((d) => (
          <option key={d} value={d}>
            By {DIMENSION_LABELS[d].toLowerCase()}
          </option>
        ))}
    </select>
  );

  const timeseries = (allRows: Row[]) => {
    const onPointClick = pointHandler({
      metric: name,
      title,
      meta,
      filters,
      setFilters,
      dims: params.filters,
      breakdown: params.breakdown,
      openDrill: setDrill,
    });
    // One small multiple per invoice currency (USD first): USD and TRY amounts never share an axis.
    const facets = split ? [...new Set(allRows.map((r) => String(r.dimension ?? "")))].sort((a, b) => b.localeCompare(a)) : [null];
    // Plotted measures of different units never share an axis either: one chart per unit.
    const groups = plot ? groupByUnit(meta, plot) : [{ unit: plotted.unit, keys: [measure] }];
    const panels = facets.flatMap((facet) => groups.map((group) => ({ facet, group })));
    const flagColumn = meta?.flag_column;
    const anomalyLabel = params.breakdown ? "Anomaly in total" : "Anomaly";
    return panels.map(({ facet, group }, i) => {
      const panelRows = facet === null ? allRows : allRows.filter((r) => String(r.dimension ?? "") === facet).map((r) => ({ ...r, dimension: null }));
      const panelCurrency = facet === null ? currency : (FACET_CURRENCY[facet] ?? "native");
      const single = group.keys.length === 1 ? measureOf(meta, group.keys[0], title) : undefined;
      const axisLabel = single ? labelWithUnit(single, panelCurrency) : unitSuffix(group.unit, panelCurrency) || "Count";
      const chart = (
        <TimeSeriesChart
          rows={panelRows}
          measure={group.keys[0]}
          label={single?.label ?? title}
          axisLabel={axisLabel}
          grain={filters.grain}
          variant={plot ? (meta?.stacked ? "bar" : (variant ?? "line")) : (variant ?? (params.breakdown ? "line" : "bar"))}
          topN={topN}
          height={panels.length > 1 ? 200 : height}
          formatValue={(v) => formatValue(v, group.unit, panelCurrency)}
          formatAxis={(v) => formatValue(v, group.unit, panelCurrency, true)}
          onPointClick={onPointClick}
          sampleMeasure={plot ? undefined : (props.sampleMeasure ?? (plotted.unit === "count" ? measure : undefined))}
          minGroup={minGroup}
          eras={erasFor(name)}
          range={{ from: params.from, to: params.to }}
          hideEraList={i < panels.length - 1}
          measures={plot ? group.keys.map((key) => ({ key, label: measureOf(meta, key).label })) : undefined}
          stacked={Boolean(meta?.stacked)}
          flags={flagColumn ? flaggedBuckets(panelRows, flagColumn) : anomalyBuckets}
          flagLabel={flagColumn ? flagLabelOf(meta, flagColumn) : anomalyBuckets ? anomalyLabel : undefined}
        />
      );
      return facet === null ? (
        <div key={`${facet}-${i}`}>{chart}</div>
      ) : (
        <section key={`${facet}-${i}`} aria-label={`${single?.label ?? title} in ${facet}`}>
          {chart}
        </section>
      );
    });
  };

  const body = (list: Row[]): ReactNode => {
    switch (shape) {
      case "breakdown": {
        const measures = allMeasures.includes(measure) ? allMeasures : [measure, ...allMeasures];
        return (
          <BreakdownChart
            rows={list}
            meta={meta}
            measure={measure}
            measures={measures}
            currency={currency}
            dimensionLabel={dimensionLabel}
            topN={topN}
            minGroup={minGroup}
            sampleMeasure={sampleMeasure}
            clickLabel={meta?.drill ? "Show users for" : "Filter to"}
            onBarClick={
              meta?.drill
                ? (value) => openDrill({ [dim ?? "dimension"]: value })
                : dim
                  ? (value) =>
                      setFilters({
                        filters: { ...filters.filters, [dim]: value },
                        ...(filters.breakdown === dim ? { breakdown: undefined } : {}),
                      })
                  : undefined
            }
          />
        );
      }
      case "funnel":
        return (
          <FunnelChart
            rows={list}
            meta={meta}
            currency={currency}
            dimensionLabel={dimensionLabel}
            minGroup={minGroup}
            topN={topN}
            onStepClick={
              meta?.drill
                ? (step, funnel) => openDrill({ step: step.step, ...(funnel.dimension !== null ? { [dim ?? "dimension"]: funnel.dimension } : {}) })
                : undefined
            }
          />
        );
      case "cohort":
        return (
          <CohortHeatmap
            rows={list}
            meta={meta}
            currency={currency}
            grain={filters.grain}
            minGroup={minGroup}
            onCellClick={meta?.drill ? (cohort, period) => openDrill({ cohort, period }) : undefined}
          />
        );
      case "kpi":
        return list[0] ? <KpiList row={list[0]} meta={meta} currency={currency} /> : null;
      case "table":
        return <DataTable rows={list} meta={meta} currency={currency} label={title} />;
      default:
        return timeseries(list);
    }
  };

  const shownMeasures = shape === "timeseries" ? (plot ?? [measure]) : allMeasures.length ? allMeasures : [measure];

  return (
    <>
      <ChartCard
        title={title}
        meta={meta}
        generatedAt={asOf}
        loading={metric.isPending}
        refreshing={metric.isPlaceholderData || metric.isFetching}
        error={metric.isError && !data ? metric.error : undefined}
        staleError={metric.isError && data ? metric.error : undefined}
        empty={rows?.length === 0}
        onRetry={() => void metric.refetch()}
        onExport={() => downloadCsv(name, params, csvHeaders(meta, currency))}
        actions={picker}
        badges={rows && badges?.(rows, meta, currency)}
        caveat={notFilteredBy(ignoredFilters(meta, filters, shownMeasures)) || undefined}
        className={className}
        headingLevel={headingLevel}
      >
        {rows && (
          <div className="flex flex-col gap-4">
            {body(rows)}
            {footnote && <div className="text-xs text-muted-foreground">{footnote(rows, meta, currency)}</div>}
          </div>
        )}
      </ChartCard>
      {drill && <DrillDrawer {...drill} onClose={() => setDrillTarget(null)} />}
    </>
  );
}
