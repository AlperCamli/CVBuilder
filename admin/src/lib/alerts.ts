import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, apiSend, measureOf, type CatalogEntry, type MetricMeta, type Unit } from "./api";
import { CURRENCIES, type Currency } from "./filters";
import { formatValue } from "./format";

/**
 * In-app alerts (api-contract.md "Phase 5"): rules on an alertable KPI metric's measure, evaluated hourly in the
 * database; fired events are listed, acknowledged and counted in the header badge.
 *
 * Thresholds are stored in the measure's own unit: ratio/percent measures as 0–1 fractions (as the metrics return
 * them) and `pct_change_*` thresholds as signed fractions of the previous window (0.5 = +50%, -0.2 = −20%). The
 * form shows both as percentages. `pct_change_lt` fires when the change is below the (usually negative) threshold.
 */

export const WINDOWS = ["today", "1d", "7d", "30d"] as const;
export const CONDITIONS = ["gt", "lt", "pct_change_gt", "pct_change_lt"] as const;
export type AlertWindow = (typeof WINDOWS)[number];
export type AlertCondition = (typeof CONDITIONS)[number];

export const WINDOW_LABELS: Record<AlertWindow, string> = {
  today: "Today so far",
  "1d": "Yesterday",
  "7d": "Last 7 complete days",
  "30d": "Last 30 complete days",
};
export const CONDITION_LABELS: Record<AlertCondition, string> = {
  gt: "Is above",
  lt: "Is below",
  pct_change_gt: "Change vs previous window is above",
  pct_change_lt: "Change vs previous window is below",
};

export const ALERT_KEYS = {
  rules: ["alerts/rules"] as const,
  events: (status: EventStatus) => ["alerts/events", status] as const,
  summary: ["alerts/summary"] as const,
};
export const EVENTS_LIMIT = 50;
export const SUMMARY_POLL_MS = 60_000;

// --- Schemas -----------------------------------------------------------------------------------------------

const id = z.union([z.string().min(1), z.number()]).transform(String);
const optionalText = z.string().nullable().optional().catch(null).transform((v) => v ?? null);
const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);
const numeric = z.preprocess(toNumber, z.number().finite());
const numericOrNull = z
  .preprocess(toNumber, z.number().finite().nullable().optional())
  .catch(null)
  .transform((v) => v ?? null);

const filterValue = z.union([z.string(), z.number(), z.boolean()]);
export const ruleParamsSchema = z.preprocess(
  (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
  z.object({
    currency: z.enum(CURRENCIES).optional().catch(undefined),
    include_internal: z.boolean().optional().catch(undefined),
    filters: z
      .record(z.union([filterValue, z.array(filterValue)]))
      .optional()
      .catch(undefined),
  }),
);
export type RuleParams = z.infer<typeof ruleParamsSchema>;

export const ruleSchema = z.object({
  id,
  name: z.string(),
  metric: z.string(),
  measure: z.string(),
  params: ruleParamsSchema,
  window: z.string(),
  condition: z.string(),
  threshold: numeric,
  cooldown_hours: z.preprocess(toNumber, z.number().int().nonnegative()).catch(24),
  enabled: z.boolean().catch(true),
  created_by: optionalText,
  created_at: optionalText,
  updated_at: optionalText,
});
export type AlertRule = z.infer<typeof ruleSchema>;

export const eventSchema = z.object({
  id,
  rule_id: id,
  rule_name: optionalText,
  metric: optionalText,
  measure: optionalText,
  condition: optionalText,
  threshold: numericOrNull,
  fired_at: z.string(),
  window_from: optionalText,
  window_to: optionalText,
  value: numericOrNull,
  baseline: numericOrNull,
  message: optionalText,
  acknowledged_by: optionalText,
  acknowledged_at: optionalText,
});
export type AlertEvent = z.infer<typeof eventSchema>;

/** A list as a bare array or wrapped (`{rules}`, `{events}`, `{rows}`); malformed items are dropped, not fatal. */
const listOf = <T extends z.ZodTypeAny>(item: T, wrapper: string) =>
  z.unknown().transform((data) => {
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const list = Array.isArray(data) ? data : Array.isArray(record[wrapper]) ? record[wrapper] : Array.isArray(record.rows) ? record.rows : [];
    return (list as unknown[]).flatMap((entry) => {
      const parsed = item.safeParse(entry);
      return parsed.success ? [parsed.data as z.output<T>] : [];
    });
  });

export const rulesSchema = listOf(ruleSchema, "rules");
export const eventsSchema = listOf(eventSchema, "events");
export const summarySchema = z.object({
  open_count: z.preprocess(toNumber, z.number().int().nonnegative()),
  latest_fired_at: optionalText,
});
export type AlertSummary = z.infer<typeof summarySchema>;

export type EventStatus = "open" | "all";

export interface RuleInput {
  name: string;
  metric: string;
  measure: string;
  params: RuleParams;
  window: AlertWindow;
  condition: AlertCondition;
  threshold: number;
  cooldown_hours: number;
  enabled: boolean;
}

// --- Requests ----------------------------------------------------------------------------------------------

const rulePath = (ruleId: string) => `/admin/alerts/rules/${encodeURIComponent(ruleId)}`;

export const fetchRules = (signal?: AbortSignal) => apiGet("/admin/alerts/rules", rulesSchema, undefined, signal);
export const fetchEvents = (status: EventStatus, signal?: AbortSignal) =>
  apiGet("/admin/alerts/events", eventsSchema, { status, limit: String(EVENTS_LIMIT) }, signal);
export const fetchSummary = (signal?: AbortSignal) => apiGet("/admin/alerts/summary", summarySchema, undefined, signal);
export const createRule = (input: RuleInput) => apiSend("POST", "/admin/alerts/rules", ruleSchema, input);
export const updateRule = (ruleId: string, patch: Partial<RuleInput>) => apiSend("PATCH", rulePath(ruleId), ruleSchema, patch);
export const deleteRule = (ruleId: string) => apiSend("DELETE", rulePath(ruleId), z.unknown());
export const ackEvent = (eventId: string) =>
  apiSend("POST", `/admin/alerts/events/${encodeURIComponent(eventId)}/ack`, eventSchema.partial().passthrough(), {});

// --- Hooks -------------------------------------------------------------------------------------------------

const isAlertKey = (key: readonly unknown[]) => typeof key[0] === "string" && key[0].startsWith("alerts/");
export const invalidateAlerts = (client: QueryClient) => client.invalidateQueries({ predicate: ({ queryKey }) => isAlertKey(queryKey) });

export const useAlertRules = () => useQuery({ queryKey: ALERT_KEYS.rules, queryFn: ({ signal }) => fetchRules(signal), staleTime: 30_000 });

export const useAlertEvents = (status: EventStatus) =>
  useQuery({ queryKey: ALERT_KEYS.events(status), queryFn: ({ signal }) => fetchEvents(status, signal), staleTime: 30_000 });

/** Header badge and Overview banner: refetched every 60 s while the tab is visible, and on returning to it. */
export const useAlertSummary = () =>
  useQuery({
    queryKey: ALERT_KEYS.summary,
    queryFn: ({ signal }) => fetchSummary(signal),
    staleTime: 30_000,
    refetchInterval: SUMMARY_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

/** Create (no id) or full update (PATCH with every editable field); not optimistic, the server validates. */
export function useSaveRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id: ruleId, input }: { id?: string; input: RuleInput }) => (ruleId ? updateRule(ruleId, input) : createRule(input)),
    onSettled: () => invalidateAlerts(client),
  });
}

/** Deletes after the inline confirm; events cascade server-side, so every alert list is refetched. */
export function useDeleteRule() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (ruleId: string) => deleteRule(ruleId), onSettled: () => invalidateAlerts(client) });
}

/** Enable/disable is optimistic: the switch flips at once and rolls back if the PATCH fails. */
export function useToggleRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id: ruleId, enabled }: { id: string; enabled: boolean }) => updateRule(ruleId, { enabled }),
    onMutate: async ({ id: ruleId, enabled }) => {
      await client.cancelQueries({ queryKey: ALERT_KEYS.rules });
      const previous = client.getQueryData<AlertRule[]>(ALERT_KEYS.rules);
      client.setQueryData<AlertRule[]>(ALERT_KEYS.rules, (rules) => rules?.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(ALERT_KEYS.rules, context.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ALERT_KEYS.rules }),
  });
}

/**
 * Acknowledge is optimistic: the event leaves the open list, is marked acknowledged in "all" and the open count
 * drops by one ("by you" until the refetch brings the server's record); everything rolls back if the request fails.
 */
export function useAckEvent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => ackEvent(eventId),
    onMutate: async (eventId) => {
      await client.cancelQueries({ predicate: ({ queryKey }) => isAlertKey(queryKey) && queryKey[0] !== ALERT_KEYS.rules[0] });
      const open = client.getQueryData<AlertEvent[]>(ALERT_KEYS.events("open"));
      const all = client.getQueryData<AlertEvent[]>(ALERT_KEYS.events("all"));
      const summary = client.getQueryData<AlertSummary>(ALERT_KEYS.summary);
      const at = new Date().toISOString();
      const wasOpen = [...(open ?? []), ...(all ?? [])].some((e) => e.id === eventId && !e.acknowledged_at);
      client.setQueryData<AlertEvent[]>(ALERT_KEYS.events("open"), (list) => list?.filter((e) => e.id !== eventId));
      client.setQueryData<AlertEvent[]>(ALERT_KEYS.events("all"), (list) =>
        list?.map((e) => (e.id === eventId ? { ...e, acknowledged_at: at, acknowledged_by: "you" } : e)),
      );
      if (summary && wasOpen) client.setQueryData<AlertSummary>(ALERT_KEYS.summary, { ...summary, open_count: Math.max(0, summary.open_count - 1) });
      return { open, all, summary };
    },
    onError: (_error, _eventId, context) => {
      if (!context) return;
      client.setQueryData(ALERT_KEYS.events("open"), context.open);
      client.setQueryData(ALERT_KEYS.events("all"), context.all);
      client.setQueryData(ALERT_KEYS.summary, context.summary);
    },
    onSettled: () => client.invalidateQueries({ predicate: ({ queryKey }) => isAlertKey(queryKey) && queryKey[0] !== ALERT_KEYS.rules[0] }),
  });
}

// --- Formatting --------------------------------------------------------------------------------------------

export const isPctChange = (condition: string) => condition === "pct_change_gt" || condition === "pct_change_lt";
const isFraction = (unit: Unit) => unit === "percent" || unit === "ratio";
/** Whether the threshold is typed as a percentage (and stored as a fraction). */
export const thresholdIsPercent = (unit: Unit, condition: string) => isPctChange(condition) || isFraction(unit);

/** Stored threshold → the number in the form (fractions become percentages). */
export const thresholdToInput = (threshold: number, unit: Unit, condition: string) =>
  thresholdIsPercent(unit, condition) ? Math.round(threshold * 100 * 1e6) / 1e6 : threshold;

/** The number typed in the form → the stored threshold. */
export const inputToThreshold = (input: number, unit: Unit, condition: string) =>
  thresholdIsPercent(unit, condition) ? Math.round((input / 100) * 1e9) / 1e9 : input;

const signedPct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
export const formatChange = (fraction: number) => signedPct.format(fraction).replace("-", "−");

/** The currency a rule's amounts are in (`params.currency`, USD by default). */
export const ruleCurrency = (rule: Pick<AlertRule, "params">): Currency => rule.params.currency ?? "usd";

export const findMeta = (catalog: CatalogEntry[] | undefined, metric: string | null | undefined): MetricMeta | undefined =>
  metric ? catalog?.find((m) => m.name === metric)?.meta : undefined;

/** "Above $100", "Below 5%", "Change vs previous window above +50%". */
export function formatCondition(rule: Pick<AlertRule, "condition" | "threshold" | "measure" | "params">, meta: MetricMeta | undefined) {
  const { unit } = measureOf(meta, rule.measure);
  if (isPctChange(rule.condition)) {
    return `Change vs previous window ${rule.condition === "pct_change_gt" ? "above" : "below"} ${formatChange(rule.threshold)}`;
  }
  const word = rule.condition === "gt" ? "Above" : rule.condition === "lt" ? "Below" : rule.condition;
  return `${word} ${formatValue(rule.threshold, unit, ruleCurrency(rule))}`;
}

export const windowLabel = (window: string) => WINDOW_LABELS[window as AlertWindow] ?? window;

/** "Overview KPIs · AI cost"; raw names when the catalog doesn't know the metric. */
export const targetLabel = (metric: string, measure: string, meta: MetricMeta | undefined) =>
  `${meta?.title ?? metric} · ${meta ? measureOf(meta, measure).label : measure}`;

export interface EventReading {
  value: string;
  /** "previous window $80 (+50%)" for % change rules. */
  baseline?: string;
  /** The rule's condition at firing time when known, else the rule's current one. */
  condition?: string;
}

/** An event's value, baseline and condition, formatted in its rule's measure unit and currency. */
export function readEvent(event: AlertEvent, rule: AlertRule | undefined, meta: MetricMeta | undefined): EventReading {
  const measure = event.measure ?? rule?.measure;
  const unit = measure ? measureOf(meta, measure).unit : (meta?.unit ?? "count");
  const currency = rule ? ruleCurrency(rule) : "usd";
  const fmt = (v: number | null) => (v === null ? "—" : formatValue(v, unit, currency));
  const condition = event.condition ?? rule?.condition;
  const threshold = event.threshold ?? rule?.threshold;
  const reading: EventReading = { value: fmt(event.value) };
  if (event.baseline !== null) {
    const change = event.value !== null && event.baseline !== 0 ? (event.value - event.baseline) / Math.abs(event.baseline) : null;
    reading.baseline = `previous window ${fmt(event.baseline)}${change !== null ? ` (${formatChange(change)})` : ""}`;
  }
  if (condition && threshold !== undefined && threshold !== null && measure) {
    reading.condition = formatCondition({ condition, threshold, measure, params: rule?.params ?? {} }, meta);
  }
  return reading;
}

/** Alertable metrics (KPI-shaped, `alertable: true`) for the rule editor, by title. */
export const alertableMetrics = (catalog: CatalogEntry[] | undefined) =>
  (catalog ?? []).filter((m) => m.kind === "metric" && m.meta.alertable === true).sort((a, b) => a.meta.title.localeCompare(b.meta.title));

/** A metric's declared measures for the picker, by label. */
export const measureOptions = (meta: MetricMeta | undefined) =>
  Object.keys(meta?.measures ?? {})
    .filter((key) => key !== "dimension" && key !== meta?.flag_column)
    .map((key) => ({ key, ...measureOf(meta, key) }))
    .sort((a, b) => a.label.localeCompare(b.label));

/** "TR, US" → ["TR", "US"]; one value stays a scalar; empty → undefined. */
export function parseFilterInput(text: string): string | string[] | undefined {
  const values = [...new Set(text.split(",").map((v) => v.trim()).filter(Boolean))];
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

export const filterInputOf = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
