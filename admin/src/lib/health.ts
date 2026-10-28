import { formatDuration } from "./format";
import { num, type Row } from "./shapes";

/**
 * `analytics.data_freshness` rows: `item, label, status ('ok'|'warn'|'error'|'info'), value, value_text, at, detail`.
 * `value` means something different per check (seconds, hours, a rate or a count), so it is formatted per item.
 */
export const FRESHNESS_STATUSES = ["ok", "warn", "error", "info"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export const freshnessStatus = (value: unknown): FreshnessStatus =>
  (FRESHNESS_STATUSES as readonly unknown[]).includes(value) ? (value as FreshnessStatus) : "info";

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const DURATION_ITEMS = new Set(["nightly_refresh", "last_recompute"]);

/** "done · 12.3 s", "3.25 hours old", "2026-10 final · 41.2 TRY per USD", "4 runs". */
export function freshnessValue(row: Row): string {
  const value = num(row.value);
  const text = typeof row.value_text === "string" && row.value_text ? row.value_text : null;
  const item = String(row.item ?? "");
  if (DURATION_ITEMS.has(item)) return [text, value !== null ? formatDuration(value * 1000) : null].filter(Boolean).join(" · ");
  if (item === "scheduler") return text ?? "";
  if (item === "pending_recompute") return value ? `${plain.format(value)} queued` : "none";
  if (item === "fx_latest_month") return [text, value !== null ? `${plain.format(value)} TRY per USD` : null].filter(Boolean).join(" · ");
  return [value !== null ? plain.format(value) : null, text].filter(Boolean).join(" ");
}

/**
 * A short, non-personal note from `detail`: a run's error, the models with unpriced runs, the scheduled jobs. Other
 * detail keys are not shown.
 */
export function freshnessNote(row: Row): string | null {
  const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : null;
  if (!detail) return null;
  if (typeof detail.error === "string" && detail.error) return detail.error;
  if (detail.models && typeof detail.models === "object") {
    const models = Object.entries(detail.models as Record<string, unknown>)
      .map(([model, n]) => [model, num(n) ?? 0] as const)
      .sort((a, b) => b[1] - a[1]);
    return models.length ? models.map(([model, n]) => `${model}: ${n}`).join(", ") : null;
  }
  return null;
}

/** "2 errors, 1 warning" (errors and warnings only); null when every check is ok or informational. */
export function freshnessSummary(rows: Row[]): string | null {
  const count = (s: FreshnessStatus) => rows.filter((r) => freshnessStatus(r.status) === s).length;
  const parts = [
    [count("error"), "error"],
    [count("warn"), "warning"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : null;
}
