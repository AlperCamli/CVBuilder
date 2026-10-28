import { Download, Loader2, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { ErrorPanel, KeyValues, LoadMore, peopleErrorCopy, StatePanel } from "@/components/people/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DrillFilters } from "@/lib/drill";
import { DIMENSION_LABELS, formatBucketLong } from "@/lib/format";
import { downloadPeopleCsv, usePeopleInfinite } from "@/lib/people";

export interface DrillDrawerProps {
  metric: string;
  title: string;
  filters: DrillFilters;
  from: string;
  to: string;
  onClose: () => void;
  formatValue?: (value: number) => string;
}

const plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const rangeLabel = (from: string, to: string) =>
  from === to ? formatBucketLong(from, "day") : `${formatBucketLong(from, "day")} – ${formatBucketLong(to, "day")}`;

/** The users behind one metric point (`drill_users`), each linking to their profile. Every page load is audited. */
export function DrillDrawer({ metric, title, filters, from, to, onClose, formatValue = (v) => plain.format(v) }: DrillDrawerProps) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { search } = useLocation();
  const params = { from, to, filters: { ...filters, metric } };
  const users = usePeopleInfinite("drill_users", params);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadPeopleCsv("drill_users", params, `${metric}_users_${from}_${to}.csv`);
    } catch (error) {
      setExportError(peopleErrorCopy(error).title);
    } finally {
      setExporting(false);
    }
  };

  const scope = Object.entries(filters)
    .map(([key, value]) => `${DIMENSION_LABELS[key] ?? key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");

  const body = (() => {
    if (users.isPending) {
      return (
        <div role="status" className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
          <span className="sr-only">Loading users…</span>
        </div>
      );
    }
    if (users.isError && users.rows.length === 0) {
      return <ErrorPanel what="The users" error={users.error} onRetry={() => void users.refetch()} />;
    }
    if (users.rows.length === 0) {
      return (
        <StatePanel icon={<Users className="size-6 text-subtle" aria-hidden="true" />} title="No users to show">
          No individual users are behind this point, or they are restricted or pending deletion.
        </StatePanel>
      );
    }
    return (
      <>
        <ul className="flex flex-col divide-y">
          {users.rows.map((row, i) => {
            const id = String(row.user_id ?? "");
            const value = typeof row.value === "number" ? row.value : Number(row.value);
            return (
              <li key={id || i} className="flex flex-col gap-1 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    to={{ pathname: `/users/${encodeURIComponent(id)}`, search }}
                    className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
                    title={String(row.email ?? "")}
                  >
                    {typeof row.email === "string" && row.email ? row.email : id}
                  </Link>
                  {row.value !== null && row.value !== undefined && Number.isFinite(value) && (
                    <span className="shrink-0 text-sm tabular-nums">{formatValue(value)}</span>
                  )}
                </div>
                {row.detail !== null && row.detail !== undefined && <KeyValues data={row.detail} className="text-muted-foreground" />}
              </li>
            );
          })}
        </ul>
        <LoadMore
          hasMore={Boolean(users.hasNextPage)}
          loading={users.isFetchingNextPage}
          onLoad={() => void users.fetchNextPage()}
          shown={users.rows.length}
          noun="users"
          error={users.isFetchNextPageError ? users.error : undefined}
        />
      </>
    );
  })();

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" onClick={onClose} data-testid="drawer-overlay" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="relative flex h-full w-full max-w-md flex-col border-l bg-card shadow-xl"
      >
        <header className="flex items-start gap-2 border-b p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 id={headingId} className="text-sm font-semibold">
              Users behind {title}
            </h2>
            <p className="text-xs text-muted-foreground">
              {rangeLabel(from, to)}
              {scope && ` · ${scope}`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={runExport} disabled={exporting || users.isPending} aria-label="Export users CSV" title="The export is logged.">
            {exporting ? <Loader2 className="animate-spin" /> : <Download />} CSV
          </Button>
          <button
            ref={closeButton}
            type="button"
            className={buttonVariants({ variant: "ghost", size: "icon", className: "size-8" })}
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
        <footer className="flex flex-wrap items-center gap-1.5 border-t px-4 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Every lookup is logged.
          {exportError && <span className="text-delta-bad">Export failed: {exportError}</span>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
