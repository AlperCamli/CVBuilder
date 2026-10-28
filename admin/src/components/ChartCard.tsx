import { AlertTriangle, Download, Info, Loader2, RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiError, measureOf, type MetricMeta } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  meta?: MetricMeta;
  generatedAt?: string;
  loading?: boolean;
  refreshing?: boolean;
  error?: unknown;
  /** A refetch failed while older data is still on screen. */
  staleError?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  onExport?: () => Promise<void>;
  actions?: ReactNode;
  /** Small markers next to the title, e.g. "FX provisional". */
  badges?: ReactNode;
  /** Scope caveat under the title, e.g. "Not filtered by plan". */
  caveat?: ReactNode;
  className?: string;
  /** 3 when the card sits under a page section heading. */
  headingLevel?: 2 | 3;
  children: ReactNode;
}

export function errorCopy(error: unknown) {
  if (!(error instanceof ApiError)) return { title: "Something went wrong", body: "The chart could not be loaded." };
  switch (error.status) {
    case 403:
      return { title: "No access", body: "Your account is not allowed to view this metric." };
    case 503:
      return { title: "Analytics unavailable", body: "The analytics database is not reachable right now. Try again shortly." };
    case 504:
      return { title: "Query timed out", body: "Try a shorter date range or a coarser grain." };
    default:
      return { title: "Could not load data", body: `${error.message} (${error.code})` };
  }
}

/** Definition, measure descriptions, consent note and KB path. `measures` limits which columns are described. */
export function InfoTip({ title, meta, measures }: { title: string; meta: MetricMeta; measures?: string[] }) {
  const described = (measures ?? Object.keys(meta.measures ?? {}))
    .map((key) => measureOf(meta, key))
    .filter((m) => m.description);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded text-subtle hover:text-foreground" aria-label={`About ${title}`}>
          <Info className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto max-w-xs space-y-1.5 p-3 text-xs">
        <p>{meta.definition || "No definition provided."}</p>
        {described.length > 0 && (
          <dl className="space-y-1">
            {described.map((m) => (
              <div key={m.label}>
                <dt className="inline font-medium">{m.label}: </dt>
                <dd className="inline text-muted-foreground">{m.description}</dd>
              </div>
            ))}
          </dl>
        )}
        {meta.consent_scoped && <p className="text-muted-foreground">Of consenting users only.</p>}
        {meta.kb && <p className="break-words font-mono text-[11px] text-muted-foreground">KB: {meta.kb}</p>}
      </PopoverContent>
    </Popover>
  );
}

export function ChartCard(props: ChartCardProps) {
  const { title, meta, generatedAt, loading, refreshing, error, staleError, empty, onRetry, onExport, actions, className, children } =
    props;
  const { badges, caveat, headingLevel = 2 } = props;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const runExport = async () => {
    if (!onExport) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport();
    } catch (err) {
      setExportError(errorCopy(err).title);
    } finally {
      setExporting(false);
    }
  };

  const body = (() => {
    if (loading) {
      return (
        <div role="status">
          <Skeleton className="h-64 w-full" />
          <span className="sr-only">Loading {title}…</span>
        </div>
      );
    }
    if (error) {
      const copy = errorCopy(error);
      return (
        <div role="alert" className="flex h-64 flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle className="size-5 text-delta-bad" aria-hidden="true" />
          <p className="text-sm font-medium">{copy.title}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{copy.body}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw /> Retry
            </Button>
          )}
        </div>
      );
    }
    if (empty) {
      return (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          No data for the selected filters.
        </div>
      );
    }
    return <div className={cn("transition-opacity", refreshing && "opacity-50")}>{children}</div>;
  })();

  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Heading className="truncate text-sm font-semibold">{title}</Heading>
          {meta && <InfoTip title={title} meta={meta} />}
          {badges}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onExport && (
            <Button variant="ghost" size="sm" onClick={runExport} disabled={exporting || loading} aria-label="Export CSV">
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} CSV
            </Button>
          )}
        </div>
      </header>
      {caveat && <p className="-mt-2 text-xs text-subtle">{caveat}</p>}
      {body}
      <footer className="mt-auto flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        {staleError && generatedAt ? (
          <span role="status" className="text-delta-bad">
            Refresh failed ({errorCopy(staleError).title.toLowerCase()}) — showing data as of {formatTimestamp(generatedAt)}
          </span>
        ) : (
          <span>{generatedAt ? `Data as of ${formatTimestamp(generatedAt)}` : " "}</span>
        )}
        {exportError && <span className="text-delta-bad">Export failed: {exportError}</span>}
      </footer>
    </section>
  );
}
