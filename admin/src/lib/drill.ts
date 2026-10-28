import { addDays, customRange, type Dimension, type GlobalFilters, type Grain } from "./filters";

export interface DrillPoint {
  bucket: string;
  dimension: string | null;
}

export function bucketEnd(bucket: string, grain: Grain) {
  if (grain === "week") return addDays(bucket, 6);
  if (grain === "month") {
    const [y, m] = bucket.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  return bucket;
}

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
  const end = bucketEnd(point.bucket, filters.grain);
  return {
    ...customRange(point.bucket < filters.from ? filters.from : point.bucket, end > filters.to ? filters.to : end),
    grain: "day",
  };
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
