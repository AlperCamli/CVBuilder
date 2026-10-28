import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiPost, downloadCsvPost } from "./api";

/**
 * People endpoints (`POST /admin/people/:name`, JSON body) return personal data. Every call is audited server-side.
 * Parameters (search terms, user ids) travel in the body, never in a URL, so they stay out of proxy and access logs
 * and browser history. Answers are never kept beyond the screen showing them: no stale reuse, dropped from memory as
 * soon as nothing renders them, and never written to local/session storage.
 */
export const PEOPLE_FUNCTIONS = ["search_users", "user_summary", "user_timeline", "drill_users"] as const;
export type PeopleFunction = (typeof PEOPLE_FUNCTIONS)[number];

export const SEARCH_MIN = 3;
export const SEARCH_MAX = 200;
export const PEOPLE_PAGE_SIZE = 50;

export type PeopleFilters = Record<string, unknown>;

export interface PeopleParams {
  user_id?: string;
  q?: string;
  from?: string;
  to?: string;
  filters?: PeopleFilters;
  limit?: number;
  cursor?: string;
}

export type PeopleRow = Record<string, unknown>;

export const peopleResultSchema = z.object({
  name: z.string(),
  rows: z.array(z.record(z.unknown())),
  next_cursor: z.string().nullable().optional().transform((cursor) => cursor ?? null),
  generated_at: z.string(),
});
export type PeopleResult = z.infer<typeof peopleResultSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value.trim());

/** Drops empty values so `{ event_type: [] }` doesn't narrow the server query to nothing. */
const compactFilters = (filters: PeopleFilters | undefined) =>
  Object.fromEntries(
    Object.entries(filters ?? {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0),
    ),
  );

/** The request body: empty values are left out, `filters` stays a JSON object. */
export interface PeopleBody {
  user_id?: string;
  q?: string;
  from?: string;
  to?: string;
  filters?: PeopleFilters;
  limit?: number;
  cursor?: string;
}

export function peopleBody(params: PeopleParams): PeopleBody {
  const filters = compactFilters(params.filters);
  const body: PeopleBody = {
    user_id: params.user_id?.trim() || undefined,
    q: params.q?.trim() || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    filters: Object.keys(filters).length ? filters : undefined,
    limit: params.limit,
    cursor: params.cursor || undefined,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as PeopleBody;
}

const peoplePath = (name: PeopleFunction) => `/admin/people/${name}`;

export function fetchPeople(name: PeopleFunction, params: PeopleParams, signal?: AbortSignal) {
  const q = params.q?.trim();
  if (q && (q.length < SEARCH_MIN || q.length > SEARCH_MAX)) {
    return Promise.reject(new ApiError(400, "VALIDATION_ERROR", `Search must be ${SEARCH_MIN}–${SEARCH_MAX} characters.`));
  }
  return apiPost(peoplePath(name), peopleResultSchema, peopleBody(params), signal);
}

/** CSV of the whole list (server pages through it, max 50,000 rows); the export is audited as `export.csv`. */
export const downloadPeopleCsv = (name: PeopleFunction, params: PeopleParams, fallbackName = `${name}.csv`) =>
  downloadCsvPost(peoplePath(name), { ...peopleBody({ ...params, cursor: undefined, limit: undefined }) }, fallbackName);

// "people:" can never be a metric name (`^[a-z][a-z0-9_]*$`), and it isn't "@"-prefixed, so page Refresh re-fetches it.
export const peopleKey = (name: PeopleFunction, ...rest: unknown[]) => [`people:${name}`, ...rest] as const;

const PRIVATE = { staleTime: 0, gcTime: 0, refetchOnWindowFocus: false } as const;

export function usePeople(name: PeopleFunction, params: PeopleParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: peopleKey(name, peopleBody(params)),
    queryFn: ({ signal }) => fetchPeople(name, params, signal),
    enabled: opts.enabled ?? true,
    ...PRIVATE,
  });
}

/** Cursor pagination: each page sends the previous page's `next_cursor`. */
export function usePeopleInfinite(name: PeopleFunction, params: Omit<PeopleParams, "cursor">, opts: { enabled?: boolean } = {}) {
  const base = { ...params, limit: params.limit ?? PEOPLE_PAGE_SIZE };
  const query = useInfiniteQuery({
    queryKey: peopleKey(name, "pages", peopleBody(base)),
    queryFn: ({ pageParam, signal }) => fetchPeople(name, { ...base, cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: opts.enabled ?? true,
    // Keeps the old list on screen while a changed filter loads, instead of flashing a skeleton.
    placeholderData: keepPreviousData,
    ...PRIVATE,
  });
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  return { ...query, rows, generatedAt: query.data?.pages[0]?.generated_at };
}
