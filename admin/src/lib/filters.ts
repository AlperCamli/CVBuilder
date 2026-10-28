import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { z } from "zod";

export const DIMENSIONS = [
  "market",
  "plan",
  "locale",
  "ai_flow",
  "ai_model",
  "ai_provider",
  "template",
  "onboarding_path",
  "currency",
] as const;
export const GRAINS = ["day", "week", "month"] as const;
export const CURRENCIES = ["native", "usd", "try"] as const;
export const MAX_SPAN_DAYS = 1096;
export const MAX_FILTER_VALUES = 50;
export const DEFAULT_RANGE_DAYS = 30;

export const DATE_PRESETS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "mtd", label: "Month to date" },
  { id: "12m", label: "Last 12 months" },
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number]["id"];
const PRESET_IDS = DATE_PRESETS.map((p) => p.id) as [DatePreset, ...DatePreset[]];

export type Dimension = (typeof DIMENSIONS)[number];
export type Grain = (typeof GRAINS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type FilterValue = string | number | boolean;
export type DimensionFilters = Partial<Record<Dimension, FilterValue | FilterValue[]>>;

export interface GlobalFilters {
  /** A rolling preset, or "custom" for an explicit from/to. from/to are always resolved. */
  range: DatePreset | "custom";
  from: string;
  to: string;
  grain: Grain;
  currency: Currency;
  include_internal: boolean;
  breakdown?: Dimension;
  filters: DimensionFilters;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string) =>
  ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const isoDate = z.string().refine(isIsoDate);
const filterValue = z.union([z.string().max(200), z.number().finite(), z.boolean()]);
const filterEntry = z.union([filterValue, z.array(filterValue).min(1).max(MAX_FILTER_VALUES)]);

const parseDimensionFilters = (raw: string | undefined): DimensionFilters => {
  if (!raw) return {};
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: DimensionFilters = {};
  for (const [key, value] of Object.entries(json)) {
    const dim = z.enum(DIMENSIONS).safeParse(key);
    const val = filterEntry.safeParse(value);
    if (dim.success && val.success) out[dim.data] = val.data;
  }
  return out;
};

const searchSchema = z.object({
  range: z.enum(PRESET_IDS).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  grain: z.enum(GRAINS).catch("day"),
  currency: z.enum(CURRENCIES).catch("usd"),
  include_internal: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .catch(false),
  breakdown: z.enum(DIMENSIONS).optional().catch(undefined),
  filters: z.string().optional().transform(parseDimensionFilters).catch({}),
});

export const DEFAULT_PRESET = "30d" satisfies DatePreset;

export const isValidRange = (from: string, to: string) =>
  isIsoDate(from) && isIsoDate(to) && from <= to && daysBetween(from, to) <= MAX_SPAN_DAYS;

export function parseFilters(params: URLSearchParams, now = new Date()): GlobalFilters {
  const raw = searchSchema.parse(Object.fromEntries(params));
  // Precedence: a rolling preset, then an explicit (custom or legacy) from/to, then the default preset.
  let range: GlobalFilters["range"] = raw.range ?? (raw.from || raw.to ? "custom" : DEFAULT_PRESET);
  let { from, to } = range === "custom" ? { from: "", to: "" } : presetRange(range, now);
  if (range === "custom") {
    to = raw.to ?? todayUtc(now);
    from = raw.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    // An inverted or oversized range would be rejected by the API; fall back to the default span.
    if (!isValidRange(from, to)) from = addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  }
  return {
    range,
    from,
    to,
    grain: raw.grain,
    currency: raw.currency,
    include_internal: raw.include_internal,
    ...(raw.breakdown ? { breakdown: raw.breakdown } : {}),
    filters: raw.filters,
  };
}

/** A patch that pins an explicit range (used by the custom picker and drill-down). */
export const customRange = (from: string, to: string) => ({ range: "custom" as const, from, to });

const FILTER_KEYS = ["range", "from", "to", "grain", "currency", "include_internal", "breakdown", "filters"] as const;

/** Writes only non-default values; presets stay rolling (`range=7d`), custom ranges are explicit. */
export function writeFilters(filters: GlobalFilters, base = new URLSearchParams()) {
  const params = new URLSearchParams(base);
  FILTER_KEYS.forEach((key) => params.delete(key));
  if (filters.range === "custom") {
    params.set("from", filters.from);
    params.set("to", filters.to);
  } else if (filters.range !== DEFAULT_PRESET) {
    params.set("range", filters.range);
  }
  if (filters.grain !== "day") params.set("grain", filters.grain);
  if (filters.currency !== "usd") params.set("currency", filters.currency);
  if (filters.include_internal) params.set("include_internal", "true");
  if (filters.breakdown) params.set("breakdown", filters.breakdown);
  const keys = Object.keys(filters.filters).sort() as Dimension[];
  if (keys.length) params.set("filters", JSON.stringify(Object.fromEntries(keys.map((k) => [k, filters.filters[k]]))));
  return params;
}

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const setFilters = useCallback(
    (patch: Partial<GlobalFilters>) =>
      setParams((current) => writeFilters({ ...parseFilters(current), ...patch }, current)),
    [setParams],
  );
  return [filters, setFilters] as const;
}


export function presetRange(preset: DatePreset, now = new Date()): { from: string; to: string } {
  const to = todayUtc(now);
  switch (preset) {
    case "7d":
      return { from: addDays(to, -6), to };
    case "30d":
      return { from: addDays(to, -29), to };
    case "90d":
      return { from: addDays(to, -89), to };
    case "mtd":
      return { from: `${to.slice(0, 8)}01`, to };
    case "12m": {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return { from: addDays(d.toISOString().slice(0, 10), 1), to };
    }
  }
}

export function previousPeriod(from: string, to: string) {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}
