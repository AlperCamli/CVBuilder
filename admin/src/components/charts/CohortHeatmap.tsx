import { useMemo } from "react";
import { Badge } from "@/components/Badge";
import type { MetricMeta } from "@/lib/api";
import type { Currency, Grain } from "@/lib/filters";
import { formatBucket, formatBucketLong } from "@/lib/format";
import { buildCohortGrid, COHORT_BINS, formatCellRate, rateBin, type CohortRow, type Row } from "@/lib/shapes";
import { cn } from "@/lib/utils";
import { ChartFrame, TipBody, useHoverTip } from "./ChartFrame";
import { DataTable } from "./DataTable";

export interface CohortHeatmapProps {
  rows: Row[];
  meta?: MetricMeta;
  currency: Currency;
  /** The page grain names the cohort and period unit (week cohorts, weeks since joining). */
  grain: Grain;
  minGroup: number;
  /** Set when a cell opens the users behind it (`meta.drill`). */
  onCellClick?: (cohort: string, period: number) => void;
}

const count = new Intl.NumberFormat("en-US");
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const PERIOD_UNIT: Record<Grain, string> = { day: "Day", week: "Week", month: "Month" };

/** Cohort rows × period columns; each cell is the share of the cohort active, on a one-hue sequential scale. */
export function CohortHeatmap({ rows, meta, currency, grain, minGroup, onCellClick }: CohortHeatmapProps) {
  const grid = useMemo(() => buildCohortGrid(rows), [rows]);
  const tip = useHoverTip();
  const unit = PERIOD_UNIT[grain];
  const caption = `Share of each cohort active, by ${unit.toLowerCase()}s since joining`;
  const table = (
    <DataTable
      rows={rows}
      meta={meta}
      currency={currency}
      label={caption}
      labels={{ cohort: "Cohort", period: `${unit}s since joining`, cohort_size: "Cohort size", active: "Active", rate: "Rate" }}
    />
  );

  const cellTip = (c: CohortRow, period: number, rate: number, active: number | null) => (
    <TipBody
      title={`${formatBucketLong(c.cohort, grain)} · ${unit} ${period}`}
      rows={[
        { label: "Active", value: pct.format(rate) },
        { label: "Users", value: `${active === null ? "—" : count.format(active)} of ${count.format(c.size)}` },
      ]}
    />
  );

  return (
    <ChartFrame caption={caption} table={table}>
      <div ref={tip.ref} className="relative flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] text-subtle" aria-hidden="true">
          <span>0%</span>
          <span className="flex">
            {Array.from({ length: COHORT_BINS }, (_, i) => (
              <span key={i} className="h-2.5 w-5 first:rounded-l-sm last:rounded-r-sm" style={{ background: `var(--seq-${i + 1})` }} />
            ))}
          </span>
          <span>{formatCellRate(grid.max)}+</span>
          <span className="ml-2">
            {unit} 0 is the joining {unit.toLowerCase()}; scale tops out at the highest later rate
          </span>
        </div>
        {/* `relative` keeps the absolutely positioned sr-only labels inside the scroll clip. */}
        <div className="relative overflow-x-auto">
          <table className="border-separate border-spacing-[2px] text-xs tabular-nums" aria-label={caption}>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="px-1.5 py-1 text-left font-medium">
                  Cohort
                </th>
                <th scope="col" className="px-1.5 py-1 text-right font-medium">
                  Size
                </th>
                {grid.periods.map((p) => (
                  <th key={p} scope="col" className="min-w-11 px-1 py-1 text-center font-medium">
                    <span className="sr-only">{unit} </span>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.cohorts.map((c) => {
                const small = c.size < minGroup;
                return (
                  <tr key={c.cohort} data-small={small || undefined}>
                    <th scope="row" className="whitespace-nowrap px-1.5 py-1 text-left font-normal text-muted-foreground">
                      {formatBucket(c.cohort, grain)}
                    </th>
                    <td className="whitespace-nowrap px-1.5 py-1 text-right">
                      <span className="inline-flex items-center gap-1">
                        {small && <Badge title={`Fewer than ${minGroup} users; rates are muted.`}>small</Badge>}
                        {count.format(c.size)}
                      </span>
                    </td>
                    {grid.periods.map((p) => {
                      const cell = c.cells.get(p);
                      if (!cell || cell.rate === null) return <td key={p} />;
                      const bin = rateBin(cell.rate, grid.max) + 1;
                      const clickable = Boolean(onCellClick) && !small;
                      return (
                        <td
                          key={p}
                          data-bin={bin}
                          className={cn(
                            "h-7 rounded-sm px-1 text-center",
                            small && "opacity-35",
                            clickable && "cursor-pointer hover:outline-2 hover:outline-foreground/40",
                          )}
                          style={{ background: `var(--seq-${bin})`, color: `var(--seq-ink-${bin})` }}
                          tabIndex={clickable ? 0 : undefined}
                          onClick={clickable ? () => onCellClick!(c.cohort, p) : undefined}
                          onKeyDown={
                            clickable
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onCellClick!(c.cohort, p);
                                  }
                                }
                              : undefined
                          }
                          {...tip.bind(cellTip(c, p, cell.rate, cell.active))}
                        >
                          {formatCellRate(cell.rate)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {tip.node}
      </div>
    </ChartFrame>
  );
}
