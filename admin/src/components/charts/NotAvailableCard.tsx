import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Stands in for a metric the catalog doesn't list yet, so a page can ship before all of its SQL exists. */
export function NotAvailableCard({ name, title, className }: { name: string; title: string; className?: string }) {
  return (
    <section
      aria-label={title}
      data-metric={name}
      className={cn("flex min-w-0 flex-col justify-center gap-1 self-start rounded-xl border border-dashed bg-card px-4 py-3", className)}
    >
      <h3 className="truncate text-sm font-semibold text-muted-foreground">{title}</h3>
      <p className="flex items-center gap-1.5 text-xs text-subtle">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" />
        Not available yet
      </p>
    </section>
  );
}
