import { ChevronDown, ChevronRight, Download, Filter, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { controlClass } from "@/components/ui/control";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { todayUtc } from "@/lib/filters";
import { formatBucketLong, formatDuration, formatTime, formatTimestamp, humanize } from "@/lib/format";
import { downloadPeopleCsv, usePeopleInfinite, type PeopleRow } from "@/lib/people";
import { cn } from "@/lib/utils";
import { eventMeta, KNOWN_EVENT_TYPES } from "./eventTypes";
import { ErrorPanel, KeyValues, LoadMore, peopleErrorCopy, Pill } from "./shared";

export const TIMELINE_PAGE_SIZE = 100;

export interface TimelineEvent {
  occurred_at: string;
  event_type: string;
  entity: string | null;
  entity_id: string | null;
  status: string | null;
  is_failure: boolean;
  duration_ms: number | null;
  detail: unknown;
  error_code: string | null;
  error_message: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

export function toEvent(row: PeopleRow): TimelineEvent {
  const duration = typeof row.duration_ms === "number" ? row.duration_ms : Number(row.duration_ms);
  return {
    occurred_at: String(row.occurred_at ?? ""),
    event_type: String(row.event_type ?? "unknown"),
    entity: str(row.entity),
    entity_id: str(row.entity_id),
    status: str(row.status),
    is_failure: row.is_failure === true,
    duration_ms: row.duration_ms === null || row.duration_ms === undefined || !Number.isFinite(duration) ? null : duration,
    detail: row.detail ?? null,
    error_code: str(row.error_code),
    error_message: str(row.error_message),
  };
}

/** UTC calendar day of a timestamp, so separators match the "All dates UTC" convention. */
const dayOf = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : date.toISOString().slice(0, 10);
};

const hasDetail = (detail: unknown) =>
  detail !== null && detail !== undefined && !(typeof detail === "object" && Object.keys(detail as object).length === 0);

function EventRow({ event }: { event: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const { label, icon: Icon } = eventMeta(event.event_type);
  const failed = event.is_failure;
  // The entity often just repeats the event type; only show it when it adds something.
  const entity = event.entity && event.entity !== event.event_type ? humanize(event.entity) : null;
  const detailId = `detail-${event.event_type}-${event.entity_id ?? ""}-${event.occurred_at}`;
  return (
    <li
      className={cn(
        "relative flex gap-3 rounded-lg border border-transparent px-2 py-2",
        failed && "border-delta-bad/40 bg-delta-bad/5",
      )}
      data-failure={failed || undefined}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card",
          failed && "border-delta-bad/50 text-delta-bad",
        )}
        aria-hidden="true"
      >
        <Icon className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{label}</span>
          {failed && <Pill tone="bad">Failed</Pill>}
          {event.status && !(failed && /^fail(ed|ure)?$/i.test(event.status)) && (
            <Pill tone={failed ? "bad" : "neutral"}>{event.status}</Pill>
          )}
          {event.duration_ms !== null && <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(event.duration_ms)}</span>}
          <time className="ml-auto text-xs text-subtle tabular-nums" dateTime={event.occurred_at} title={formatTimestamp(event.occurred_at)}>
            {formatTime(event.occurred_at)}
          </time>
        </div>
        {(entity || event.entity_id) && (
          <div className="truncate text-xs text-muted-foreground">
            {entity}
            {event.entity_id && (
              <span className="font-mono text-subtle" title={event.entity_id}>
                {" "}
                {event.entity_id.slice(0, 8)}
              </span>
            )}
          </div>
        )}
        {failed && (event.error_code || event.error_message) && (
          <div className="break-words text-xs text-delta-bad">
            {event.error_code && <code className="mr-1.5 font-mono">{event.error_code}</code>}
            {event.error_message}
          </div>
        )}
        {hasDetail(event.detail) && (
          <div>
            <button
              type="button"
              className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} Details
            </button>
            {open && <KeyValues id={detailId} data={event.detail} className="mt-1.5 rounded-md bg-accent/60 p-2" />}
          </div>
        )}
      </div>
    </li>
  );
}

function EventTypeFilter({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (types: string[]) => void }) {
  const chosen = new Set(selected);
  const toggle = (type: string) => onChange(chosen.has(type) ? selected.filter((t) => t !== type) : [...selected, type]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Event types">
          <Filter />
          {selected.length === 0 ? "All event types" : selected.length === 1 ? eventMeta(selected[0]).label : `${selected.length} event types`}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-1 flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>Event types</span>
          {selected.length > 0 && (
            <button type="button" className="rounded hover:text-foreground" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {options.map((type) => {
            const { label, icon: Icon } = eventMeta(type);
            return (
              <li key={type}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={chosen.has(type)} onChange={() => toggle(type)} />
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {label}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function Timeline({ userId }: { userId: string }) {
  const [types, setTypes] = useState<string[]>([]);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const rangeInvalid = Boolean(from && to && from > to);

  const params = {
    user_id: userId,
    ...(rangeInvalid ? {} : { from: from || undefined, to: to || undefined }),
    filters: { event_type: [...types].sort() },
    limit: TIMELINE_PAGE_SIZE,
  };
  const timeline = usePeopleInfinite("user_timeline", params);
  const events = useMemo(() => timeline.rows.map(toEvent), [timeline.rows]);
  const shown = failuresOnly ? events.filter((e) => e.is_failure) : events;

  const options = useMemo(() => {
    const seen = new Set<string>(KNOWN_EVENT_TYPES);
    events.forEach((e) => seen.add(e.event_type));
    types.forEach((t) => seen.add(t));
    return [...seen].sort((a, b) => eventMeta(a).label.localeCompare(eventMeta(b).label));
  }, [events, types]);

  const days = useMemo(() => {
    const groups: { day: string; events: TimelineEvent[] }[] = [];
    for (const event of shown) {
      const day = dayOf(event.occurred_at);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.events.push(event);
      else groups.push({ day, events: [event] });
    }
    return groups;
  }, [shown]);

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadPeopleCsv("user_timeline", params, `user_timeline_${userId.slice(0, 8)}.csv`);
    } catch (error) {
      setExportError(peopleErrorCopy(error).title);
    } finally {
      setExporting(false);
    }
  };

  const filtered = types.length > 0 || failuresOnly || from || to;
  const body = (() => {
    if (timeline.isPending) {
      return (
        <div role="status" className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
          <span className="sr-only">Loading timeline…</span>
        </div>
      );
    }
    if (timeline.isError && events.length === 0) {
      return <ErrorPanel what="The timeline" error={timeline.error} onRetry={() => void timeline.refetch()} />;
    }
    if (events.length === 0) {
      return <p className="py-8 text-center text-sm text-muted-foreground">{filtered ? "No events match these filters." : "No events recorded for this user."}</p>;
    }
    return (
      <>
        {failuresOnly && (
          <p className="text-xs text-muted-foreground" role="status">
            {shown.length.toLocaleString("en-US")} failed of {events.length.toLocaleString("en-US")} loaded events
            {timeline.hasNextPage && " · older events aren't loaded yet"}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No failures among the loaded events.</p>
        ) : (
          <ol className={cn("flex flex-col gap-4 transition-opacity", timeline.isPlaceholderData && "opacity-50")} aria-label="Events, newest first">
            {days.map(({ day, events: dayEvents }) => (
              <li key={day}>
                <h3 className="mb-1 border-b py-1 text-xs font-medium text-muted-foreground">
                  {formatBucketLong(day, "day")}
                </h3>
                <ul className="flex flex-col gap-0.5">
                  {dayEvents.map((event, i) => (
                    <EventRow key={`${event.occurred_at}|${event.event_type}|${event.entity_id ?? i}`} event={event} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <LoadMore
          hasMore={Boolean(timeline.hasNextPage)}
          loading={timeline.isFetchingNextPage}
          onLoad={() => void timeline.fetchNextPage()}
          shown={events.length}
          noun="events"
          error={timeline.isFetchNextPageError ? timeline.error : undefined}
        />
      </>
    );
  })();

  return (
    <section aria-labelledby="timeline-heading" className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="timeline-heading" className="text-sm font-semibold">
          Timeline
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={runExport}
          disabled={exporting || rangeInvalid}
          aria-label="Export timeline CSV"
          title="Exports the selected event types and dates (the failures-only view isn't applied). The export is logged."
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />} CSV
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <EventTypeFilter options={options} selected={types} onChange={setTypes} />
        <label className="flex h-8 items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} />
          Failures only
        </label>
        <span className="flex flex-wrap items-center gap-1">
          <input
            type="date"
            aria-label="Timeline from (UTC)"
            className={controlClass}
            value={from}
            max={to || todayUtc()}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            aria-label="Timeline to (UTC)"
            className={controlClass}
            value={to}
            min={from || undefined}
            max={todayUtc()}
            onChange={(e) => setTo(e.target.value)}
          />
          {(from || to) && (
            <Button variant="ghost" size="icon" className="size-8" aria-label="Clear dates" onClick={() => (setFrom(""), setTo(""))}>
              <X />
            </Button>
          )}
        </span>
        {rangeInvalid && <span className="text-xs text-delta-bad">“From” is after “to”; dates not applied.</span>}
      </div>
      {body}
      {exportError && <p className="text-xs text-delta-bad">Export failed: {exportError}</p>}
    </section>
  );
}
