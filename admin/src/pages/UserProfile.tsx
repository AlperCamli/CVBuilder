import { ArrowLeft, ShieldAlert, UserX } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Timeline } from "@/components/people/Timeline";
import { UsageMeters } from "@/components/people/UsageMeters";
import { ConsentPill, ErrorPanel, InternalPill, Pill, StatePanel } from "@/components/people/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatTimestamp, formatValue, humanize } from "@/lib/format";
import { isUuid, usePeople, type PeopleRow } from "@/lib/people";

const text = (v: unknown) => (typeof v === "string" && v ? v : "—");
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const count = (v: unknown) => {
  const n = num(v);
  return n === undefined ? "—" : n.toLocaleString("en-US");
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

function SummaryCard({ row }: { row: PeopleRow }) {
  const usd = num(row.paid_usd_native);
  const tryAmount = num(row.paid_try_native);
  const denials = num(row.entitlement_denials) ?? 0;
  const cancelAtEnd = row.cancel_at_period_end === true;
  return (
    <section aria-labelledby="summary-heading" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
      <header className="flex flex-col gap-1.5">
        <h2 id="summary-heading" className="break-all text-base font-semibold">
          {text(row.email)}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <ConsentPill label="Analytics" value={row.analytics_consent} />
          <ConsentPill label="AI" value={row.ai_consent} />
          {row.is_internal === true && <InternalPill />}
        </div>
        <p className="break-all font-mono text-[11px] text-subtle">{String(row.user_id ?? "")}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="Plan">{row.plan_code ? humanize(String(row.plan_code)) : "—"}</Field>
        <Field label="Status">
          <span className="flex flex-wrap items-center gap-1.5">
            {row.subscription_status ? humanize(String(row.subscription_status)) : "—"}
            {cancelAtEnd && <Pill tone="bad">Cancels at period end</Pill>}
          </span>
        </Field>
        <Field label="Market">{text(row.market)}</Field>
        <Field label="Locale">{text(row.locale)}</Field>
        <Field label="Signed up">{formatDate(row.created_at)}</Field>
        {row.trial_ends_at ? <Field label="Trial ends">{formatDate(row.trial_ends_at)}</Field> : null}
        <Field label="Current period ends">{formatDate(row.current_period_end)}</Field>
        <Field label="Last activity">{typeof row.last_activity_at === "string" ? formatTimestamp(row.last_activity_at) : "—"}</Field>
        <Field label="Invoices">{count(row.invoices)}</Field>
        <Field label="Paid (native)">
          {usd === undefined && tryAmount === undefined ? (
            "—"
          ) : (
            <span className="tabular-nums">
              {formatValue(usd ?? 0, "currency", "usd")} · {formatValue(tryAmount ?? 0, "currency", "try")}
            </span>
          )}
        </Field>
        <Field label="Plan-limit denials">
          <span className={denials > 0 ? "font-medium text-delta-bad" : undefined}>{count(row.entitlement_denials)}</span>
        </Field>
      </dl>

      <div className="flex flex-col gap-2 border-t pt-3">
        <h3 className="text-xs font-medium text-muted-foreground">Usage vs plan limits</h3>
        <UsageMeters usage={row.usage} />
      </div>
    </section>
  );
}

function BackLink() {
  const { state, search } = useLocation();
  const navigate = useNavigate();
  const fromSearch = (state as { fromSearch?: boolean } | null)?.fromSearch === true;
  const className = "flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground";
  // From the results list, history.back() restores the search from that entry's history.state.
  return fromSearch ? (
    <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => navigate(-1)}>
      <ArrowLeft /> Back to results
    </Button>
  ) : (
    <Link to={{ pathname: "/users", search }} className={className}>
      <ArrowLeft className="size-4" /> User search
    </Link>
  );
}

export function UserProfilePage() {
  const { id = "" } = useParams();
  const valid = isUuid(id);
  const summary = usePeople("user_summary", { user_id: id }, { enabled: valid });
  const row = summary.data?.rows[0];

  const body = (() => {
    if (!valid) {
      return (
        <StatePanel icon={<UserX className="size-6 text-subtle" aria-hidden="true" />} title="Not a valid user ID">
          User IDs are UUIDs. Search by email instead.
        </StatePanel>
      );
    }
    if (summary.isPending) {
      return (
        <div role="status" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-24 w-full" />
          <span className="sr-only">Loading user…</span>
        </div>
      );
    }
    if (summary.isError) return <ErrorPanel what="This user" error={summary.error} onRetry={() => void summary.refetch()} />;
    if (!row) {
      return (
        <StatePanel icon={<UserX className="size-6 text-subtle" aria-hidden="true" />} title="User not found or pending deletion">
          Unknown, erased and pending-deletion accounts are never shown.
        </StatePanel>
      );
    }
    if (row.restricted === true) {
      return (
        <StatePanel icon={<ShieldAlert className="size-6 text-warning" aria-hidden="true" />} title="Processing restricted">
          This user has restricted the processing of their data. No account details or activity are shown.
        </StatePanel>
      );
    }
    return (
      <>
        <SummaryCard row={row} />
        <Timeline key={id} userId={id} />
      </>
    );
  })();

  return (
    <>
      <BackLink />
      {body}
      {summary.data && <p className="text-xs text-subtle">Data as of {formatTimestamp(summary.data.generated_at)}</p>}
    </>
  );
}
