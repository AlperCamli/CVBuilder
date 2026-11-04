import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_COST } from "@/app/pages";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { FilterBar } from "@/app/FilterBar";
import { MetricsPage } from "./MetricsPage";

const measure = (label: string, unit: string, description?: string) => ({ label, unit, ...(description ? { description } : {}) });
const segmentMeta = { breakdowns: ["ai_flow", "ai_segment"], filters: ["ai_flow", "ai_segment"] };

const CATALOG = [
  {
    name: "ai_cost",
    kind: "metric",
    meta: {
      ...segmentMeta, title: "AI cost", definition: "d", unit: "currency", shape: "timeseries",
      measures: {
        cost: measure("AI cost", "currency"), runs: measure("AI runs", "count"), unpriced_runs: measure("Unpriced runs", "count"),
        exact_share: measure("Stored-cost share", "ratio", "Not coverage of the provider bill."),
      },
    },
  },
  {
    name: "ai_spend",
    kind: "metric",
    meta: {
      ...segmentMeta, title: "AI spend (all provider attempts)", definition: "d", unit: "currency", shape: "timeseries",
      measures: {
        cost: measure("AI spend", "currency"), attempts: measure("Provider attempts", "count"), unpriced_attempts: measure("Unpriced attempts", "count"),
        no_usage_attempts: measure("Attempts without usage", "count"), pre_ledger_cost: measure("Cost from ai_runs", "currency"),
      },
    },
  },
];

const SEGMENT_COST: Record<string, number> = { external: 1, internal: 2, guest: 3, script: 0.5 };

function rowsFor(url: URL) {
  const name = url.pathname.split("/").pop()!;
  const segments = (JSON.parse(url.searchParams.get("filters") ?? "{}").ai_segment ?? []) as string[];
  const bySegment = url.searchParams.get("breakdown") === "ai_segment";
  const cost = (segment: string) => (segments.includes(segment) ? SEGMENT_COST[segment] ?? 0 : 0);
  const row = (dimension: string | null, value: number) =>
    name === "ai_cost"
      ? { bucket: "2026-10-01", dimension, cost: value, runs: 3, unpriced_runs: 1, exact_share: 0.5, fx_provisional: false }
      : { bucket: "2026-10-01", dimension, cost: value, attempts: 4, failed_attempts: 1, no_usage_attempts: 1, unpriced_attempts: 0, pre_ledger_cost: 0, fx_provisional: false };
  return bySegment
    ? Object.keys(SEGMENT_COST).filter((s) => segments.includes(s)).map((s) => row(s, cost(s)))
    : [row(null, Object.keys(SEGMENT_COST).reduce((total, s) => total + cost(s), 0))];
}

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/admin/catalog")) return ok({ metrics: CATALOG });
    return ok({ metric: url.pathname.split("/").pop(), rows: rowsFor(url), generated_at: "2026-10-28T09:00:00Z" });
  });
});

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const renderPage = (search = "") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/ai-cost?from=2026-10-01&to=2026-10-27&grain=month${search}`]}>
        <FilterBar />
        <MetricsPage sections={AI_COST} />
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = async (title: string) => (await screen.findByRole("heading", { name: title, level: 3 })).closest("section")!;
const segmentsSent = (metric: string) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((u) => u.pathname.endsWith(`/${metric}`) && !u.searchParams.has("breakdown"))
    .map((u) => JSON.parse(u.searchParams.get("filters") ?? "{}").ai_segment);

describe("AI cost page: include all AI costs", () => {
  it("counts every segment by default and shows what the total is made of", async () => {
    renderPage();
    const spend = await card("AI spend (all provider attempts)");
    await within(spend).findByText("By segment: External $1 · Admin $2 · Guest $3 · Scripts and tests $0.5");
    expect(segmentsSent("ai_spend")[0]).toEqual(["external", "internal", "guest", "restricted", "script", "unattributed"]);
    const cost = await card("AI cost");
    expect(await within(cost).findByText("Stored-cost share: 50%")).toHaveProperty("title", "Not coverage of the provider bill.");
    expect((screen.getByRole("checkbox", { name: "Include all AI costs" }) as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the external-only view when turned off and lists what it excluded", async () => {
    renderPage("&ai_costs=external");
    const spend = await card("AI spend (all provider attempts)");
    await within(spend).findByText("Not included: Admin $2 · Guest $3 · Scripts and tests $0.5");
    expect(segmentsSent("ai_spend")).toContainEqual(["external"]);
    expect(segmentsSent("ai_spend")).not.toContainEqual(["external", "internal", "guest", "restricted", "script", "unattributed"]);
  });

  it("writes the choice to the URL", async () => {
    renderPage();
    const box = await screen.findByRole("checkbox", { name: "Include all AI costs" });
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByTestId("search").textContent).toContain("ai_costs=external"));
  });
});
