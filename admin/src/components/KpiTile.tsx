import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface KpiTileProps {
  label: string;
  value?: string;
  current?: number;
  previous?: number;
  comparisonLabel?: string;
  upIsGood?: boolean;
  loading?: boolean;
  /** The comparison is still loading or showing another range's data. */
  deltaLoading?: boolean;
  sparkline?: ReactNode;
}

const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });

export function Delta({ current, previous, upIsGood = true, label }: { current: number; previous: number; upIsGood?: boolean; label?: string }) {
  if (previous === 0) {
    return <span className="text-xs text-muted-foreground">{current === 0 ? "No change" : "New"} {label}</span>;
  }
  const change = (current - previous) / previous;
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
        {pct.format(change)}
      </span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
}

export function KpiTile(props: KpiTileProps) {
  const { label, value, current, previous, comparisonLabel, upIsGood, loading, deltaLoading, sparkline } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-3">
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-3xl font-semibold leading-none">{value ?? "–"}</div>
        )}
        {!loading && sparkline}
      </div>
      <div className="min-h-4">
        {loading || deltaLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          current !== undefined &&
          previous !== undefined && <Delta current={current} previous={previous} upIsGood={upIsGood} label={comparisonLabel} />
        )}
      </div>
    </div>
  );
}
