import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchMetric, useCatalogEntry, type MetricParams } from "./api";
import { flaggedBuckets } from "./shapes";

export const ANOMALY_COLUMN = "is_anomaly";

/**
 * The anomaly metric's params for a host chart: same range, grain, currency and internal flag, no breakdown (the
 * markers flag the total), and the host's filters. Null when the anomaly metric can't apply one of those filters,
 * since markers computed on a wider population than the chart would mislead.
 */
export function anomalyParams(host: MetricParams, accepted: readonly string[]): MetricParams | null {
  const keys = Object.keys(host.filters);
  if (keys.some((key) => !accepted.includes(key))) return null;
  const { breakdown: _breakdown, ...rest } = host;
  return rest;
}

/**
 * Buckets flagged `is_anomaly` by `source` (e.g. `ai_cost_anomalies`) for a host timeseries, or undefined when there
 * is no source, the catalog doesn't list it (not shipped yet) or it can't match the host's filters. Errors only
 * drop the markers; the chart itself is unaffected.
 */
export function useAnomalyBuckets(source: string | undefined, host: MetricParams, enabled: boolean): Set<string> | undefined {
  const { entry } = useCatalogEntry(source ?? "");
  const params = entry && entry.meta.shape === "timeseries" ? anomalyParams(host, entry.meta.filters) : null;
  const query = useQuery({
    queryKey: [source ?? "", params],
    queryFn: ({ signal }) => fetchMetric(source!, params!, signal),
    enabled: Boolean(source && params && enabled),
    placeholderData: keepPreviousData,
  });
  const rows = source && params && enabled ? query.data?.rows : undefined;
  return useMemo(() => (rows ? flaggedBuckets(rows, ANOMALY_COLUMN) : undefined), [rows]);
}
