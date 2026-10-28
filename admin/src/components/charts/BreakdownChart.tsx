import { useMemo } from "react";
import { SmallSampleBadge } from "@/components/Badge";
import { measureOf, type MetricMeta } from "@/lib/api";
import type { Currency } from "@/lib/filters";
import { formatValue, labelWithUnit } from "@/lib/format";
import { barGeometry, isSummable, rankBreakdown, type BreakdownBar, type Row } from "@/lib/shapes";
import { cn } from "@/lib/utils";
import { ChartFrame, TipBody, useHoverTip } from "./ChartFrame";
import { DataTable } from "./DataTable";

export interface BreakdownChartProps {
  rows: Row[];
  meta?: MetricMeta;
  /** Primary measure: bar length and sort order. */
  measure: string;
  /** Every measure, primary included; the rest show in the tooltip and the table. */
  measures: string[];
  currency: Currency;
  /** What the `dimension` column holds, e.g. "Plan". */
  dimensionLabel: string;
  topN?: number;
  minGroup: number;
  /** Count column behind each bar for the small-sample badge. */
  sampleMeasure?: string;
  /** Set when clicking a bar does something (filter the page, or open the users behind it). */
  onBarClick?: (dimension: string) => void;
  /** Accessible verb for the click, e.g. "Filter to" or "Show users for". */
  clickLabel?: string;
}

const LABEL_ROOM = "4.5rem";

/** Horizontal bars of one measure by `dimension`, largest first, long tails folded into "Other". */
export function BreakdownChart(props: BreakdownChartProps) {
  const { rows, meta, measure, measures, currency, dimensionLabel, topN = 8, minGroup, sampleMeasure, onBarClick, clickLabel = "Filter to" } = props;
  const primary = measureOf(meta, measure);
  const { bars, hidden } = useMemo(
    () => rankBreakdown(rows, measure, { measures, topN, summable: (k) => isSummable(meta, k), sampleMeasure, minGroup }),
    [rows, measure, measures, topN, meta, sampleMeasure, minGroup],
  );
  const tip = useHoverTip();
  const values = bars.map((b) => b.value ?? 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const negative = min < 0;
  const fmt = (key: string, v: number | null, short = false) =>
    v === null ? "—" : formatValue(v, measureOf(meta, key).unit, currency, short);

  const tipFor = (b: BreakdownBar) => (
    <TipBody
      title={b.folded ? `${b.label} (${b.folded} groups)` : b.label}
      rows={measures.map((k) => ({ label: measureOf(meta, k).label, value: fmt(k, b.values[k] ?? null) }))}
    />
  );

  const caption = `${labelWithUnit(primary, currency)} by ${dimensionLabel.toLowerCase()}`;
  const table = (
    <DataTable
      rows={rows}
      meta={meta}
      currency={currency}
      columns={["dimension", ...measures]}
      labels={{ dimension: dimensionLabel }}
      label={caption}
    />
  );

  return (
    <ChartFrame caption={caption} table={table}>
      <div ref={tip.ref} className="relative">
        <ul aria-label={caption} className="flex flex-col gap-1">
          {bars.map((b) => {
            const geo = barGeometry(b.value ?? 0, min, max);
            const clickable = Boolean(onBarClick && b.dimension !== null);
            const content = (
              <>
                <span className="flex min-w-0 items-center gap-1.5 text-left text-xs text-muted-foreground">
                  <span className="truncate" title={b.label}>
                    {b.label}
                  </span>
                  <span className="sr-only">: {fmt(measure, b.value)}</span>
                  {b.small && <SmallSampleBadge minGroup={minGroup} />}
                </span>
                <span className="relative h-7" aria-hidden="true">
                  <span className="absolute inset-y-0" style={{ left: negative ? LABEL_ROOM : 0, right: LABEL_ROOM }}>
                    {b.value !== null && geo.width > 0 && (
                      <span
                        data-testid="bar"
                        className={cn(
                          "absolute top-1/2 h-4 -translate-y-1/2",
                          (b.value ?? 0) < 0 ? "rounded-l-[4px]" : "rounded-r-[4px]",
                          b.small && "opacity-60",
                        )}
                        style={{
                          left: `${geo.start}%`,
                          width: `max(${geo.width}%, 2px)`,
                          background: b.dimension === null && b.folded ? "var(--series-other)" : "var(--series-1)",
                        }}
                      />
                    )}
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium tabular-nums text-foreground"
                      style={
                        (b.value ?? 0) < 0
                          ? { right: `calc(${100 - geo.start}% + 6px)` }
                          : { left: `calc(${geo.start + geo.width}% + 6px)` }
                      }
                    >
                      {fmt(measure, b.value, true)}
                    </span>
                  </span>
                </span>
              </>
            );
            const rowClass = "grid w-full grid-cols-[minmax(4rem,9rem)_minmax(0,1fr)] items-center gap-3 rounded";
            return (
              <li key={b.key}>
                {clickable ? (
                  <button
                    type="button"
                    className={cn(rowClass, "cursor-pointer hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring")}
                    aria-label={`${clickLabel} ${b.label} (${fmt(measure, b.value)})`}
                    onClick={() => onBarClick!(b.dimension!)}
                    {...tip.bind(tipFor(b))}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={rowClass} tabIndex={0} {...tip.bind(tipFor(b))}>
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {hidden > 0 && (
          <p className="mt-2 text-xs text-subtle">
            Top {bars.length} of {bars.length + hidden} shown; the table lists all.
          </p>
        )}
        {tip.node}
      </div>
    </ChartFrame>
  );
}
