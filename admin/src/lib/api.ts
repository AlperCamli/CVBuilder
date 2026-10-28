import { keepPreviousData, QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { z, type ZodTypeAny } from "zod";
import { config } from "./config";
import { DIMENSIONS, type Dimension, type DimensionFilters, type GlobalFilters } from "./filters";
import { getAccessToken } from "./supabase";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const envelopeSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  }),
]);

export async function parseEnvelope(res: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  const envelope = envelopeSchema.safeParse(body);
  if (envelope.success && envelope.data.success && res.ok) return envelope.data.data;
  if (envelope.success && !envelope.data.success) {
    const { code, message, details } = envelope.data.error;
    throw new ApiError(res.status, code, message, details);
  }
  throw res.ok
    ? new ApiError(res.status, "INVALID_RESPONSE", "Unexpected response from the server.")
    : new ApiError(res.status, "HTTP_ERROR", `Request failed with status ${res.status}.`);
}

type Query = Record<string, string | undefined>;

async function request(path: string, query: Query = {}, signal?: AbortSignal): Promise<Response> {
  const url = new URL(`${config.apiBaseUrl}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  const token = await getAccessToken();
  try {
    return await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection.");
  }
}

export async function apiGet<S extends ZodTypeAny>(
  path: string,
  schema: S,
  query?: Query,
  signal?: AbortSignal,
): Promise<z.output<S>> {
  const res = await request(path, query, signal);
  const parsed = schema.safeParse(await parseEnvelope(res));
  if (!parsed.success) throw new ApiError(res.status, "INVALID_RESPONSE", "Unexpected response shape from the server.");
  return parsed.data;
}

// --- Contract types --------------------------------------------------------

const UNITS = ["count", "currency", "percent", "ratio", "seconds", "tokens"] as const;
const SHAPES = ["timeseries", "breakdown", "kpi", "table", "funnel", "cohort"] as const;
const dimensionList = z
  .array(z.string())
  .catch([])
  .transform((list) => list.filter((d): d is Dimension => (DIMENSIONS as readonly string[]).includes(d)));

export const meSchema = z.object({ email: z.string().nullable(), is_admin: z.boolean() });
export const metricMetaSchema = z.object({
  title: z.string().min(1),
  definition: z.string().catch(""),
  unit: z.enum(UNITS).catch("count"),
  shape: z.enum(SHAPES).catch("table"),
  breakdowns: dimensionList,
  filters: dimensionList,
  kb: z.string().optional(),
  consent_scoped: z.boolean().optional(),
  alertable: z.boolean().optional(),
  min_group: z.number().optional(),
});
const catalogEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["metric", "people"]),
  meta: z.preprocess((meta) => (meta && typeof meta === "object" ? meta : {}), metricMetaSchema.partial({ title: true })),
});
/** Entries are parsed one by one so a single malformed function comment can't take every chart down. */
export const catalogSchema = z.object({
  metrics: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const entry = catalogEntrySchema.safeParse(item);
      if (!entry.success) return [];
      const { name, kind, meta } = entry.data;
      return [{ name, kind, meta: { ...meta, title: meta.title ?? name } }];
    }),
  ),
});
export const metricResultSchema = z.object({
  metric: z.string(),
  rows: z.array(z.record(z.unknown())),
  generated_at: z.string(),
});

export type Me = z.infer<typeof meSchema>;
export type MetricMeta = z.infer<typeof metricMetaSchema>;
export type CatalogEntry = { name: string; kind: "metric" | "people"; meta: MetricMeta };
export type MetricResult = z.infer<typeof metricResultSchema>;
export type MetricParams = Omit<GlobalFilters, "breakdown" | "range"> & { breakdown?: Dimension };

const METRIC_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Narrows the global filters to what a metric accepts, so a page-wide breakdown never 400s another chart. */
export function toMetricParams(filters: GlobalFilters, meta?: MetricMeta): MetricParams {
  const { breakdown, filters: dims, range: _range, ...rest } = filters;
  const allowed = meta ? new Set(meta.filters) : undefined;
  const kept: DimensionFilters = Object.fromEntries(
    Object.entries(dims).filter(([key]) => !allowed || allowed.has(key as Dimension)),
  );
  return {
    ...rest,
    ...(breakdown && (!meta || meta.breakdowns.includes(breakdown)) ? { breakdown } : {}),
    filters: kept,
  };
}

export const metricQuery = (params: MetricParams): Query => ({
  from: params.from,
  to: params.to,
  grain: params.grain,
  currency: params.currency,
  include_internal: String(params.include_internal),
  breakdown: params.breakdown,
  filters: Object.keys(params.filters).length ? JSON.stringify(params.filters) : undefined,
});

const metricPath = (name: string) => {
  if (!METRIC_NAME.test(name)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid metric name "${name}".`);
  return `/admin/metrics/${name}`;
};

export const fetchMe = (signal?: AbortSignal) => apiGet("/admin/me", meSchema, undefined, signal);
export const fetchCatalog = (signal?: AbortSignal) => apiGet("/admin/catalog", catalogSchema, undefined, signal);
export const fetchMetric = (name: string, params: MetricParams, signal?: AbortSignal) =>
  apiGet(metricPath(name), metricResultSchema, metricQuery(params), signal);

export async function downloadCsv(name: string, params: MetricParams) {
  const res = await request(metricPath(name), { ...metricQuery(params), format: "csv" });
  if (!res.ok) await parseEnvelope(res);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `${name}_${params.from}_${params.to}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// --- Query hooks -------------------------------------------------------------

const STALE_TIME = 5 * 60_000;
// App-level keys start with "@" so they can never collide with a metric name and survive a page Refresh.
const CATALOG_KEY = ["@catalog"] as const;

/** One retry for transient failures only: 4xx won't change, and 503/504 must not re-run a 15 s query. */
export const shouldRetry = (count: number, error: unknown) =>
  count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status !== 500 && error.status !== 502);

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: STALE_TIME, refetchOnWindowFocus: false, retry: shouldRetry } },
  });

/** Keyed by Supabase user id so switching accounts never reuses another account's answer. */
export const useMe = (userId: string | undefined) =>
  useQuery({
    queryKey: ["@me", userId],
    queryFn: ({ signal }) => fetchMe(signal),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });

export const useCatalog = () =>
  useQuery({ queryKey: CATALOG_KEY, queryFn: ({ signal }) => fetchCatalog(signal), staleTime: STALE_TIME });

export function useCatalogEntry(name: string) {
  const catalog = useCatalog();
  return { ...catalog, entry: catalog.data?.metrics.find((m) => m.name === name) };
}

export function useMetric(name: string, filters: GlobalFilters, opts: { enabled?: boolean } = {}) {
  const { entry, isPending: catalogPending } = useCatalogEntry(name);
  const params = toMetricParams(filters, entry?.meta);
  const query = useQuery({
    queryKey: [name, params],
    queryFn: ({ signal }) => fetchMetric(name, params, signal),
    // Wait for the catalog so unsupported breakdowns/filters are stripped before the first request.
    enabled: (opts.enabled ?? true) && !catalogPending,
    placeholderData: keepPreviousData,
  });
  return { ...query, params, meta: entry?.meta };
}

export function useRefreshPage() {
  const client = useQueryClient();
  return useCallback(
    () =>
      client.invalidateQueries({
        predicate: ({ queryKey, state }) =>
          typeof queryKey[0] === "string" &&
          (!queryKey[0].startsWith("@") || (queryKey[0] === CATALOG_KEY[0] && state.status === "error")),
      }),
    [client],
  );
}
