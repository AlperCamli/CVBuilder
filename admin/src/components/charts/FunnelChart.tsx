import { TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { SmallSampleBadge } from "@/components/Badge";
import type { MetricMeta } from "@/lib/api";
import type { Currency } from "@/lib/filters";
import { buildFunnels, type Funnel, type FunnelStep, type Row } from "@/lib/shapes";
import { cn } from "@/lib/utils";
import { ChartFrame, TipBody, useHoverTip } from "./ChartFrame";
import { DataTable } from "./DataTable";

export interface FunnelChartProps {
  rows: Row[];
  meta?: MetricMeta;
  currency: Currency;
  /** What `dimension` holds when the funnel is segmented, e.g. "Market". */
  dimensionLabel: string;
  minGroup: number;
  topN?: number;
  /** Set when a step opens the users behind it (`meta.drill`). */
  onStepClick?: (step: FunnelStep, funnel: Funnel) => void;
}

const count = new Intl.NumberFormat("en-US");
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const rate = (v: number | null) => (v === null ? "—" : pct.format(v));

/** Step bars (length = users, ghost = users lost since the previous step), conversion labels, worst drop flagged. */
export function FunnelChart({ rows, meta, currency, dimensionLabel, minGroup, topN = 6, onStepClick }: FunnelChartProps) {
  const funnels = useMemo(() => buildFunnels(rows, topN), [rows, topN]);
  const tip = useHoverTip();
  const multiple = funnels.length > 1;
  const caption = multiple
    ? `Users per step by ${dimensionLabel.toLowerCase()}; bars relative to each funnel's first step`
    : "Users per step; bars relative to the first step";

  const table = (
    <DataTable
      rows={rows}
      meta={meta}
      currency={currency}
      label="Funnel steps"
      labels={{ dimension: dimensionLabel, users: "Users", conversion_from_prev: "From previous", conversion_from_start: "From start" }}
    />
  );

  const stepTip = (f: Funnel, s: FunnelStep) => (
    <TipBody
      title={multiple ? `${f.label} · ${s.step}` : s.step}
      rows={[
        { label: "Users", value: count.format(s.users) },
        ...(s.previous !== null
          ? [
              { label: "Lost since previous", value: count.format(Math.max(0, s.previous - s.users)) },
              { label: "From previous", value: rate(s.fromPrev) },
            ]
          : []),
        { label: "From start", value: rate(s.fromStart) },
      ]}
    />
  );

  return (
    <ChartFrame caption={caption} table={table}>
      <div ref={tip.ref} className="@container relative">
        <div className={cn("grid gap-5", multiple && "@xl:grid-cols-2")}>
          {funnels.map((f) => (
            <figure key={f.key} className="flex min-w-0 flex-col gap-2">
              {multiple && (
                <figcaption className="flex items-center gap-1.5 text-xs font-medium">
                  {f.label}
                  {f.start < minGroup && <SmallSampleBadge minGroup={minGroup} />}
                </figcaption>
              )}
              <ol aria-label={multiple ? `${f.label} funnel` : "Funnel"} className="flex flex-col gap-2.5">
                {f.steps.map((s, i) => {
                  const width = f.start ? (s.users / f.start) * 100 : 0;
                  const ghost = f.start && s.previous !== null ? (Math.max(0, s.previous - s.users) / f.start) * 100 : 0;
                  const worst = i === f.worst;
                  const body = (
                    <>
                      <span className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{s.step}</span>
                        <span className="font-semibold tabular-nums">{count.format(s.users)}</span>
                      </span>
                      <span className="relative block h-4" aria-hidden="true">
                        <span
                          data-testid="funnel-bar"
                          className="absolute inset-y-0 left-0 rounded-r-[4px]"
                          style={{ width: `${width}%`, minWidth: s.users > 0 ? 2 : 0, background: "var(--series-1)" }}
                        />
                        {ghost > 0 && (
                          <span
                            className="absolute inset-y-0 rounded-r-[4px] opacity-20"
                            style={{ left: `calc(${width}% + 2px)`, width: `max(${ghost}% - 2px, 0px)`, background: "var(--series-1)" }}
                          />
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        {s.fromPrev !== null && <span>{rate(s.fromPrev)} of previous</span>}
                        <span>{rate(s.fromStart)} of start</span>
                        {worst && (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground">
                            <TriangleAlert className="size-3 text-delta-bad" aria-hidden="true" />
                            Largest drop-off
                          </span>
                        )}
                      </span>
                    </>
                  );
                  const cls = "flex w-full flex-col gap-1 rounded text-left";
                  return (
                    <li key={s.order} data-worst={worst || undefined}>
                      {onStepClick && f.key !== "other" ? (
                        <button
                          type="button"
                          className={cn(cls, "cursor-pointer hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring")}
                          aria-label={`Show users at ${s.step}${multiple ? ` (${f.label})` : ""}: ${count.format(s.users)}`}
                          onClick={() => onStepClick(s, f)}
                          {...tip.bind(stepTip(f, s))}
                        >
                          {body}
                        </button>
                      ) : (
                        <div className={cls} tabIndex={0} {...tip.bind(stepTip(f, s))}>
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </figure>
          ))}
        </div>
        {tip.node}
      </div>
    </ChartFrame>
  );
}
