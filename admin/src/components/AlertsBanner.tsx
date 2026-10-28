import { BellRing } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useAlertSummary } from "@/lib/alerts";
import { formatTimestamp } from "@/lib/format";

/** "N open alerts — latest at …" on Overview while any fired alert is unacknowledged. */
export function AlertsBanner() {
  const { search } = useLocation();
  const { data } = useAlertSummary();
  if (!data || data.open_count <= 0) return null;
  const n = data.open_count;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-sm">
      <BellRing className="size-4 shrink-0 text-status-critical" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {n} open alert{n === 1 ? "" : "s"}
        </span>
        {data.latest_fired_at && <span className="text-muted-foreground"> — latest at {formatTimestamp(data.latest_fired_at)}</span>}
      </span>
      <Link to={{ pathname: "/alerts", search }} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Review alerts
      </Link>
    </div>
  );
}
