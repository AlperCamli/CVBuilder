import { measureOf, type Measure, type MetricMeta, type Unit } from "./api";
import type { Currency, Grain } from "./filters";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatValue(value: number, unit: Unit, currency: Currency, short = false) {
  const num = short && Math.abs(value) >= 1000 ? compact.format(value) : unit === "count" ? whole.format(value) : decimal.format(value);
  switch (unit) {
    case "currency":
      return currency === "usd" ? `$${num}` : currency === "try" ? `₺${num}` : num;
    // Both are 0–1 fractions in the contract and both read as percentages.
    case "percent":
    case "ratio":
      return `${decimal.format(value * 100)}%`;
    case "seconds":
      return `${num} s`;
    default:
      return num;
  }
}

const CURRENCY_NAMES: Record<Currency, string> = { usd: "USD", try: "TRY", native: "invoice currency" };

/** The unit as it reads next to a label, e.g. "USD"; empty for plain counts. CSV percents stay 0–1 fractions. */
export function unitSuffix(unit: Unit, currency: Currency, csv = false) {
  switch (unit) {
    case "currency":
      return CURRENCY_NAMES[currency];
    case "percent":
    case "ratio":
      return csv ? "fraction 0–1" : "%";
    case "seconds":
      return "seconds";
    case "tokens":
      return "tokens";
    default:
      return "";
  }
}

export const labelWithUnit = ({ label, unit }: Measure, currency: Currency, csv = false) => {
  const suffix = unitSuffix(unit, currency, csv);
  return suffix ? `${label} (${suffix})` : label;
};

/** CSV header labels for every declared measure. */
export const csvHeaders = (meta: MetricMeta | undefined, currency: Currency) =>
  Object.fromEntries(Object.keys(meta?.measures ?? {}).map((key) => [key, labelWithUnit(measureOf(meta, key), currency, true)]));

const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts });
const dayShort = dateFmt({ day: "numeric", month: "short" });
const dayLong = dateFmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const monthFmt = dateFmt({ month: "short", year: "numeric" });
const stamp = dateFmt({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

export const formatBucket = (bucket: string, grain: Grain) =>
  (grain === "month" ? monthFmt : dayShort).format(asDate(bucket));

export const formatBucketLong = (bucket: string, grain: Grain) =>
  grain === "month"
    ? monthFmt.format(asDate(bucket))
    : grain === "week"
      ? `Week of ${dayShort.format(asDate(bucket))}, ${bucket.slice(0, 4)}`
      : dayLong.format(asDate(bucket));

export const formatTimestamp = (iso: string) => {
  const date = asDate(iso);
  return Number.isNaN(date.getTime()) ? iso : `${stamp.format(date)} UTC`;
};

/** "not filtered by plan" / "not filtered by market or plan"; empty when every active filter applies. */
export const notFilteredBy = (dims: readonly string[]) =>
  dims.length ? `Not filtered by ${dims.map((d) => (DIMENSION_LABELS[d] ?? d).toLowerCase()).join(" or ")}` : "";

export const DIMENSION_LABELS: Record<string, string> = {
  market: "Market",
  plan: "Plan",
  locale: "Locale",
  ai_flow: "AI flow",
  ai_model: "AI model",
  ai_provider: "AI provider",
  template: "Template",
  onboarding_path: "Onboarding path",
  currency: "Currency",
};

const dateOnly = dateFmt({ day: "numeric", month: "short", year: "numeric" });
const timeOnly = dateFmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** "28 Oct 2026" (UTC); null/invalid input shows an em dash. */
export const formatDate = (iso: unknown) => {
  if (typeof iso !== "string" || !iso) return "—";
  const date = asDate(iso);
  return Number.isNaN(date.getTime()) ? iso : dateOnly.format(date);
};

export const formatTime = (iso: string) => {
  const date = asDate(iso);
  return Number.isNaN(date.getTime()) ? "" : timeOnly.format(date);
};

/** 350 ms · 1.2 s · 2 m 05 s */
export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${decimal.format(Math.round(ms / 100) / 10)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${String(seconds).padStart(2, "0")} s`;
}

export const humanize = (key: string) => (key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ") : key);
