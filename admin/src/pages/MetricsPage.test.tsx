import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MONETIZATION } from "@/app/pages";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { fullWidthCards, MetricsPage } from "./MetricsPage";

const measure = (label: string, unit: string) => ({ label, unit });
const base = { definition: "d", breakdowns: [], filters: [] };

/** Only four of the ten Monetization metrics exist yet. */
const CATALOG = [
  {
    name: "revenue",
    kind: "metric",
    meta: { ...base, title: "Revenue", unit: "currency", shape: "timeseries", breakdowns: ["plan"], filters: ["plan"], measures: { revenue: measure("Revenue", "currency"), invoices: measure("Invoices", "count") } },
  },
  {
    name: "mrr_movement",
    kind: "metric",
    meta: {
      ...base,
      title: "MRR movement",
      unit: "currency",
      shape: "timeseries",
      breakdowns: ["plan"],
      filters: ["plan"],
      plot: ["new_mrr", "expansion", "contraction", "churn"],
      stacked: true,
      measures: {
        new_mrr: measure("New", "currency"),
        expansion: measure("Expansion", "currency"),
        contraction: measure("Contraction", "currency"),
        churn: measure("Churn", "currency"),
      },
    },
  },
  {
    name: "plan_mix",
    kind: "metric",
    meta: {
      ...base,
      title: "Plan mix",
      unit: "count",
      shape: "breakdown",
      filters: ["plan", "market"],
      breakdown_dimension: "plan",
      measures: { subscriptions: measure("Active subscriptions", "count"), mrr: measure("MRR", "currency") },
    },
  },
  {
    name: "checkout_funnel",
    kind: "metric",
    meta: { ...base, title: "Checkout funnel", unit: "count", shape: "funnel", filters: ["plan"], drill: { step: "text" }, measures: { users: measure("Users", "count") } },
  },
];

const MONTHS = ["2026-08-01", "2026-09-01", "2026-10-01"];

function rowsFor(name: string) {
  switch (name) {
    case "revenue":
      return MONTHS.map((bucket) => ({ bucket, dimension: null, revenue: 100, invoices: 4, fx_provisional: false }));
    case "mrr_movement":
      return MONTHS.map((bucket) => ({ bucket, dimension: null, new_mrr: 50, expansion: 5, contraction: -3, churn: -20 }));
    case "plan_mix":
      return [
        { dimension: "pro", subscriptions: 30, mrr: 300 },
        { dimension: "free", subscriptions: 2, mrr: 0 },
      ];
    case "checkout_funnel":
      return [
        { step_order: 1, step: "Viewed plans", users: 100, conversion_from_prev: null, conversion_from_start: 1 },
        { step_order: 2, step: "Paid", users: 10, conversion_from_prev: 0.1, conversion_from_start: 0.1 },
      ];
    default:
      throw new Error(`unexpected metric ${name}`);
  }
}

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/admin/catalog")) return ok({ metrics: CATALOG });
    const name = url.pathname.split("/").pop()!;
    if (url.pathname.includes("/admin/people/")) return ok({ name, rows: [], next_cursor: null, generated_at: "2026-10-28T09:00:00Z" });
    return ok({ metric: name, rows: rowsFor(name), generated_at: "2026-10-28T09:00:00Z" });
  });
});

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const renderPage = (search = "") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/monetization?from=2026-08-01&to=2026-10-27&grain=month${search}`]}>
        <MetricsPage sections={MONETIZATION} />
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const requested = () => fetchMock.mock.calls.map(([input]) => new URL(String(input)));
const card = async (title: string) => (await screen.findByRole("heading", { name: title, level: 3 })).closest("section")!;

describe("Monetization page with a partial catalog", () => {
  it("renders sections, real charts, and compact cards for metrics without SQL yet", async () => {
    renderPage("&breakdown=plan");
    for (const title of ["Revenue and MRR", "Conversion", "Churn and payment issues"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
    await waitFor(() => expect(screen.getAllByText("Not available yet")).toHaveLength(6));
    expect(screen.getByRole("region", { name: "Subscriber LTV" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Cancellation reasons" })).toBeTruthy();

    // Missing metrics are never requested; the plotted-measure chart drops the page breakdown.
    await card("MRR movement");
    const names = new Set(requested().map((u) => u.pathname.split("/").pop()));
    expect([...names].sort()).toEqual(["catalog", "checkout_funnel", "mrr_movement", "plan_mix", "revenue"]);
    expect(requested().filter((u) => u.pathname.endsWith("/mrr_movement")).every((u) => !u.searchParams.has("breakdown"))).toBe(true);
    expect(requested().some((u) => u.pathname.endsWith("/revenue") && u.searchParams.get("breakdown") === "plan")).toBe(true);

    const mrr = await card("MRR movement");
    const legend = await within(mrr).findByRole("list", { name: "Series" });
    expect(within(legend).getAllByRole("button").map((b) => b.textContent)).toEqual(["New", "Expansion", "Contraction", "Churn"]);
    expect(within(mrr).queryByRole("combobox")).toBeNull();
  });

  it("lays out wide timeseries, paired half cards, and stretches a lone half card", async () => {
    renderPage();
    const mrr = await card("MRR movement");
    const planMix = await card("Plan mix");
    const funnel = await card("Checkout funnel");
    await waitFor(() => expect(screen.getAllByText("Not available yet")).toHaveLength(6));
    expect(mrr.className).toContain("xl:col-span-2");
    // plan_mix pairs with the (not yet available) subscriber LTV card.
    expect(planMix.className).not.toContain("xl:col-span-2");
    expect(screen.getByRole("region", { name: "Subscriber LTV" }).className).not.toContain("xl:col-span-2");
    // In Conversion the funnel is the only half-width card left (the two timeseries aren't available yet).
    expect(funnel.className).toContain("xl:col-span-2");
  });

  it("filters the page by a breakdown bar and drills from a funnel step", async () => {
    renderPage();
    const planMix = await card("Plan mix");
    fireEvent.click(await within(planMix).findByRole("button", { name: /Filter to pro/ }));
    await waitFor(() => expect(screen.getByTestId("search").textContent).toContain(encodeURIComponent('{"plan":"pro"}')));

    const funnel = await card("Checkout funnel");
    fireEvent.click(await within(funnel).findByRole("button", { name: /Show users at Paid/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) => String(input).includes("/admin/people/drill_users"));
      expect(JSON.parse(String(call![1]!.body)).filters).toEqual({ plan: "pro", step: "Paid", metric: "checkout_funnel" });
    });
  });
});

describe("fullWidthCards", () => {
  it("pairs half cards and stretches the ones left alone", () => {
    expect(fullWidthCards([true, false, false, false, true, false])).toEqual([true, false, false, true, true, true]);
    expect(fullWidthCards([false, false])).toEqual([false, false]);
  });
});
