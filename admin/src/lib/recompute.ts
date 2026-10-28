import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, ApiError, CATALOG_KEY, METRIC_NAME, parseEnvelope, request, type CatalogEntry } from "./api";

/**
 * Recompute of the pre-computed (materialized-view) metrics: `POST /admin/recompute` queues a run that the database
 * picks up within a minute; `GET /admin/recompute/status` reports the latest run of any kind (nightly or on request)
 * and `as_of`, when the views were last built. While a run is open the status query polls every 5 s; when a new
 * finished run shows up, the pre-computed metric queries are invalidated.
 */

export const RECOMPUTE_STATUS_KEY = ["recompute/status"] as const;
export const POLL_MS = 5_000;

const text = z.string().nullable().optional().catch(null).transform((v) => v ?? null);
const id = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .catch(null)
  .transform((v) => (v === null || v === undefined ? null : String(v)));
const numberOrNull = z
  .preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite().nullable().optional())
  .catch(null)
  .transform((v) => v ?? null);

export const RUN_STATUSES = ["pending", "running", "done", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

const runSchema = z.object({
  run_id: id,
  kind: text,
  status: z.enum(RUN_STATUSES).nullable().optional().catch(null).transform((v) => v ?? null),
  requested_at: text,
  requested_by: text,
  started_at: text,
  finished_at: text,
  duration_seconds: numberOrNull,
  error: text,
});
export type RecomputeRun = z.infer<typeof runSchema>;

/** The latest run, the open run (if any), the throttle and `as_of`; one row, or an envelope around it. */
export const recomputeStatusSchema = z.preprocess(
  (v) => (Array.isArray(v) ? (v[0] ?? {}) : v && typeof v === "object" ? v : {}),
  runSchema.extend({
    open_run_id: id,
    retry_after_seconds: numberOrNull,
    as_of: text,
    /** Optional: earlier runs, newest first, when the backend sends them. */
    history: z
      .array(z.unknown())
      .optional()
      .catch(undefined)
      .transform((items) => (items ?? []).flatMap((item) => (runSchema.safeParse(item).success ? [runSchema.parse(item)] : []))),
  }),
);
export type RecomputeStatus = z.infer<typeof recomputeStatusSchema>;

/** A run is open while it waits or runs; `open_run_id` covers a queued request behind a finished latest run. */
export const isOpen = (s: RecomputeStatus | undefined) =>
  Boolean(s && (s.status === "pending" || s.status === "running" || s.open_run_id !== null));

const finished = (s: RecomputeStatus | undefined) =>
  s && (s.status === "done" || s.status === "failed") ? `${s.run_id}|${s.finished_at}` : null;

/** When the pre-computed metrics were built: `as_of`, else the latest finished successful run. */
export function dataAsOf(s: RecomputeStatus | undefined): string | null {
  if (!s) return null;
  if (s.as_of) return s.as_of;
  if (s.status === "done" && s.finished_at) return s.finished_at;
  return s.history.find((run) => run.status === "done" && run.finished_at)?.finished_at ?? null;
}

export const fetchRecomputeStatus = (signal?: AbortSignal) => apiGet("/admin/recompute/status", recomputeStatusSchema, undefined, signal);

export type RecomputeRequest =
  | { status: "queued"; run_id: string | null }
  | { status: "throttled"; run_id: string | null; retry_after_seconds: number };

const requestSchema = z.object({
  status: z.string().optional(),
  run_id: id,
  retry_after_seconds: numberOrNull,
});

/**
 * 202 `{status: "queued", run_id}`, or 429 `{status: "throttled", run_id, retry_after_seconds}`. A 429 may arrive as a
 * success envelope or as an error envelope with the same fields in `details`; `Retry-After` is the last fallback.
 */
export async function requestRecompute(): Promise<RecomputeRequest> {
  const res = await request("/admin/recompute", {}, undefined, {}, "POST");
  if (res.status === 429) {
    let body: unknown;
    try {
      body = JSON.parse(await res.clone().text());
    } catch {
      body = undefined;
    }
    const envelope = (body ?? {}) as { data?: unknown; error?: { details?: unknown } };
    const parsed = requestSchema.safeParse(envelope.data ?? envelope.error?.details ?? {});
    const header = Number(res.headers.get("Retry-After"));
    const retry = (parsed.success ? parsed.data.retry_after_seconds : null) ?? (Number.isFinite(header) && header > 0 ? header : 300);
    return { status: "throttled", run_id: parsed.success ? parsed.data.run_id : null, retry_after_seconds: Math.ceil(retry) };
  }
  const data = requestSchema.safeParse(await parseEnvelope(res));
  if (!data.success) throw new ApiError(res.status, "INVALID_RESPONSE", "Unexpected response shape from the server.");
  if (data.data.status === "throttled") {
    return { status: "throttled", run_id: data.data.run_id, retry_after_seconds: Math.ceil(data.data.retry_after_seconds ?? 300) };
  }
  return { status: "queued", run_id: data.data.run_id };
}

/** Metric names whose data a recompute changes: the catalog's pre-computed metrics plus `data_freshness`. */
export function precomputedMetrics(catalog: CatalogEntry[] | undefined) {
  return new Set([...(catalog ?? []).filter((m) => m.meta.precomputed).map((m) => m.name), "data_freshness"]);
}

/** Refetches the pre-computed metrics (every metric when the catalog isn't loaded). */
export function invalidatePrecomputed(client: QueryClient) {
  const catalog = client.getQueryData<{ metrics: CatalogEntry[] }>(CATALOG_KEY);
  const names = catalog ? precomputedMetrics(catalog.metrics) : null;
  return client.invalidateQueries({
    predicate: ({ queryKey }) =>
      typeof queryKey[0] === "string" && METRIC_NAME.test(queryKey[0]) && (!names || names.has(queryKey[0])),
  });
}

/** The shared status query: polls every 5 s while a run is open (and the tab is visible). */
export function useRecomputeStatus(enabled = true) {
  const client = useQueryClient();
  return useQuery({
    queryKey: RECOMPUTE_STATUS_KEY,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<RecomputeStatus>(RECOMPUTE_STATUS_KEY);
      const next = await fetchRecomputeStatus(signal);
      // A run finished since the last look (ours, another admin's or the nightly job): the views changed.
      if (previous && finished(next) && finished(next) !== finished(previous)) void invalidatePrecomputed(client);
      return next;
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: (query) => (isOpen(query.state.data) ? POLL_MS : false),
  });
}

export function useRequestRecompute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: requestRecompute,
    onSuccess: () => client.invalidateQueries({ queryKey: RECOMPUTE_STATUS_KEY }),
  });
}
