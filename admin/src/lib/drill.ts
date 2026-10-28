import type { CatalogEntry, MetricMeta } from "./api";
import { addDays, customRange, type Dimension, type DimensionFilters, type FilterValue, type GlobalFilters, type Grain } from "./filters";

/** `drill_users` filters: the metric's dimension filters plus metric-specific keys (e.g. `step`, `cohort`). */
export type DrillFilters = Record<string, FilterValue | FilterValue[]>;

export interface DrillPoint {
  bucket: string;
  dimension: string | null;
}

/** What the users drawer lists: `drill_users` for one metric point. */
export interface DrillTarget {
  metric: string;
  title: string;
  filters: DrillFilters;
  from: string;
  to: string;
}

export function bucketEnd(bucket: string, grain: Grain) {
  if (grain === "week") return addDays(bucket, 6);
  if (grain === "month") {
    const [y, m] = bucket.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return bucket;
}

/** A bucket's days, clamped to the page range (the first and last week/month can be partial). */
const bucketRange = (filters: GlobalFilters, bucket: string) => {
  const end = bucketEnd(bucket, filters.grain);
  return { from: bucket < filters.from ? filters.from : bucket, to: end > filters.to ? filters.to : end };
};

/** Whether clicking a point does anything, so charts only look clickable when it does. */
export const canDrill = (filters: GlobalFilters, breakdown?: Dimension) => Boolean(breakdown) || filters.grain !== "day";

/**
 * A breakdown series filters the page to that value; a week/month bucket zooms into its days.
 * Returns null when the click has nothing to drill into.
 */
export function drillPatch(filters: GlobalFilters, breakdown: Dimension | undefined, point: DrillPoint): Partial<GlobalFilters> | null {
  if (breakdown) {
    if (!point.dimension) return null;
    return { filters: { ...filters.filters, [breakdown]: point.dimension }, breakdown: undefined };
  }
  if (filters.grain === "day") return null;
  const { from, to } = bucketRange(filters, point.bucket);
  return { ...customRange(from, to), grain: "day" };
}

export function drillHandler(
  filters: GlobalFilters,
  setFilters: (patch: Partial<GlobalFilters>) => void,
  breakdown?: Dimension,
): ((point: DrillPoint) => void) | undefined {
  if (!canDrill(filters, breakdown)) return undefined;
  return (point) => {
    const patch = drillPatch(filters, breakdown, point);
    if (patch) setFilters(patch);
  };
}

/**
 * The users behind a point: the metric's own dimension filters, plus the clicked series value, over the bucket's days.
 * Null for the folded "Other" series, which has no single value to filter on.
 */
export function drillTarget(
  metric: string,
  title: string,
  filters: GlobalFilters,
  dims: DimensionFilters,
  breakdown: Dimension | undefined,
  point: DrillPoint,
): DrillTarget | null {
  if (breakdown && !point.dimension) return null;
  return {
    metric,
    title,
    filters: breakdown ? { ...dims, [breakdown]: point.dimension! } : { ...dims },
    ...bucketRange(filters, point.bucket),
  };
}

interface PointHandlerOptions {
  metric: string;
  title: string;
  meta: MetricMeta | undefined;
  filters: GlobalFilters;
  setFilters: (patch: Partial<GlobalFilters>) => void;
  /** The metric's effective params (filters narrowed to what it accepts, breakdown if supported). */
  dims: DimensionFilters;
  breakdown?: Dimension;
  openDrill: (target: DrillTarget) => void;
}

/** Metrics flagged `meta.drill` open the users drawer for any point; the rest keep filtering/zooming the page. */
export function pointHandler(opts: PointHandlerOptions): ((point: DrillPoint) => void) | undefined {
  const { metric, title, meta, filters, setFilters, dims, breakdown, openDrill } = opts;
  if (!meta?.drill) return drillHandler(filters, setFilters, breakdown);
  return (point) => {
    const target = drillTarget(metric, title, filters, dims, breakdown, point);
    if (target) openDrill(target);
  };
}

/**
 * The `drill_users` key for a metric: the `drill_metrics` entry whose `metric` names it (keys rarely equal the
 * metric, e.g. `ai_cost` → `ai_cost_users`, `growth_accounting` → `churned_users`). A key named like the metric
 * wins a tie; without the catalog's list the metric name is used. `grain` is set when the key accepts a grain
 * filter (cohort and growth drills), so the drawer passes the page's grain along.
 */
export function drillKeyFor(catalog: CatalogEntry[] | undefined, metric: string): { key: string; grain: boolean } {
  const keys = catalog?.find((entry) => entry.name === "drill_users")?.meta.drill_metrics ?? {};
  const matches = Object.entries(keys).filter(([, meta]) => meta.metric === metric);
  const [key, meta] = matches.find(([k]) => k === metric) ?? matches[0] ?? [metric, keys[metric]];
  return { key, grain: Boolean(meta?.filters?.includes("grain")) };
}

/** Points a drill target at the metric's drill key, adding the page grain when the key takes one. */
export function withDrillKey(target: DrillTarget, catalog: CatalogEntry[] | undefined, grain: Grain): DrillTarget {
  const drill = drillKeyFor(catalog, target.metric);
  return { ...target, metric: drill.key, filters: drill.grain ? { ...target.filters, grain } : target.filters };
}
