import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { errorCopy } from "@/components/ChartCard";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "muted" | "bad";

const TONES: Record<Tone, string> = {
  neutral: "border-input text-foreground",
  good: "border-delta-good/40 text-delta-good",
  muted: "border-dashed text-subtle",
  bad: "border-delta-bad/40 text-delta-bad",
};

/** A small labelled marker; state is always in the text, never colour alone. */
export function Pill({ tone = "neutral", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-[11px] leading-none", TONES[tone])} title={title}>
      {children}
    </span>
  );
}

export const InternalPill = () => <Pill title="Admin or test account; excluded from metrics by default.">Internal</Pill>;

/** `null` = unknown (e.g. no consent row), shown as such rather than as "no". */
export function ConsentPill({ label, value }: { label: string; value: unknown }) {
  if (value === true) return <Pill tone="good" title={`${label} consent given`}>{label}: yes</Pill>;
  if (value === false) return <Pill tone="muted" title={`${label} consent not given`}>{label}: no</Pill>;
  return <Pill tone="muted" title={`${label} consent unknown`}>{label}: unknown</Pill>;
}

export function peopleErrorCopy(error: unknown) {
  if (error instanceof ApiError && error.status === 400) return { title: "Invalid request", body: error.message };
  if (error instanceof ApiError && error.status === 403) return { title: "No access", body: "Your account is not allowed to look up users." };
  const copy = errorCopy(error);
  return error instanceof ApiError ? copy : { ...copy, body: "The data could not be loaded." };
}

export function ErrorPanel({ error, onRetry, what }: { error: unknown; onRetry?: () => void; what: string }) {
  const copy = peopleErrorCopy(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-delta-bad" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span>
          {what} could not be loaded: {copy.title}.
        </span>
        <span className="text-muted-foreground">{copy.body}</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}

/** A centred message for empty / not-found / restricted states. */
export function StatePanel({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card px-6 py-10 text-center">
      {icon}
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
  shown: number;
  noun: string;
  error?: unknown;
}

export function LoadMore({ hasMore, loading, onLoad, shown, noun, error }: LoadMoreProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 py-2 text-xs text-muted-foreground">
      <span>
        {shown.toLocaleString("en-US")} {noun} loaded{hasMore ? "" : " · end of list"}
      </span>
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onLoad} disabled={loading}>
          {loading && <Loader2 className="animate-spin" />} Load more
        </Button>
      )}
      {error !== undefined && error !== null && <span className="text-delta-bad">Loading more failed: {peopleErrorCopy(error).title}</span>}
    </div>
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return <span className="text-subtle">—</span>;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString("en-US");
  if (typeof value === "string") return value;
  // Nested metadata: shown as JSON text (React escapes it), never interpreted as markup.
  return <code className="whitespace-pre-wrap break-all font-mono text-[11px]">{JSON.stringify(value, null, 1)}</code>;
}

/** Metadata as key/value pairs. Everything renders as text; nothing is ever injected as HTML. */
export function KeyValues({ data, className, id }: { data: unknown; className?: string; id?: string }) {
  const entries = isPlainObject(data) ? Object.entries(data) : data === null || data === undefined ? [] : [["value", data] as const];
  if (entries.length === 0) return <p id={id} className={cn("text-xs text-subtle", className)}>No details.</p>;
  return (
    <dl id={id} className={cn("grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-3 gap-y-1 text-xs", className)}>
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{humanize(key)}</dt>
          <dd className="min-w-0 break-words">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
