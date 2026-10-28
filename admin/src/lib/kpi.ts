import { useMetric, type MetricMeta } from "./api";
import { addDays, daysBetween, previousPeriod, todayUtc, type GlobalFilters } from "./filters";

type Row = Record<string, unknown>;

const SUMMABLE = new Set<MetricMeta["unit"]>(["count", "currency", "tokens"]);

export const sumColumn = (rows: Row[], key: string) => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0);

/**
 * The comparison windows for a KPI delta. Today (UTC) is still filling up, so a range ending today
 * is compared on complete days only: the current window ends yesterday, the previous one has equal length.
 */
export function kpiWindows(from: string, to: string, now = new Date()) {
  const today = todayUtc(now);
  const partial = to === today;
  const end = partial ? addDays(today, -1) : to;
  if (end < from) return { partial, current: null, previous: null, days: 0 };
  return { partial, current: { from, to: end }, previous: previousPeriod(from, end), days: daysBetween(from, end) + 1 };
}

export interface KpiOptions {
  /** Column to aggregate; defaults to the metric name. */
  measure?: string;
  /** Required for units that can't be summed across buckets (percent, ratio, seconds). */
  total?: (rows: Row[]) => number | undefined;
}

export function useKpi(name: string, filters: GlobalFilters, { measure = name, total }: KpiOptions = {}) {
  const base = { ...filters, breakdown: undefined };
  const windows = kpiWindows(filters.from, filters.to);
  // Without a partial day the comparison window equals the full range, so these share one cache entry.
  const full = useMetric(name, base);
  const current = useMetric(name, { ...base, ...windows.current }, { enabled: Boolean(windows.current) });
  const previous = useMetric(name, { ...base, ...windows.previous }, { enabled: Boolean(windows.previous) });

  const unit = full.meta?.unit;
  const aggregate = (rows?: Row[]) => {
    if (!rows) return undefined;
    if (total) return total(rows);
    return unit && SUMMABLE.has(unit) ? sumColumn(rows, measure) : undefined;
  };
  const deltaReady =
    current.isSuccess && previous.isSuccess && !current.isPlaceholderData && !previous.isPlaceholderData;

  return {
    meta: full.meta,
    // Placeholder data belongs to the previous filters, so it never stands in for a headline number.
    loading: full.isPending || full.isPlaceholderData,
    error: full.error,
    value: aggregate(full.data?.rows),
    current: deltaReady ? aggregate(current.data?.rows) : undefined,
    previous: deltaReady ? aggregate(previous.data?.rows) : undefined,
    deltaLoading: Boolean(windows.current) && !deltaReady && !current.isError && !previous.isError,
    comparisonLabel: windows.current
      ? `vs previous ${windows.days} ${windows.partial ? "complete " : ""}day${windows.days === 1 ? "" : "s"}`
      : undefined,
    trend: (full.data?.rows ?? []).map((r) => Number(r[measure]) || 0),
  };
}
