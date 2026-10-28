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

/** Full range plus the two comparison windows, with the readiness rules every KPI shares. */
function useKpiQueries(name: string, filters: GlobalFilters) {
  const base = { ...filters, breakdown: undefined };
  const windows = kpiWindows(filters.from, filters.to);
  // Without a partial day the comparison window equals the full range, so these share one cache entry.
  const full = useMetric(name, base);
  const current = useMetric(name, { ...base, ...windows.current }, { enabled: Boolean(windows.current) });
  const previous = useMetric(name, { ...base, ...windows.previous }, { enabled: Boolean(windows.previous) });
  const deltaReady =
    current.isSuccess && previous.isSuccess && !current.isPlaceholderData && !previous.isPlaceholderData;
  return {
    meta: full.meta,
    // Placeholder data belongs to the previous filters, so it never stands in for a headline number.
    loading: full.isPending || full.isPlaceholderData,
    error: full.error,
    rows: full.data?.rows,
    currentRows: deltaReady ? current.data?.rows : undefined,
    previousRows: deltaReady ? previous.data?.rows : undefined,
    deltaLoading: Boolean(windows.current) && !deltaReady && !current.isError && !previous.isError,
    comparisonLabel: windows.current
      ? `vs previous ${windows.days} ${windows.partial ? "complete " : ""}day${windows.days === 1 ? "" : "s"}`
      : undefined,
  };
}

export function useKpi(name: string, filters: GlobalFilters, { measure = name, total }: KpiOptions = {}) {
  const { rows, currentRows, previousRows, ...rest } = useKpiQueries(name, filters);
  const unit = rest.meta?.unit;
  const aggregate = (list?: Row[]) => {
    if (!list) return undefined;
    if (total) return total(list);
    return unit && SUMMABLE.has(unit) ? sumColumn(list, measure) : undefined;
  };
  return {
    ...rest,
    value: aggregate(rows),
    current: aggregate(currentRows),
    previous: aggregate(previousRows),
    trend: (rows ?? []).map((r) => Number(r[measure]) || 0),
  };
}

/** A finite number, or undefined for null/missing cells (e.g. `revenue` in native mode). */
export const numberAt = (row: Row | undefined, key: string) => {
  const value = row?.[key];
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * A kpi-shaped metric (one row of named measures). Measures aren't summed: each column of the
 * current window's row is compared with the same column of the previous window's row.
 */
export function useKpiRow(name: string, filters: GlobalFilters) {
  const { rows, currentRows, previousRows, ...rest } = useKpiQueries(name, filters);
  const row = rows?.[0];
  return {
    ...rest,
    row,
    value: (key: string) => numberAt(row, key),
    delta: (key: string) => {
      const current = numberAt(currentRows?.[0], key);
      const previous = numberAt(previousRows?.[0], key);
      return current === undefined || previous === undefined ? {} : { current, previous };
    },
  };
}
