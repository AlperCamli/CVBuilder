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

export type Query = Record<string, string | undefined>;

export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * GET with a query string, or POST/PATCH with a JSON body (people endpoints keep personal data out of URLs).
 * The method defaults to POST when there is a body and GET otherwise.
 */
export async function request(path: string, query: Query = {}, signal?: AbortSignal, body?: unknown, method?: Method): Promise<Response> {
  const url = new URL(`${config.apiBaseUrl}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  const token = await getAccessToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const hasBody = body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  try {
    return await fetch(url, {
      method: method ?? (hasBody ? "POST" : "GET"),
      headers,
      signal,
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
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
  return parseWith(schema, await request(path, query, signal));
}

/** POST a JSON body; nothing but the path ends up in the URL. */
export async function apiPost<S extends ZodTypeAny>(path: string, schema: S, body: unknown, signal?: AbortSignal): Promise<z.output<S>> {
  return parseWith(schema, await request(path, {}, signal, body));
}

/** A write (POST/PATCH/DELETE) to an admin endpoint; a 204 resolves to `undefined` without parsing. */
export async function apiSend<S extends ZodTypeAny>(
  method: Exclude<Method, "GET">,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.output<S> | undefined> {
  const res = await request(path, {}, undefined, body ?? (method === "DELETE" ? undefined : {}), method);
  if (res.status === 204) return undefined;
  return parseWith(schema, res);
}

async function parseWith<S extends ZodTypeAny>(schema: S, res: Response): Promise<z.output<S>> {
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

const measureSchema = z.object({
  label: z.string().min(1),
  unit: z.enum(UNITS).optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  /** Filters the metric accepts but this column can't apply (e.g. `plan` for signups in kpi_overview). */
  ignores_filters: dimensionList.optional(),
});
/** Per-column labels/units; a malformed entry is dropped instead of failing the whole metric. */
const measuresSchema = z
  .record(z.unknown())
  .optional()
  .catch(undefined)
  .transform((record) =>
    record
      ? Object.fromEntries(
          Object.entries(record).flatMap(([key, value]) => {
            const measure = measureSchema.safeParse(value);
            return measure.success ? [[key, measure.data] as const] : [];
          }),
        )
      : undefined,
  );

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
  measures: measuresSchema,
  /**
   * Whether a point opens the users behind it (`drill_users`). The contract lets a metric document its drill keys
   * as an object here, so an object counts as true; anything else (or a malformed value) is false.
   */
  drill: z
    .preprocess((value) => value === true || (typeof value === "object" && value !== null && !Array.isArray(value)), z.boolean())
    .optional(),
  /** breakdown/funnel shapes: the Dimension the `dimension` column holds, so a click can filter the page by it. */
  breakdown_dimension: z.enum(DIMENSIONS).optional().catch(undefined),
  /** timeseries: measures plotted as separate series (else the first measure). */
  plot: z.array(z.string().min(1)).min(1).optional().catch(undefined),
  /** timeseries with `plot`: stacked bars; negative values stack below zero. */
  stacked: z.boolean().optional().catch(undefined),
  /** timeseries: boolean column whose true rows are highlighted (e.g. `is_anomaly`). */
  flag_column: z.string().min(1).optional().catch(undefined),
  /** Read from a materialized view rebuilt nightly or by Recompute; absent means live. */
  precomputed: z.boolean().optional().catch(undefined),
  /** `drill_users` only: the supported drill keys, each naming the metric it drills and the filters it accepts. */
  drill_metrics: z
    .record(
      z.object({
        metric: z.string().nullable().optional().catch(null),
        filters: z.array(z.string()).optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
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
export type Unit = MetricMeta["unit"];
export interface Measure {
  label: string;
  unit: Unit;
  description?: string;
  ignores_filters?: Dimension[];
}
export type CatalogEntry = { name: string; kind: "metric" | "people"; meta: MetricMeta };
export type MetricResult = z.infer<typeof metricResultSchema>;
export type MetricParams = Omit<GlobalFilters, "breakdown" | "range"> & { breakdown?: Dimension };

export const DEFAULT_MIN_GROUP = 5;

const humanize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

/** A column's label and unit from `meta.measures`, falling back to the metric's unit and the column name. */
export function measureOf(meta: MetricMeta | undefined, key: string, fallbackLabel?: string): Measure {
  const measure = meta?.measures?.[key];
  return {
    label: measure?.label ?? fallbackLabel ?? humanize(key),
    unit: measure?.unit ?? meta?.unit ?? "count",
    ...(measure?.description ? { description: measure.description } : {}),
    ...(measure?.ignores_filters?.length ? { ignores_filters: measure.ignores_filters } : {}),
  };
}

/**
 * Active page filters that don't narrow these columns: either the metric doesn't accept the filter at all, or
 * one of the columns lists it in `ignores_filters`. Unknown while the catalog is loading (empty).
 */
export function ignoredFilters(meta: MetricMeta | undefined, filters: GlobalFilters, measures: string[] = []): Dimension[] {
  if (!meta) return [];
  const accepted = new Set(meta.filters);
  return (Object.keys(filters.filters) as Dimension[]).filter(
    (dim) => !accepted.has(dim) || measures.some((key) => meta.measures?.[key]?.ignores_filters?.includes(dim)),
  );
}

export const METRIC_NAME = /^[a-z][a-z0-9_]{0,62}$/;

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

const csvCell = (text: string) => {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Swaps the header row's column names for display labels; the backend's columns are plain identifiers.
 * `Response.text()` strips the BOM, so it is always re-added for Excel.
 */
export function relabelCsv(csv: string, headers: Record<string, string>) {
  const body = csv.replace(/^\uFEFF/, "");
  const end = body.search(/\r?\n/);
  const header = end === -1 ? body : body.slice(0, end);
  const relabelled = header
    .split(",")
    .map((column) => (headers[column] ? csvCell(headers[column]) : column))
    .join(",");
  return `\uFEFF${relabelled}${end === -1 ? "" : body.slice(end)}`;
}

/** Downloads any admin endpoint as CSV (`format=csv`), preferring the server's filename. */
export async function downloadCsvFrom(path: string, query: Query, fallbackName: string, headers: Record<string, string> = {}) {
  await saveCsv(await request(path, { ...query, format: "csv" }), fallbackName, headers);
}

/** The same for a POST endpoint: `format: "csv"` goes in the JSON body. */
export async function downloadCsvPost(path: string, body: Record<string, unknown>, fallbackName: string) {
  await saveCsv(await request(path, {}, undefined, { ...body, format: "csv" }), fallbackName);
}

async function saveCsv(res: Response, fallbackName: string, headers: Record<string, string> = {}) {
  if (!res.ok) await parseEnvelope(res);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const csv = relabelCsv(await res.text(), headers);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const downloadCsv = (name: string, params: MetricParams, headers: Record<string, string> = {}) =>
  downloadCsvFrom(metricPath(name), metricQuery(params), `${name}_${params.from}_${params.to}.csv`, headers);

// --- Query hooks -------------------------------------------------------------

const STALE_TIME = 5 * 60_000;
// App-level keys start with "@" so they can never collide with a metric name and survive a page Refresh.
export const CATALOG_KEY = ["@catalog"] as const;

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
  const { entry, isPending: catalogPending, isSuccess: catalogLoaded } = useCatalogEntry(name);
  const params = toMetricParams(filters, entry?.meta);
  // A loaded catalog without this metric means its SQL hasn't shipped yet: don't ask for a guaranteed 404.
  const missing = catalogLoaded && !entry;
  const query = useQuery({
    queryKey: [name, params],
    queryFn: ({ signal }) => fetchMetric(name, params, signal),
    // Wait for the catalog so unsupported breakdowns/filters are stripped before the first request.
    enabled: (opts.enabled ?? true) && !catalogPending && !missing,
    placeholderData: keepPreviousData,
  });
  return { ...query, params, meta: entry?.meta, missing };
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
