import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { DataHealthPage } from "./DataHealth";

const CATALOG = [
  {
    name: "data_freshness",
    kind: "metric",
    meta: { title: "Data freshness", definition: "Checks.", unit: "count", shape: "table", breakdowns: [], filters: [], measures: { value: { label: "Value", unit: "count" } } },
  },
  {
    name: "cohort_retention",
    kind: "metric",
    meta: { title: "Cohort retention", definition: "d", unit: "ratio", shape: "cohort", breakdowns: [], filters: [], precomputed: true },
  },
];

const FRESHNESS = [
  { item: "nightly_refresh", label: "Last nightly refresh of pre-computed metrics", status: "ok", value: 12.5, value_text: "done", at: "2026-10-28T03:46:00Z", detail: { run_id: 4, error: null } },
  { item: "last_recompute", label: "Last recompute", status: "error", value: 3, value_text: "failed", at: "2026-10-27T10:00:00Z", detail: { error: "lock timeout" } },
  { item: "unpriced_ai_runs_30d", label: "Unpriced AI runs (last 30 days)", status: "warn", value: 4, value_text: "runs", at: null, detail: { models: { "gpt-x": 4 } } },
  { item: "contract_violations", label: "Analytics contract violations", status: "ok", value: 0, value_text: "violations", at: null, detail: null },
];

const AUDIT = [
  {
    id: 3,
    at: "2026-10-28T09:30:00Z",
    admin_email: "ops@example.com",
    action: "export.csv",
    target_user_id: null,
    people_function: "search_users",
    params: { function: "search_users", query_hmac: "deadbeefcafe" },
  },
  {
    id: 2,
    at: "2026-10-28T09:00:00Z",
    admin_email: "ops@example.com",
    action: "people.summary",
    target_user_id: "3f2b6c1e-8a4d-4f7e-9b2a-1c3d5e7f9a0b",
    people_function: "user_summary",
    params: { secret_note: "do not show" },
  },
];

const done = (runId: number, asOf: string) => ({
  run_id: runId,
  kind: "recompute",
  status: "done",
  requested_at: "2026-10-28T09:00:00Z",
  requested_by: "ops@example.com",
  started_at: "2026-10-28T09:00:30Z",
  finished_at: "2026-10-28T09:01:00Z",
  duration_seconds: 30,
  error: null,
  open_run_id: null,
  retry_after_seconds: 0,
  as_of: asOf,
});

let status: Record<string, unknown>;
let recompute: () => Response;

const ok = (data: unknown, code = 200) => new Response(JSON.stringify({ success: true, data }), { status: code });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  status = done(5, "2026-10-28T03:45:30Z");
  recompute = () => {
    status = { ...status, run_id: 6, status: "pending", finished_at: null, open_run_id: 6, requested_at: "2026-10-28T10:00:00Z" };
    return ok({ status: "queued", run_id: 6 }, 202);
  };
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/admin/catalog") return ok({ metrics: CATALOG });
    if (path === "/admin/metrics/data_freshness") return ok({ metric: "data_freshness", rows: FRESHNESS, generated_at: "2026-10-28T10:00:00Z" });
    if (path === "/admin/recompute/status") return ok(status);
    if (path === "/admin/recompute" && init?.method === "POST") return recompute();
    if (path === "/admin/audit/recent") return ok(AUDIT);
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(() => vi.useRealTimers());

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/data-health?include_internal=true&breakdown=market"]}>
        <DataHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const requests = (path: string) => fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname.endsWith(path));

describe("Data health", () => {
  it("colours freshness checks by status with a label and formats each value", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Data freshness checks" });
    const row = (label: string) => within(table).getByText(label).closest("tr")!;
    expect(within(row("Last nightly refresh of pre-computed metrics")).getByText("OK")).toBeTruthy();
    expect(within(row("Last nightly refresh of pre-computed metrics")).getByText("done · 12.5 s")).toBeTruthy();
    expect(within(row("Last recompute")).getByText("Error")).toBeTruthy();
    expect(within(row("Last recompute")).getByText("lock timeout")).toBeTruthy();
    expect(within(row("Unpriced AI runs (last 30 days)")).getByText("Warning")).toBeTruthy();
    expect(within(row("Unpriced AI runs (last 30 days)")).getByText("gpt-x: 4")).toBeTruthy();
    expect(screen.getByText("1 error, 1 warning need attention.")).toBeTruthy();
    // Page filters never reach data_freshness.
    const query = new URL(String(requests("/metrics/data_freshness")[0][0])).searchParams;
    expect(query.get("include_internal")).toBe("false");
    expect(query.has("breakdown")).toBe(false);
  });

  it("lists recent audit entries with a shortened target and no parameters", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Recent admin activity" });
    // Each email shows once in the desktop column and once under the time on narrow screens (CSS hides one).
    expect(within(table).getAllByText("ops@example.com")).toHaveLength(4);
    expect(within(table).getByText("export.csv")).toBeTruthy();
    expect(within(table).getByText(/search_users/)).toBeTruthy();
    expect(within(table).getByText("3f2b6c1e…")).toBeTruthy();
    expect(within(table).getByText("user 3f2b6c1e…")).toBeTruthy();
    expect(table.textContent).not.toMatch(/8a4d|deadbeef|do not show/);
    expect(new URL(String(requests("/admin/audit/recent")[0][0])).searchParams.get("limit")).toBe("50");
  });

  it("queues a recompute, polls every 5 s until done, then refetches pre-computed data", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    const card = (await screen.findByRole("heading", { name: "Pre-computed metrics" })).closest("section")!;
    await within(card).findByText("Oct 28, 2026, 03:45 UTC");
    const freshnessBefore = requests("/metrics/data_freshness").length;

    fireEvent.click(within(card).getByRole("button", { name: /Recompute/ }));
    expect(await within(card).findByText("Queued…")).toBeTruthy();
    expect((within(card).getByRole("button", { name: /Recompute/ }) as HTMLButtonElement).disabled).toBe(true);
    const polls = requests("/admin/recompute/status").length;

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(requests("/admin/recompute/status").length).toBeGreaterThan(polls); // still pending: polled again
    expect(within(card).getByText("Queued…")).toBeTruthy();

    status = { ...done(6, "2026-10-28T10:00:40Z") };
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(await within(card).findByText("Recomputed — data as of Oct 28, 2026, 10:00 UTC")).toBeTruthy();
    await waitFor(() => expect(requests("/metrics/data_freshness").length).toBeGreaterThan(freshnessBefore));

    // Done: polling stops.
    const settled = requests("/admin/recompute/status").length;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(requests("/admin/recompute/status").length).toBe(settled);
  });

  it("explains a throttled request and keeps the button disabled while waiting", async () => {
    recompute = () => ok({ status: "throttled", run_id: null, retry_after_seconds: 120 }, 429);
    renderPage();
    const card = (await screen.findByRole("heading", { name: "Pre-computed metrics" })).closest("section")!;
    await within(card).findByText("Oct 28, 2026, 03:45 UTC");
    fireEvent.click(within(card).getByRole("button", { name: /Recompute/ }));
    expect(await within(card).findByText("Recently recomputed — try again in 120 s")).toBeTruthy();
    expect((within(card).getByRole("button", { name: /Recompute/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
