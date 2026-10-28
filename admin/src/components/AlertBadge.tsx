import { Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { useAlertSummary } from "@/lib/alerts";
import { cn } from "@/lib/utils";

const count = (n: number) => (n > 99 ? "99+" : String(n));

/** Header bell with the open (unacknowledged) alert count; links to /alerts. */
export function AlertBadge() {
  const { search } = useLocation();
  const summary = useAlertSummary();
  const open = summary.data?.open_count ?? 0;
  const label = summary.data ? `Alerts: ${open} open` : "Alerts";
  return (
    <Link
      to={{ pathname: "/alerts", search }}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "relative")}
    >
      <Bell />
      {open > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-status-critical px-1 text-center text-[10px] font-semibold leading-4 text-white"
        >
          {count(open)}
        </span>
      )}
    </Link>
  );
}
