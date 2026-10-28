import { measureOf, type MetricMeta } from "@/lib/api";
import type { Currency } from "@/lib/filters";
import { formatValue } from "@/lib/format";
import { measureKeys, num, type Row } from "@/lib/shapes";

/** A kpi-shaped metric inside a card: its one row as a compact list of measures (no deltas; Overview tiles do that). */
export function KpiList({ row, meta, currency }: { row: Row; meta?: MetricMeta; currency: Currency }) {
  const keys = measureKeys(meta, [row]);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {keys.map((key) => {
        const value = num(row[key]);
        const m = measureOf(meta, key);
        return (
          <div key={key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="truncate text-xs text-muted-foreground" title={m.description ?? m.label}>
              {m.label}
            </dt>
            <dd className="text-lg font-semibold">{value === null ? <span className="text-subtle">—</span> : formatValue(value, m.unit, currency)}</dd>
          </div>
        );
      })}
    </dl>
  );
}
