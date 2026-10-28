import { Cpu, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { errorCopy } from "@/components/ChartCard";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/format";
import { dataAsOf, isOpen, useRecomputeStatus, useRequestRecompute } from "@/lib/recompute";
import { cn } from "@/lib/utils";

/** Seconds left until `until` (ms epoch), re-rendering every second while positive. */
function useCountdown(until: number | null) {
  const [, setTick] = useState(0);
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));
  const ticking = left > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return left;
}

/**
 * Rebuilds the pre-computed metrics (cohorts, LTV, growth accounting): queues a run, shows "Queued…" while the status
 * polls every 5 s, then the outcome. The database throttles to one run per 5 minutes (429 → countdown).
 */
export function RecomputeControl({ className }: { className?: string }) {
  const status = useRecomputeStatus();
  const recompute = useRequestRecompute();
  /** The run this control queued (or "pending" without an id) and when, so an older status isn't read as its outcome. */
  const [queued, setQueued] = useState<{ id: string; at: number } | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const wait = useCountdown(retryAt);
  const run = status.data;
  const open = isOpen(run);

  const start = () => {
    setRetryAt(null);
    recompute.mutate(undefined, {
      onSuccess: (result) => {
        if (result.status === "queued" || result.run_id !== null) {
          // Queued, or another request is already open: either way, follow that run.
          setQueued({ id: result.run_id ?? "pending", at: Date.now() });
        } else {
          setRetryAt(Date.now() + result.retry_after_seconds * 1000);
        }
      },
    });
  };

  // Settled once a status fetched after the request shows no open run. The latest run is normally ours; if a later
  // one (e.g. the nightly job) already replaced it, ours finished before it.
  const ours = Boolean(queued && run && !open && status.dataUpdatedAt > queued.at);
  let message: string | null = null;
  let tone: "muted" | "bad" = "muted";
  if (recompute.isPending) message = "Requesting…";
  else if (open) message = run?.status === "running" ? "Recomputing…" : "Queued…";
  else if (queued !== null && !ours) message = "Queued…";
  else if (wait > 0) message = `Recently recomputed — try again in ${wait} s`;
  else if (recompute.isError) {
    message = `Recompute could not be requested: ${errorCopy(recompute.error).title.toLowerCase()}`;
    tone = "bad";
  } else if (ours && run?.status === "failed") {
    message = `Recompute failed${run.error ? `: ${run.error}` : ""}`;
    tone = "bad";
  } else if (ours && run?.status === "done") {
    const asOf = dataAsOf(run);
    message = `Recomputed${asOf ? ` — data as of ${formatTimestamp(asOf)}` : ""}`;
  }
  const busy = recompute.isPending || open || (queued !== null && !ours);

  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-3 gap-y-1", className)}>
      <span role="status" className={cn("text-xs", tone === "bad" ? "text-delta-bad" : "text-muted-foreground")}>
        {message}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={start}
        disabled={busy || wait > 0}
        title="Rebuilds the pre-computed metrics (cohorts, LTV, growth accounting). At most once every 5 minutes."
      >
        {busy ? <Loader2 className="animate-spin" /> : <Cpu />} Recompute
      </Button>
    </div>
  );
}
