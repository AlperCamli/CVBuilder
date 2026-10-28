import { AlertTriangle } from "lucide-react";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface UsageCounter {
  key: string;
  label: string;
  used: number;
  /** null = unlimited / no limit on this plan. */
  limit: number | null;
  period?: string;
}

const num = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
};
const USED_KEYS = ["used", "count", "value", "usage", "current"];
const LIMIT_KEYS = ["limit", "max", "quota", "allowed"];
const firstNum = (obj: Record<string, unknown>, keys: string[]) => keys.map((k) => num(obj[k])).find((v) => v !== undefined);

function counterFrom(key: string, raw: unknown): UsageCounter | null {
  const plain = num(raw);
  if (plain !== undefined) return { key, label: humanize(key), used: plain, limit: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const used = firstNum(obj, USED_KEYS);
  if (used === undefined) return null;
  const limit = firstNum(obj, LIMIT_KEYS) ?? null;
  const label = typeof obj.label === "string" && obj.label ? obj.label : humanize(key);
  const period = typeof obj.period === "string" ? obj.period : undefined;
  return { key, label, used, limit, ...(period ? { period } : {}) };
}

/**
 * The `usage` jsonb is "counters vs plan limits" without a fixed shape in the contract, so accept the plausible ones:
 * `{ key: { used, limit } }`, `[{ key|name, used, limit }]`, and flat `{ key_used, key_limit }` / `{ key: n }`.
 * Anything unrecognised is skipped rather than guessed at.
 */
export function parseUsage(usage: unknown): UsageCounter[] {
  if (Array.isArray(usage)) {
    return usage.flatMap((item, i) => {
      if (!item || typeof item !== "object") return [];
      const obj = item as Record<string, unknown>;
      const key = [obj.key, obj.name, obj.counter, obj.feature].find((k): k is string => typeof k === "string") ?? `counter_${i + 1}`;
      return counterFrom(key, obj) ?? [];
    });
  }
  if (!usage || typeof usage !== "object") return [];
  const obj = usage as Record<string, unknown>;
  if (obj.counters && typeof obj.counters === "object") return parseUsage(obj.counters);
  const flatLimits = new Map<string, number>();
  for (const [k, v] of Object.entries(obj)) {
    const m = /^(.+)_(limit|max|quota)$/.exec(k);
    if (m && num(v) !== undefined) flatLimits.set(m[1], num(v)!);
  }
  return Object.entries(obj).flatMap(([k, v]) => {
    if (/_(limit|max|quota)$/.test(k)) return [];
    const base = k.replace(/_(used|count)$/, "");
    if (num(v) !== undefined && base !== k) return [{ key: base, label: humanize(base), used: num(v)!, limit: flatLimits.get(base) ?? null }];
    if (num(v) !== undefined && flatLimits.has(k)) return [{ key: k, label: humanize(k), used: num(v)!, limit: flatLimits.get(k)! }];
    return counterFrom(k, v) ?? [];
  });
}

const count = new Intl.NumberFormat("en-US");

/** Fill carries severity (accent → warning → limit reached); the track is a light step of the same colour. */
function Meter({ counter }: { counter: UsageCounter }) {
  const { label, used, limit, period } = counter;
  const ratio = limit && limit > 0 ? Math.min(used / limit, 1) : limit === 0 ? 1 : 0;
  const atLimit = limit !== null && used >= limit;
  const near = !atLimit && limit !== null && ratio >= 0.8;
  const color = atLimit ? "var(--delta-bad)" : near ? "var(--warning)" : "var(--series-1)";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
          {period && <span className="text-subtle"> · {period}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {atLimit && <AlertTriangle className="size-3 text-delta-bad" aria-hidden="true" />}
          {count.format(used)}
          <span className="text-subtle">/ {limit === null ? "no limit" : count.format(limit)}</span>
          {atLimit && <span className="sr-only">(limit reached)</span>}
        </span>
      </div>
      {limit !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${count.format(used)} of ${count.format(limit)}${atLimit ? ", limit reached" : ""}`}
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}
        >
          <div className={cn("h-full rounded-full")} style={{ width: `${ratio * 100}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

export function UsageMeters({ usage }: { usage: unknown }) {
  const counters = parseUsage(usage);
  if (counters.length === 0) return <p className="text-xs text-subtle">No usage counters for this plan.</p>;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {counters.map((c) => (
        <Meter key={c.key} counter={c} />
      ))}
    </div>
  );
}
