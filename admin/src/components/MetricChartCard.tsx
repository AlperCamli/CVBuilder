import { ChartCard } from "@/components/ChartCard";
import { TimeSeriesChart } from "@/components/TimeSeriesChart";
import { controlClass } from "@/components/ui/control";
import { downloadCsv, useMetric } from "@/lib/api";
import { drillHandler } from "@/lib/drill";
import type { Dimension, GlobalFilters } from "@/lib/filters";
import { DIMENSION_LABELS, formatValue } from "@/lib/format";

interface MetricChartCardProps {
  name: string;
  filters: GlobalFilters;
  setFilters: (patch: Partial<GlobalFilters>) => void;
  /** Column to plot; defaults to the metric name. */
  measure?: string;
  variant?: "line" | "bar";
  topN?: number;
  height?: number;
  className?: string;
}

/** A timeseries metric wired end to end: catalog meta, query, breakdown picker, drill-down and CSV export. */
export function MetricChartCard({ name, filters, setFilters, measure = name, variant, topN, height, className }: MetricChartCardProps) {
  const metric = useMetric(name, filters);
  const { meta, params, data } = metric;
  const title = meta?.title ?? name;
  const unit = meta?.unit ?? "count";
  const rows = data?.rows;

  const picker = meta && meta.breakdowns.length > 0 && (
    <select
      aria-label={`Break down ${title}`}
      className={controlClass}
      value={params.breakdown ?? ""}
      onChange={(e) => setFilters({ breakdown: (e.target.value || undefined) as Dimension | undefined })}
    >
      <option value="">No breakdown</option>
      {meta.breakdowns.map((d) => (
        <option key={d} value={d}>
          By {DIMENSION_LABELS[d].toLowerCase()}
        </option>
      ))}
    </select>
  );

  return (
    <ChartCard
      title={title}
      meta={meta}
      generatedAt={data?.generated_at}
      loading={metric.isPending}
      refreshing={metric.isPlaceholderData || metric.isFetching}
      error={metric.isError && !data ? metric.error : undefined}
      staleError={metric.isError && data ? metric.error : undefined}
      empty={rows?.length === 0}
      onRetry={() => void metric.refetch()}
      onExport={() => downloadCsv(name, params)}
      actions={picker}
      className={className}
    >
      {rows && (
        <TimeSeriesChart
          rows={rows}
          measure={measure}
          label={title}
          grain={filters.grain}
          variant={variant ?? (params.breakdown ? "line" : "bar")}
          topN={topN}
          height={height}
          formatValue={(v) => formatValue(v, unit, filters.currency)}
          formatAxis={(v) => formatValue(v, unit, filters.currency, true)}
          onPointClick={drillHandler(filters, setFilters, params.breakdown)}
        />
      )}
    </ChartCard>
  );
}
