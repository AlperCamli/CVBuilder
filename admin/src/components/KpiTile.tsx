import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** "relative" shows % change; "points" shows the difference of two 0–1 rates in percentage points. */
export type DeltaFormat = "relative" | "points";

export interface KpiPart {
  label: string;
  value?: string;
  current?: number;
  previous?: number;
}

interface KpiTileProps {
  label: string;
  value?: string;
  current?: number;
  previous?: number;
  comparisonLabel?: string;
  upIsGood?: boolean;
  deltaFormat?: DeltaFormat;
  /** Side-by-side values that can't be added up (e.g. one per native currency), each with its own delta. */
  parts?: KpiPart[];
  loading?: boolean;
  /** The comparison is still loading or showing another range's data. */
  deltaLoading?: boolean;
  sparkline?: ReactNode;
  /** Secondary line under the value, e.g. a rate or a data-quality note. */
  note?: ReactNode;
  /** Scope caveat, e.g. "Not filtered by plan" when an active page filter doesn't apply to this number. */
  caveat?: ReactNode;
  /** Small markers next to the label, e.g. "small sample". */
  badges?: ReactNode;
  info?: ReactNode;
}

const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const points = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

interface DeltaProps {
  current: number;
  previous: number;
  upIsGood?: boolean;
  label?: string;
  format?: DeltaFormat;
}

export function Delta({ current, previous, upIsGood = true, label, format = "relative" }: DeltaProps) {
  if (format === "relative" && previous === 0) {
    return <span className="text-xs text-muted-foreground">{current === 0 ? "No change" : "New"} {label}</span>;
  }
  const change = format === "points" ? current - previous : (current - previous) / previous;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const good = direction === "flat" ? undefined : (direction === "up") === upIsGood;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          good === true && "text-delta-good",
          good === false && "text-delta-bad",
          good === undefined && "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {format === "points" ? `${points.format(change * 100)} pp` : pct.format(change)}
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
}

export function KpiTile(props: KpiTileProps) {
  const { label, value, current, previous, comparisonLabel, upIsGood, deltaFormat, parts, loading, deltaLoading } = props;
  const { sparkline, note, caveat, badges, info } = props;
  const delta = (c?: number, p?: number, deltaLabel?: string) =>
    c !== undefined &&
    p !== undefined && <Delta current={c} previous={p} upIsGood={upIsGood} label={deltaLabel} format={deltaFormat} />;

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <span>{label}</span>
        {info}
        {badges}
      </div>
      {parts ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {parts.map((part) => (
            <div key={part.label} className="flex min-w-0 flex-col gap-1">
              {loading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                <div className="text-2xl font-semibold leading-none">{part.value ?? "–"}</div>
              )}
              <div className="min-h-4 text-xs text-muted-foreground">
                {loading || deltaLoading ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {part.label} {delta(part.current, part.previous)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-3xl font-semibold leading-none">{value ?? "–"}</div>
            )}
            {!loading && sparkline}
          </div>
          <div className="min-h-4">
            {loading || deltaLoading ? <Skeleton className="h-4 w-32" /> : delta(current, previous, comparisonLabel)}
          </div>
        </>
      )}
      {parts && comparisonLabel && !loading && <div className="text-xs text-subtle">Change {comparisonLabel}</div>}
      {note && !loading && <div className="text-xs text-muted-foreground">{note}</div>}
      {caveat && <div className="text-xs text-subtle">{caveat}</div>}
    </div>
  );
}
