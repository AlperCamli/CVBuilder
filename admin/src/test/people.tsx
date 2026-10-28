import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

export const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });

export const page = (name: string, rows: Record<string, unknown>[], next_cursor: string | null = null) =>
  ok({ name, rows, next_cursor, generated_at: "2026-10-28T09:00:00Z" });

/** The JSON body of a fetch call (people endpoints are POST-only); `{}` when there is none. */
export const bodyOf = (init: unknown): Record<string, unknown> => {
  const body = (init as RequestInit | undefined)?.body;
  return typeof body === "string" ? JSON.parse(body) : {};
};

export interface PeopleCall {
  url: URL;
  method: string;
  body: Record<string, unknown>;
}

/** Requests sent to one people function: URL, method and parsed JSON body. */
export const peopleCalls = (fetchMock: { mock: { calls: unknown[][] } }, name: string): PeopleCall[] =>
  fetchMock.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), method: (init as RequestInit | undefined)?.method ?? "GET", body: bodyOf(init) }))
    .filter((call) => call.url.pathname.endsWith(`/admin/people/${name}`));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

export function renderAt(path: string, routes: { path: string; element: ReactNode }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
