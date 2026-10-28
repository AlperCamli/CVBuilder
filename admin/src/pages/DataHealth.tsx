import { CircleAlert, CircleCheck, CircleX, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { NotAvailableCard } from "@/components/charts/NotAvailableCard";
import { ChartCard } from "@/components/ChartCard";
import { ErrorPanel } from "@/components/people/shared";
import { RecomputeControl } from "@/components/RecomputeControl";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetric } from "@/lib/api";
import { shortUserId, useAuditRecent } from "@/lib/audit";
import { useFilters, type GlobalFilters } from "@/lib/filters";
import { formatDuration, formatTimestamp, humanize } from "@/lib/format";
import { freshnessNote, freshnessStatus, freshnessSummary, freshnessValue, type FreshnessStatus } from "@/lib/health";
import { dataAsOf, useRecomputeStatus, type RecomputeRun } from "@/lib/recompute";
import type { Row } from "@/lib/shapes";
import { cn } from "@/lib/utils";

const FRESHNESS = "data_freshness";

/** Status colour from the fixed status palette, always with an icon and a word. */
const STATUS: Record<FreshnessStatus, { label: string; icon: LucideIcon; className: string }> = {
  ok: { label: "OK", icon: CircleCheck, className: "text-status-good" },
  warn: { label: "Warning", icon: CircleAlert, className: "text-status-warning" },
  error: { label: "Error", icon: CircleX, className: "text-status-critical" },
  info: { label: "Info", icon: Info, className: "text-subtle" },
};

export function StatusLabel({ status }: { status: FreshnessStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

const th = "px-2 py-1.5 text-left font-medium";
const td = "px-2 py-1.5 align-top";

function FreshnessTable({ rows }: { rows: Row[] }) {
  const summary = freshnessSummary(rows);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{summary ? `${summary} need attention.` : "Every check is OK."}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs" aria-label="Data freshness checks">
          <thead className="bg-card text-muted-foreground">
            <tr>
              <th scope="col" className={th}>
                Status
              </th>
              <th scope="col" className={th}>
                Check
              </th>
              <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                Value
              </th>
              <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const status = freshnessStatus(row.status);
              const note = freshnessNote(row);
              const value = freshnessValue(row);
              const at = typeof row.at === "string" && row.at ? formatTimestamp(row.at) : null;
              return (
                <tr key={String(row.item ?? i)} className={cn("border-t", status === "error" && "bg-status-critical/5")}>
                  <td className={td}>
                    <StatusLabel status={status} />
                  </td>
                  <td className={cn(td, "min-w-40")}>
                    {String(row.label ?? humanize(String(row.item ?? "")))}
                    {/* Narrow screens: value and time under the label instead of in their own columns. */}
                    {(value || at) && (
                      <p className="mt-0.5 break-words tabular-nums text-muted-foreground sm:hidden">{[value, at].filter(Boolean).join(" · ")}</p>
                    )}
                    {note && <p className="mt-0.5 text-subtle">{note}</p>}
                  </td>
                  <td className={cn(td, "hidden tabular-nums sm:table-cell")}>{value || <span className="text-subtle">—</span>}</td>
                  <td className={cn(td, "hidden whitespace-nowrap text-muted-foreground sm:table-cell")}>{at ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Data health ignores the page filters: internal accounts are always excluded here. */
const healthFilters = (filters: GlobalFilters): GlobalFilters => ({ ...filters, include_internal: false, breakdown: undefined, filters: {} });

function FreshnessCard() {
  const [filters] = useFilters();
  const metric = useMetric(FRESHNESS, healthFilters(filters));
  if (metric.missing) return <NotAvailableCard name={FRESHNESS} title="Data freshness" />;
  const rows = metric.data?.rows;
  return (
    <ChartCard
      title={metric.meta?.title ?? "Data freshness"}
      meta={metric.meta}
      generatedAt={metric.data?.generated_at}
      loading={metric.isPending}
      refreshing={metric.isFetching}
      error={metric.isError && !metric.data ? metric.error : undefined}
      staleError={metric.isError && metric.data ? metric.error : undefined}
      empty={rows?.length === 0}
      onRetry={() => void metric.refetch()}
    >
      {rows && <FreshnessTable rows={rows} />}
    </ChartCard>
  );
}

const RUN_STATUS: Record<string, FreshnessStatus> = { done: "ok", failed: "error", pending: "info", running: "info" };

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

const runLine = (run: RecomputeRun) =>
  [
    run.kind ? humanize(run.kind) : "Run",
    run.status ?? "unknown",
    run.finished_at ?? run.requested_at ? formatTimestamp((run.finished_at ?? run.requested_at)!) : null,
    run.duration_seconds !== null ? formatDuration(run.duration_seconds * 1000) : null,
  ]
    .filter(Boolean)
    .join(" · ");

function RecomputeCard() {
  const status = useRecomputeStatus();
  const run = status.data;
  const asOf = dataAsOf(run);
  return (
    <section aria-labelledby="recompute-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recompute-heading" className="text-sm font-semibold">
          Pre-computed metrics
        </h2>
        <RecomputeControl />
      </header>
      <p className="-mt-1 text-xs text-muted-foreground">
        Cohorts, LTV and growth accounting are rebuilt nightly at 03:45 UTC, or on request (at most once every 5 minutes).
      </p>
      {status.isPending ? (
        <div role="status">
          <Skeleton className="h-16 w-full" />
          <span className="sr-only">Loading recompute status…</span>
        </div>
      ) : status.isError ? (
        <ErrorPanel error={status.error} what="Recompute status" onRetry={() => void status.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Fact label="Data as of">{asOf ? formatTimestamp(asOf) : "Never built"}</Fact>
            <Fact label="Latest run">
              {run?.status ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusLabel status={RUN_STATUS[run.status] ?? "info"} />
                  <span className="text-muted-foreground">
                    {humanize(run.status)}
                    {run.kind ? ` (${run.kind})` : ""}
                  </span>
                </span>
              ) : (
                "None yet"
              )}
            </Fact>
            <Fact label="Requested">
              {run?.requested_at ? formatTimestamp(run.requested_at) : "—"}
              {run?.requested_by && <span className="block truncate text-xs text-muted-foreground">by {run.requested_by}</span>}
            </Fact>
            <Fact label="Finished">
              {run?.finished_at ? formatTimestamp(run.finished_at) : "—"}
              {run?.duration_seconds !== null && run?.duration_seconds !== undefined && (
                <span className="block text-xs text-muted-foreground">took {formatDuration(run.duration_seconds * 1000)}</span>
              )}
            </Fact>
          </dl>
          {run?.status === "failed" && run.error && (
            <p role="alert" className="text-sm text-delta-bad">
              Last run failed: {run.error}
            </p>
          )}
          {run && run.history.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">Earlier runs</h3>
              <ul className="flex flex-col gap-0.5 text-xs">
                {run.history.map((r, i) => (
                  <li key={r.run_id ?? i}>{runLine(r)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AuditCard() {
  const audit = useAuditRecent();
  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id="audit-heading" className="text-sm font-semibold">
        Recent admin activity
      </h2>
      <p className="-mt-2 text-xs text-muted-foreground">
        The latest 50 audit log entries. Viewing this list is logged too. Parameters are never shown.
      </p>
      {audit.isPending ? (
        <div role="status">
          <Skeleton className="h-40 w-full" />
          <span className="sr-only">Loading admin activity…</span>
        </div>
      ) : audit.isError ? (
        <ErrorPanel error={audit.error} what="Admin activity" onRetry={() => void audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-md border">
          <table className="w-full text-xs" aria-label="Recent admin activity">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th scope="col" className={th}>
                  At
                </th>
                <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                  Admin
                </th>
                <th scope="col" className={th}>
                  Action
                </th>
                <th scope="col" className={cn(th, "hidden sm:table-cell")}>
                  Target user
                </th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((entry, i) => (
                <tr key={entry.id ?? i} className="border-t">
                  <td className={cn(td, "tabular-nums")}>
                    <span className="whitespace-nowrap">{formatTimestamp(entry.at)}</span>
                    <span className="block break-all text-muted-foreground sm:hidden">{entry.admin_email ?? "—"}</span>
                  </td>
                  <td className={cn(td, "hidden max-w-56 truncate sm:table-cell")} title={entry.admin_email ?? undefined}>
                    {entry.admin_email ?? "—"}
                  </td>
                  <td className={td}>
                    <span className="font-mono">{entry.action}</span>
                    {entry.function && <span className="text-muted-foreground"> · {entry.function}</span>}
                    {entry.target_user_id && (
                      <span className="block font-mono text-muted-foreground sm:hidden">user {shortUserId(entry.target_user_id)}</span>
                    )}
                  </td>
                  <td className={cn(td, "hidden font-mono text-muted-foreground sm:table-cell")}>
                    {entry.target_user_id ? shortUserId(entry.target_user_id) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Freshness checks, the pre-computed metrics' build and recompute, and recent admin activity. */
export function DataHealthPage() {
  return (
    <div className="flex flex-col gap-4">
      <RecomputeCard />
      <FreshnessCard />
      <AuditCard />
    </div>
  );
}
