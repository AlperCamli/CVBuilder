import { Download, Loader2, Search, ShieldAlert, Users as UsersIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ConsentPill, ErrorPanel, InternalPill, LoadMore, peopleErrorCopy, StatePanel } from "@/components/people/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, humanize } from "@/lib/format";
import {
  downloadPeopleCsv,
  isUuid,
  SEARCH_MAX,
  SEARCH_MIN,
  usePeopleInfinite,
  type PeopleRow,
} from "@/lib/people";
import { cn } from "@/lib/utils";

export const SEARCH_DEBOUNCE_MS = 300;

const text = (v: unknown) => (typeof v === "string" && v ? v : "—");
const label = (v: unknown) => (typeof v === "string" && v ? humanize(v) : "—");
export const isValidSearch = (q: string) => q.trim().length >= SEARCH_MIN && q.trim().length <= SEARCH_MAX;

/** "3f2b6c1e…": enough to tell rows apart without showing the whole id. */
export const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

function ResultRow({ row, linkSearch }: { row: PeopleRow; linkSearch: string }) {
  const id = String(row.user_id ?? "");
  const email = text(row.email);
  if (row.restricted === true) {
    // Restricted processing: never linked, and the email may be withheld (null) by the server.
    const shown = typeof row.email === "string" && row.email ? row.email : "Restricted user (no data shown)";
    return (
      <tr className="border-t align-top" data-restricted="true">
        <td className="max-w-0 py-2 pr-3">
          <div className="truncate text-muted-foreground">{shown}</div>
          <div className="mt-0.5 font-mono text-xs text-subtle">{shortId(id)}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
            <ShieldAlert className="size-3.5" aria-hidden="true" /> Restricted — no data shown
          </div>
        </td>
        <td colSpan={5} className="hidden py-2 text-muted-foreground sm:table-cell">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="size-4" aria-hidden="true" /> Restricted — no data shown
          </span>
        </td>
      </tr>
    );
  }
  const plan = label(row.plan_code);
  const status = label(row.subscription_status);
  const flags = (
    <span className="flex flex-wrap gap-1">
      <ConsentPill label="Analytics" value={row.analytics_consent} />
      {row.is_internal === true && <InternalPill />}
    </span>
  );
  return (
    <tr className="border-t align-top hover:bg-accent/50">
      <td className="max-w-0 py-2 pr-3">
        <Link
          to={{ pathname: `/users/${encodeURIComponent(id)}`, search: linkSearch }}
          state={{ fromSearch: true }}
          className="block truncate font-medium text-primary hover:underline"
          title={email}
        >
          {email}
        </Link>
        <div className="mt-0.5 flex flex-col gap-1 text-xs text-muted-foreground sm:hidden">
          <span>
            {plan} · {status} · {text(row.market)} · since {formatDate(row.created_at)}
          </span>
          {flags}
        </div>
      </td>
      <td className="hidden whitespace-nowrap py-2 pr-3 tabular-nums sm:table-cell">{formatDate(row.created_at)}</td>
      <td className="hidden py-2 pr-3 sm:table-cell">{text(row.market)}</td>
      <td className="hidden py-2 pr-3 sm:table-cell">{plan}</td>
      <td className="hidden py-2 pr-3 sm:table-cell">{status}</td>
      <td className="hidden py-2 sm:table-cell">{flags}</td>
    </tr>
  );
}

function Results({ q }: { q: string }) {
  // Page filters (if any) carry over to the profile link; the search term is never in the URL to begin with.
  const { search } = useLocation();
  const results = usePeopleInfinite("search_users", { q });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (results.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
        <span className="sr-only">Searching…</span>
      </div>
    );
  }
  if (results.isError && results.rows.length === 0) {
    return <ErrorPanel what="Search results" error={results.error} onRetry={() => void results.refetch()} />;
  }
  if (results.rows.length === 0) {
    return (
      <StatePanel icon={<UsersIcon className="size-6 text-subtle" aria-hidden="true" />} title="No matching users">
        Nothing matches “{q.trim()}”. Users pending deletion and erased users never appear in search.
      </StatePanel>
    );
  }

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadPeopleCsv("search_users", { q }, "user_search.csv");
    } catch (error) {
      setExportError(peopleErrorCopy(error).title);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-label="Search results" className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Results</h2>
        <Button variant="ghost" size="sm" onClick={runExport} disabled={exporting} aria-label="Export results CSV" title="The export is logged.">
          {exporting ? <Loader2 className="animate-spin" /> : <Download />} CSV
        </Button>
      </header>
      <table className={cn("w-full table-fixed text-sm transition-opacity", results.isPlaceholderData && "opacity-50")}>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-full py-1.5 pr-3 font-medium sm:w-[34%]">
              Email
            </th>
            <th scope="col" className="hidden w-[12%] py-1.5 pr-3 font-medium sm:table-cell">
              Signed up
            </th>
            <th scope="col" className="hidden w-[8%] py-1.5 pr-3 font-medium sm:table-cell">
              Market
            </th>
            <th scope="col" className="hidden w-[10%] py-1.5 pr-3 font-medium sm:table-cell">
              Plan
            </th>
            <th scope="col" className="hidden w-[11%] py-1.5 pr-3 font-medium sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden w-[25%] py-1.5 font-medium sm:table-cell">
              Flags
            </th>
          </tr>
        </thead>
        <tbody>
          {results.rows.map((row, i) => (
            <ResultRow key={String(row.user_id ?? i)} row={row} linkSearch={search} />
          ))}
        </tbody>
      </table>
      <LoadMore
        hasMore={Boolean(results.hasNextPage)}
        loading={results.isFetchingNextPage}
        onLoad={() => void results.fetchNextPage()}
        shown={results.rows.length}
        noun="users"
        error={results.isFetchNextPageError ? results.error : undefined}
      />
      {exportError && <p className="text-xs text-delta-bad">Export failed: {exportError}</p>}
    </section>
  );
}

/** The term saved on this history entry (`history.state`), so back/forward restores the search. */
const termIn = (state: unknown) => {
  const q = (state as { q?: unknown } | null)?.q;
  return typeof q === "string" ? q : "";
};

/**
 * The search term is personal data: it lives in component state and in this history entry's state, never in the
 * address bar, links, or any URL sent to the API (searches are POSTed).
 */
export function UsersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const legacyQ = new URLSearchParams(location.search).get("q");
  const savedQ = termIn(location.state);
  const [input, setInput] = useState(savedQ || legacyQ || "");
  const [term, setTerm] = useState(() => {
    const initial = (savedQ || legacyQ || "").trim();
    return isValidSearch(initial) ? initial : "";
  });
  const lastWritten = useRef(savedQ);

  // An old link may still carry ?q=: take it into state and scrub it from the address bar.
  useEffect(() => {
    if (legacyQ === null) return;
    const params = new URLSearchParams(location.search);
    params.delete("q");
    const rest = params.toString();
    const legacy = legacyQ.trim();
    lastWritten.current = isValidSearch(legacy) ? legacy : "";
    navigate(
      { pathname: location.pathname, search: rest ? `?${rest}` : "" },
      { replace: true, state: { ...(location.state as object | null), q: lastWritten.current || undefined } },
    );
  }, [legacyQ, location.pathname, location.search, location.state, navigate]);

  // Back/forward lands on an entry with its own saved term; mirror it unless it is the value we just wrote.
  useEffect(() => {
    if (legacyQ !== null || savedQ === lastWritten.current) return;
    lastWritten.current = savedQ;
    setInput(savedQ);
    setTerm(isValidSearch(savedQ) ? savedQ.trim() : "");
  }, [savedQ, legacyQ]);

  // Debounced: only a settled, valid term reaches the API. `replace` keeps typing out of history.
  useEffect(() => {
    const next = isValidSearch(input) ? input.trim() : "";
    if (next === lastWritten.current) return;
    const timer = setTimeout(() => {
      lastWritten.current = next;
      setTerm(next);
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: { ...(location.state as object | null), q: next || undefined } },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, navigate, location.pathname, location.search, location.state]);

  const trimmed = input.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_MIN;
  const showResults = isValidSearch(term) && isValidSearch(trimmed);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="user-search" className="text-sm font-medium">
          Find a user
        </label>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            id="user-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={SEARCH_MAX}
            placeholder="Email (or part of it) or user ID"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby="user-search-hint"
          />
        </div>
        <p id="user-search-hint" className="text-xs text-muted-foreground" aria-live="polite">
          {tooShort
            ? `Type at least ${SEARCH_MIN} characters.`
            : isUuid(trimmed)
              ? "Looking up this exact user ID."
              : "Matches email prefixes first, then anywhere in the email. Signed-up users only."}
        </p>
      </div>
      {showResults ? (
        <div className={cn("transition-opacity", term !== trimmed && "opacity-60")}>
          <Results q={term} />
        </div>
      ) : trimmed.length === 0 ? (
        <StatePanel icon={<Search className="size-6 text-subtle" aria-hidden="true" />} title="Search for a user">
          Enter an email fragment or a full user ID to open their account summary and timeline.
        </StatePanel>
      ) : null}
    </>
  );
}
