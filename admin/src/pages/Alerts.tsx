import { BellOff, CheckCircle2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { RuleForm } from "@/components/alerts/RuleForm";
import { errorCopy } from "@/components/ChartCard";
import { ErrorPanel, Pill } from "@/components/people/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, useCatalog, type CatalogEntry } from "@/lib/api";
import {
  findMeta,
  formatCondition,
  readEvent,
  targetLabel,
  useAckEvent,
  useAlertEvents,
  useAlertRules,
  useDeleteRule,
  useSaveRule,
  useToggleRule,
  windowLabel,
  type AlertEvent,
  type AlertRule,
  type EventStatus,
} from "@/lib/alerts";
import { DIMENSION_LABELS, formatDate, formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

const ListSkeleton = ({ label }: { label: string }) => (
  <div role="status" className="flex flex-col gap-2">
    <Skeleton className="h-16 w-full" />
    <Skeleton className="h-16 w-full" />
    <span className="sr-only">Loading {label}…</span>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
);

const windowDates = (from: string | null, to: string | null) =>
  from && to ? (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`) : null;

const actionError = (error: unknown) => (error instanceof ApiError ? error.message : errorCopy(error).title);

// --- Events ------------------------------------------------------------------------------------------------

function EventItem({ event, rule, catalog }: { event: AlertEvent; rule: AlertRule | undefined; catalog: CatalogEntry[] | undefined }) {
  const ack = useAckEvent();
  const metric = event.metric ?? rule?.metric;
  const meta = findMeta(catalog, metric);
  const reading = readEvent(event, rule, meta);
  const measure = event.measure ?? rule?.measure;
  const dates = windowDates(event.window_from, event.window_to);
  const name = event.rule_name ?? rule?.name ?? "Deleted rule";
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{name}</span>
          {event.acknowledged_at ? <Pill tone="muted">Acknowledged</Pill> : <Pill tone="bad">Open</Pill>}
        </div>
        <p className="text-xs text-muted-foreground">
          Fired <time dateTime={event.fired_at}>{formatTimestamp(event.fired_at)}</time>
          {metric && measure && <> · {targetLabel(metric, measure, meta)}</>}
          {dates && <> · window {dates}</>}
        </p>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{reading.value}</span>
          {reading.baseline && <span className="text-muted-foreground"> vs {reading.baseline}</span>}
          {reading.condition && <span className="text-muted-foreground"> · rule: {reading.condition}</span>}
        </p>
        {event.message && <p className="text-xs text-muted-foreground">{event.message}</p>}
        {ack.isError && (
          <p role="alert" className="text-xs text-delta-bad">
            Could not acknowledge: {actionError(ack.error)}
          </p>
        )}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
        {event.acknowledged_at ? (
          <span>
            Acknowledged by {event.acknowledged_by ?? "an admin"}
            <br className="hidden sm:inline" /> {formatTimestamp(event.acknowledged_at)}
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => ack.mutate(event.id)} disabled={ack.isPending}>
            <CheckCircle2 /> Acknowledge
          </Button>
        )}
      </div>
    </li>
  );
}

const TABS: Array<{ id: EventStatus; label: string }> = [
  { id: "open", label: "Open" },
  { id: "all", label: "All" },
];

function EventsSection({ rules, catalog }: { rules: AlertRule[] | undefined; catalog: CatalogEntry[] | undefined }) {
  const [tab, setTab] = useState<EventStatus>("open");
  const events = useAlertEvents(tab);
  const id = useId();
  const byId = new Map((rules ?? []).map((r) => [r.id, r]));
  const tabs = (
    <div role="tablist" aria-label="Alert events" className="flex gap-1 rounded-lg border bg-card p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`${id}-${t.id}`}
          role="tab"
          type="button"
          aria-selected={tab === t.id}
          aria-controls={`${id}-panel`}
          onClick={() => setTab(t.id)}
          className={cn(
            "rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground",
            tab === t.id && "bg-accent font-medium text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
  return (
    <Section title="Fired alerts" actions={tabs}>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        {events.isPending ? (
          <ListSkeleton label="alerts" />
        ) : events.isError ? (
          <ErrorPanel error={events.error} what="Alerts" onRetry={() => void events.refetch()} />
        ) : events.data.length === 0 ? (
          <Empty>{tab === "open" ? "No open alerts." : "No alert has fired yet."}</Empty>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {events.data.map((event) => (
              <EventItem key={event.id} event={event} rule={byId.get(event.rule_id)} catalog={catalog} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// --- Rules -------------------------------------------------------------------------------------------------

function Switch({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-input bg-accent",
      )}
    >
      <span className={cn("size-3.5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
    </button>
  );
}

const filterSummary = (rule: AlertRule) =>
  Object.entries(rule.params.filters ?? {})
    .map(([d, v]) => `${DIMENSION_LABELS[d] ?? d}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");

function RuleItem({ rule, catalog, onEdit }: { rule: AlertRule; catalog: CatalogEntry[] | undefined; onEdit: () => void }) {
  const toggle = useToggleRule();
  const remove = useDeleteRule();
  const [confirming, setConfirming] = useState(false);
  const meta = findMeta(catalog, rule.metric);
  const filters = filterSummary(rule);
  const details = [
    windowLabel(rule.window),
    formatCondition(rule, meta),
    `cooldown ${rule.cooldown_hours} h`,
    ...(rule.params.currency ? [rule.params.currency.toUpperCase()] : []),
    ...(rule.params.include_internal ? ["incl. internal"] : []),
  ];
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{rule.name}</span>
          {!rule.enabled && <Pill tone="muted">Disabled</Pill>}
        </div>
        <p className="text-xs text-muted-foreground">{targetLabel(rule.metric, rule.measure, meta)}</p>
        <p className="text-sm">{details.join(" · ")}</p>
        {filters && <p className="text-xs text-muted-foreground">{filters}</p>}
        {(toggle.isError || remove.isError) && (
          <p role="alert" className="text-xs text-delta-bad">
            {toggle.isError ? `Could not ${toggle.variables?.enabled ? "enable" : "disable"} the rule: ${actionError(toggle.error)}` : `Could not delete: ${actionError(remove.error)}`}
          </p>
        )}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={`Delete ${rule.name}`}>
          <span>Delete this rule and its alert history?</span>
          <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(rule.id, { onSuccess: () => setConfirming(false) })}>
            {remove.isPending && <Loader2 className="animate-spin" />} Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={remove.isPending}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Switch checked={rule.enabled} label={`Enable ${rule.name}`} onChange={(enabled) => toggle.mutate({ id: rule.id, enabled })} />
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
            <Pencil /> <span className="hidden sm:inline">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete ${rule.name}`}>
            <Trash2 /> <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      )}
    </li>
  );
}

type Editor = { mode: "create" } | { mode: "edit"; rule: AlertRule } | null;

function RulesSection({ rules, catalog }: { rules: ReturnType<typeof useAlertRules>; catalog: CatalogEntry[] | undefined }) {
  const [editor, setEditor] = useState<Editor>(null);
  const save = useSaveRule();
  const open = (next: Editor) => {
    save.reset();
    setEditor(next);
  };
  return (
    <Section
      title="Rules"
      actions={
        !editor && (
          <Button size="sm" onClick={() => open({ mode: "create" })}>
            <Plus /> New rule
          </Button>
        )
      }
    >
      {editor && (
        <RuleForm
          key={editor.mode === "edit" ? editor.rule.id : "new"}
          catalog={catalog}
          rule={editor.mode === "edit" ? editor.rule : undefined}
          saving={save.isPending}
          error={save.error}
          onCancel={() => open(null)}
          onSubmit={(input) =>
            save.mutate({ id: editor.mode === "edit" ? editor.rule.id : undefined, input }, { onSuccess: () => setEditor(null) })
          }
        />
      )}
      {rules.isPending ? (
        <ListSkeleton label="rules" />
      ) : rules.isError ? (
        <ErrorPanel error={rules.error} what="Alert rules" onRetry={() => void rules.refetch()} />
      ) : rules.data.length === 0 ? (
        <Empty>
          <BellOff className="mx-auto mb-2 size-5 text-subtle" aria-hidden="true" />
          No rules yet. Create one to be alerted when a KPI crosses a threshold.
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rules.data.map((rule) => (
            <RuleItem key={rule.id} rule={rule} catalog={catalog} onEdit={() => open({ mode: "edit", rule })} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Fired alerts (open / all, acknowledge) and the rules that fire them (create, edit, enable, delete). */
export function AlertsPage() {
  const catalog = useCatalog();
  const rules = useAlertRules();
  return (
    <div className="flex flex-col gap-6">
      <EventsSection rules={rules.data} catalog={catalog.data?.metrics} />
      <RulesSection rules={rules} catalog={catalog.data?.metrics} />
    </div>
  );
}
