import type { MetricMeta } from "./api";
import type { Currency, Grain } from "./filters";

type Unit = MetricMeta["unit"];

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatValue(value: number, unit: Unit, currency: Currency, short = false) {
  const num = short && Math.abs(value) >= 1000 ? compact.format(value) : unit === "count" ? whole.format(value) : decimal.format(value);
  switch (unit) {
    case "currency":
      return currency === "usd" ? `$${num}` : currency === "try" ? `₺${num}` : num;
    case "percent":
      return `${decimal.format(value * 100)}%`;
    case "seconds":
      return `${num} s`;
    default:
      return num;
  }
}

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
