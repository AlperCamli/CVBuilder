import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSection } from "@/app/pages";
import { peopleCalls } from "@/test/people";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { MetricsPage } from "./MetricsPage";

const SECTIONS: PageSection[] = [
  {
    title: "Retention",
    metrics: [
      { name: "cohort_retention", title: "Cohort retention", shape: "cohort" },
      { name: "signups", title: "Signups", shape: "timeseries" },
    ],
  },
];

const catalog = (precomputed: boolean) => [
  {
    name: "cohort_retention",
    kind: "metric",
    meta: {
      title: "Cohort retention",
      definition: "d",
      unit: "ratio",
      shape: "cohort",
      breakdowns: [],
      filters: ["market"],
      drill: true,
      ...(precomputed ? { precomputed: true } : {}),
      measures: { cohort_size: { label: "Cohort size", unit: "count" }, active: { label: "Active", unit: "count" }, rate: { label: "Retention", unit: "ratio" } },
    },
  },
  {
    name: "signups",
    kind: "metric",
    meta: { title: "Signups", definition: "d", unit: "count", shape: "timeseries", breakdowns: [], filters: [], measures: { signups: { label: "Signups", unit: "count" } } },
  },
  {
    name: "drill_users",
    kind: "people",
    meta: {
      title: "Users behind a metric point",
      drill_metrics: { cohort_active_users: { metric: "cohort_retention", filters: ["cohort", "period", "grain", "market", "locale"] } },
    },
  },
];

let precomputed: boolean;
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

beforeEach(() => {
  precomputed = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/admin/catalog") return ok({ metrics: catalog(precomputed) });
    if (path === "/admin/recompute/status") {
      return ok({ run_id: 9, kind: "nightly", status: "done", finished_at: "2026-10-28T03:46:00Z", open_run_id: null, retry_after_seconds: 0, as_of: "2026-10-28T03:45:30Z" });
    }
    if (path === "/admin/people/drill_users") return ok({ name: "drill_users", rows: [], next_cursor: null, generated_at: "2026-10-28T09:00:00Z" });
    const name = path.split("/").pop()!;
    const rows =
      name === "cohort_retention"
        ? [
            { cohort: "2026-10-05", period: 0, cohort_size: 40, active: 40, rate: 1 },
            { cohort: "2026-10-05", period: 1, cohort_size: 40, active: 10, rate: 0.25 },
          ]
        : [{ bucket: "2026-10-05", dimension: null, signups: 4 }];
    return ok({ metric: name, rows, generated_at: "2026-10-28T09:00:00Z" });
  });
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/engagement?from=2026-10-01&to=2026-10-27&grain=week&filters=%7B%22market%22%3A%22TR%22%7D"]}>
        <MetricsPage sections={SECTIONS} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = async (title: string) => (await screen.findByRole("heading", { name: title, level: 3 })).closest("section")!;

describe("pages with pre-computed metrics", () => {
  it("offer Recompute and date pre-computed cards by the last view build", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: /Recompute/ })).toBeTruthy();
    const cohort = await card("Cohort retention");
    expect(await within(cohort).findByText("Data as of Oct 28, 2026, 03:45 UTC")).toBeTruthy();
    // Live metrics keep the request time.
    expect(await within(await card("Signups")).findByText("Data as of Oct 28, 2026, 09:00 UTC")).toBeTruthy();
  });

  it("hide Recompute when no metric on the page is pre-computed", async () => {
    precomputed = false;
    renderPage();
    await within(await card("Cohort retention")).findByText("Data as of Oct 28, 2026, 09:00 UTC");
    expect(screen.queryByRole("button", { name: /Recompute/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/admin/recompute/status"))).toBe(false);
  });

  it("drill with the catalog's drill key and the page grain", async () => {
    renderPage();
    const cohort = await card("Cohort retention");
    fireEvent.click(await within(cohort).findByText("25%"));
    await waitFor(() => expect(peopleCalls(fetchMock, "drill_users")).toHaveLength(1));
    expect(peopleCalls(fetchMock, "drill_users")[0].body.filters).toEqual({
      market: "TR",
      cohort: "2026-10-05",
      period: 1,
      grain: "week",
      metric: "cohort_active_users",
    });
  });
});
