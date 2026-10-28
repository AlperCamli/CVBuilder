import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, page, peopleCalls } from "@/test/people";

vi.mock("./supabase", () => ({ getAccessToken: vi.fn(async () => "token-123") }));

import { downloadPeopleCsv, fetchPeople, isUuid, peopleBody, usePeople, usePeopleInfinite } from "./people";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

describe("peopleBody", () => {
  it("keeps filters as an object, trims q and keeps the cursor and limit", () => {
    expect(
      peopleBody({
        q: "  ali@ex ",
        from: "2026-10-01",
        to: "2026-10-28",
        filters: { event_type: ["ai_run", "export"], metric: "signups" },
        limit: 100,
        cursor: "2026-10-27T10:00:00Z|ai_run|abc",
      }),
    ).toEqual({
      q: "ali@ex",
      from: "2026-10-01",
      to: "2026-10-28",
      filters: { event_type: ["ai_run", "export"], metric: "signups" },
      limit: 100,
      cursor: "2026-10-27T10:00:00Z|ai_run|abc",
    });
  });

  it("drops empty filters and blank values", () => {
    expect(peopleBody({ user_id: "u", q: "  ", from: "", filters: { event_type: [], market: null } })).toEqual({ user_id: "u" });
  });
});

describe("fetchPeople", () => {
  it("POSTs a JSON body and keeps every parameter out of the URL", async () => {
    fetchMock.mockResolvedValueOnce(page("search_users", [{ user_id: "1", email: "a@b.co" }], "c1"));
    const result = await fetchPeople("search_users", { q: "a@b", limit: 50 });
    expect(result.next_cursor).toBe("c1");
    const [call] = peopleCalls(fetchMock, "search_users");
    expect(call.method).toBe("POST");
    expect(call.url.search).toBe("");
    expect(call.body).toEqual({ q: "a@b", limit: 50 });
    const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer token-123");
  });

  it("downloads CSV through the same POST, with format in the body", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      new Response("user_id,email\n1,a@b.co\n", { status: 200, headers: { "Content-Disposition": 'attachment; filename="search.csv"' } }),
    );
    await downloadPeopleCsv("search_users", { q: "a@b", cursor: "c1", limit: 5 });
    const [call] = peopleCalls(fetchMock, "search_users");
    expect(call.method).toBe("POST");
    expect(call.url.search).toBe("");
    expect(call.body).toEqual({ q: "a@b", format: "csv" });
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it("never sends a search shorter than 3 characters", async () => {
    await expect(fetchPeople("search_users", { q: "ab" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hooks", () => {
  it("usePeople keeps nothing cached once unmounted", async () => {
    fetchMock.mockImplementation(async () => page("user_summary", [{ user_id: "u1" }]));
    const client = new QueryClient();
    const { result, unmount } = renderHook(() => usePeople("user_summary", { user_id: "u1" }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data?.rows).toHaveLength(1));
    const [cached] = client.getQueryCache().findAll({ queryKey: ["people:user_summary"] });
    expect(cached?.isStale()).toBe(true);
    unmount();
    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
  });

  it("usePeopleInfinite pages with next_cursor", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const cursor = bodyOf(init).cursor;
      return cursor
        ? page("user_timeline", [{ occurred_at: "2026-10-01T00:00:00Z" }])
        : page("user_timeline", [{ occurred_at: "2026-10-02T00:00:00Z" }], "next-1");
    });
    const { result } = renderHook(
      () => usePeopleInfinite("user_timeline", { user_id: "u1", filters: { event_type: ["ai_run"] }, limit: 1 }),
      { wrapper: wrapper(new QueryClient()) },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasNextPage).toBe(false);

    const calls = peopleCalls(fetchMock, "user_timeline");
    expect(calls.map((c) => c.body.cursor ?? null)).toEqual([null, "next-1"]);
    expect(calls.every((c) => JSON.stringify(c.body.filters) === '{"event_type":["ai_run"]}')).toBe(true);
    expect(calls.every((c) => c.body.user_id === "u1" && c.body.limit === 1 && c.url.search === "")).toBe(true);
  });
});

describe("helpers", () => {
  it("recognises user ids", () => {
    expect(isUuid("3f2b6c1e-8a4d-4f7e-9b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isUuid("3f2b6c1e")).toBe(false);
  });
});
