import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/filters";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { OverviewPage } from "./Overview";

const measure = (label: string, unit: string, description?: string) => ({ label, unit, ...(description ? { description } : {}) });

const CATALOG = [
  {
    name: "kpi_overview",
    kind: "metric",
    meta: {
      title: "Overview KPIs",
      definition: "Headline numbers for the range.",
      unit: "count",
      shape: "kpi",
      breakdowns: [],
      filters: ["market", "plan"],
      kb: "new_analysis/README.md",
      min_group: 5,
      measures: {
        signups: { ...measure("Signups", "count"), ignores_filters: ["plan"] },
        activated_users: { ...measure("Activated users", "count"), ignores_filters: ["plan"] },
        activation_eligible: { ...measure("Signups past 7 days", "count"), ignores_filters: ["plan"] },
        activated_eligible: { ...measure("Activated (past 7 days)", "count"), ignores_filters: ["plan"] },
        activation_rate: { ...measure("Activation rate", "ratio"), ignores_filters: ["plan"] },
        new_paying_customers: measure("New paying customers", "count"),
        revenue: measure("Revenue", "currency", "Paid invoices net of refunds."),
        revenue_usd_native: measure("Revenue (USD invoices)", "currency"),
        revenue_try_native: measure("Revenue (TRY invoices)", "currency"),
        mrr: measure("MRR", "currency"),
        mrr_usd_native: measure("MRR (USD)", "currency"),
        mrr_try_native: measure("MRR (TRY)", "currency"),
        active_subscriptions: measure("Active subscriptions", "count"),
        trial_starts: measure("Trial starts", "count"),
        trial_resolved: measure("Trials resolved", "count"),
        trial_conversions: measure("Trial conversions", "count"),
        trial_to_paid_rate: measure("Trial → paid rate", "ratio"),
        ai_cost: { ...measure("AI cost", "currency"), ignores_filters: ["plan"] },
        ai_runs: { ...measure("AI runs", "count"), ignores_filters: ["plan"] },
        unpriced_ai_runs: { ...measure("Unpriced AI runs", "count"), ignores_filters: ["plan"] },
      },
    },
  },
  {
    name: "signups",
    kind: "metric",
    meta: { title: "Signups", definition: "New accounts.", unit: "count", shape: "timeseries", breakdowns: ["locale", "market"], filters: ["locale", "market"], measures: { signups: measure("Signups", "count") } },
  },
  {
    name: "revenue",
    kind: "metric",
    meta: {
      title: "Revenue",
      definition: "Invoice revenue.",
      unit: "currency",
      shape: "timeseries",
      breakdowns: ["market", "plan"],
      filters: ["market", "plan"],
      measures: { revenue: measure("Revenue", "currency"), refunded: measure("Refunded", "currency"), invoices: measure("Invoices", "count") },
    },
  },
  {
    name: "ai_cost",
    kind: "metric",
    meta: {
      title: "AI cost",
      definition: "Cost of AI runs.",
      unit: "currency",
      shape: "timeseries",
      breakdowns: ["ai_flow", "ai_model", "ai_provider"],
      filters: ["ai_flow", "ai_model", "ai_provider"],
      measures: {
        cost: measure("Cost", "currency"),
        runs: measure("Runs", "count"),
        unpriced_runs: measure("Unpriced runs", "count"),
        exact_share: measure("Exact cost share", "percent"),
      },
    },
  },
];

const FROM = "2026-10-01";
const TO = "2026-10-20";
const DAYS = Array.from({ length: 20 }, (_, i) => addDays(FROM, i));

function kpiRow(current: boolean, currency: string) {
  const native = currency === "native";
  return {
    signups: current ? 120 : 100,
    activated_users: current ? 48 : 40,
    activation_eligible: 90,
    activated_eligible: current ? 36 : 27,
    activation_rate: current ? 0.4 : 0.3,
    new_paying_customers: 7,
    revenue: native ? null : current ? 1234.5 : 1000,
    revenue_usd_native: current ? 800 : 700,
    revenue_try_native: current ? 15000 : 12000,
    mrr: native ? null : 500,
    mrr_usd_native: 300,
    mrr_try_native: 6000,
    active_subscriptions: 30,
    trial_starts: current ? 5 : 4,
    trial_resolved: current ? 3 : 4,
    trial_conversions: 1,
    trial_to_paid_rate: current ? 1 / 3 : 0.25,
    ai_cost: 42,
    ai_runs: 900,
    unpriced_ai_runs: current ? 4 : 0,
    revenue_fx_provisional: !native,
    mrr_fx_provisional: false,
    ai_cost_fx_provisional: currency === "try",
  };
}

function rowsFor(name: string, query: URLSearchParams) {
  const breakdown = query.get("breakdown");
  const currency = query.get("currency");
  switch (name) {
    case "kpi_overview":
      return [kpiRow(query.get("from") === FROM, currency ?? "usd")];
    case "signups":
      return breakdown === "market"
        ? DAYS.flatMap((bucket, i) => [
            { bucket, dimension: "TR", signups: 5 },
            ...(i < 2 ? [{ bucket, dimension: "US", signups: 1 }] : []),
          ])
        : DAYS.map((bucket) => ({ bucket, dimension: null, signups: 6 }));
    case "revenue":
      return currency === "native"
        ? DAYS.flatMap((bucket) => [
            { bucket, dimension: "USD", revenue: 40, refunded: 0, invoices: 2, fx_provisional: false },
            { bucket, dimension: "TRY", revenue: 750, refunded: 0, invoices: 3, fx_provisional: false },
          ])
        : DAYS.map((bucket) => ({ bucket, dimension: breakdown ? "TR" : null, revenue: 60, refunded: 0, invoices: 4, fx_provisional: true }));
    case "ai_cost":
      return DAYS.map((bucket, i) => ({
        bucket,
        dimension: null,
        cost: i === 3 ? null : 2,
        runs: 45,
        unpriced_runs: 1,
        exact_share: 0.5,
        fx_provisional: currency === "try" && i === 0,
      }));
    default:
      return [];
  }
}

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/admin/catalog")) return ok({ metrics: CATALOG });
    const name = url.pathname.split("/").pop()!;
    return ok({ metric: name, rows: rowsFor(name, url.searchParams), generated_at: "2026-10-28T09:00:00Z" });
  });
});

const renderOverview = (search: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/?from=${FROM}&to=${TO}&${search}`]}>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = async (title: string) => (await screen.findByRole("heading", { name: title })).closest("section")!;
const tile = (label: string) => screen.getAllByText(label, { selector: "span" })[0].closest("div.rounded-xl") as HTMLElement;
const requests = (name: string) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.pathname.endsWith(`/metrics/${name}`));

describe("Overview", () => {
  it("compares kpi columns window to window in a converted currency", async () => {
    renderOverview("currency=usd");
    expect(await screen.findByText("$1,234.5")).toBeTruthy();

    const revenue = tile("Revenue");
    await waitFor(() => expect(within(revenue).getByText("+23.5%")).toBeTruthy());
    expect(within(revenue).getByText("FX provisional")).toBeTruthy();
    expect(within(tile("Signups")).getByText("+20%")).toBeTruthy();

    const trial = tile("Trial → paid rate");
    expect(within(trial).getByText("33.33%")).toBeTruthy();
    expect(within(trial).getByText("+8.3 pp")).toBeTruthy();
    expect(within(trial).getByText("small sample")).toBeTruthy();
    expect(within(trial).getByText("1 of 3 resolved (5 started)")).toBeTruthy();

    // Activation compares the eligible cohort's rate, not the raw count.
    const activated = tile("Activated users");
    expect(within(activated).getByText("48")).toBeTruthy();
    expect(within(activated).getByText("+10 pp")).toBeTruthy();
    expect(within(activated).getByText("Activation rate 40% of 90 signups past 7 days")).toBeTruthy();
    expect(within(tile("MRR")).queryByText("FX provisional")).toBeNull();

    expect(within(tile("AI cost")).getByText("4 unpriced runs not included")).toBeTruthy();
    expect(within(tile("Activated users")).queryByText("small sample")).toBeNull();

    const kpiWindows = requests("kpi_overview").map((u) => `${u.searchParams.get("from")}..${u.searchParams.get("to")}`);
    expect(new Set(kpiWindows)).toEqual(new Set([`${FROM}..${TO}`, "2026-09-11..2026-09-30"]));
  });

  it("shows native USD and TRY side by side and splits the revenue chart per currency", async () => {
    renderOverview("currency=native&breakdown=market");
    const revenue = await waitFor(() => {
      const el = tile("Revenue");
      expect(within(el).getByText("$800")).toBeTruthy();
      return el;
    });
    expect(within(revenue).getByText("₺15,000")).toBeTruthy();
    expect(within(revenue).queryByText("FX provisional")).toBeNull();
    expect(within(tile("MRR")).getByText("₺6,000")).toBeTruthy();
    expect(within(tile("AI cost")).getByText("$42")).toBeTruthy();

    const chart = await card("Revenue");
    expect(await within(chart).findByRole("region", { name: "Revenue in USD" })).toBeTruthy();
    expect(within(chart).getByRole("region", { name: "Revenue in TRY" })).toBeTruthy();
    expect(within(chart).getByText("Revenue (USD)")).toBeTruthy();
    expect(within(chart).queryByRole("combobox", { name: /break down/i })).toBeNull();

    const sent = requests("revenue");
    expect(sent.length).toBeGreaterThan(0);
    for (const url of sent) {
      expect(url.searchParams.get("currency")).toBe("native");
      expect(url.searchParams.has("breakdown")).toBe(false);
    }
    // Other charts keep the page breakdown when they support it.
    expect(requests("signups").every((u) => u.searchParams.get("breakdown") === "market")).toBe(true);
  });

  it("marks data eras inside the range on the charts they affect", async () => {
    renderOverview("currency=usd");
    const revenue = await card("Revenue");
    const eras = await within(revenue).findByRole("list", { name: "Data changes in this range" });
    expect(within(eras).getByText(/Regional pricing \(TRY\)/)).toBeTruthy();
    expect(within(eras).queryByText(/Subscription history/)).toBeNull(); // 2026-10-29 is after the range

    const signups = await card("Signups");
    expect(await within(signups).findByText(/Guest upload onboarding/)).toBeTruthy();

    const aiCost = await card("AI cost");
    await within(aiCost).findByText("Cost (USD)");
    expect(within(aiCost).queryByRole("list", { name: "Data changes in this range" })).toBeNull();
    expect(within(aiCost).getByText(/Unpriced runs: 20/)).toBeTruthy();
    expect(within(aiCost).getByText(/Exact cost share: 50%/)).toBeTruthy();
  });

  it("badges breakdown series below the minimum group size", async () => {
    renderOverview("currency=usd&breakdown=market");
    const signups = await card("Signups");
    const legend = await within(signups).findByRole("list", { name: "Series" });
    const us = within(legend).getByRole("button", { name: /US/ });
    const tr = within(legend).getByRole("button", { name: /TR/ });
    expect(within(us).getByText("small sample")).toBeTruthy();
    expect(within(tr).queryByText("small sample")).toBeNull();
  });

  it("notes filters a tile or chart can't apply", async () => {
    renderOverview(`currency=usd&filters=${encodeURIComponent('{"plan":"pro"}')}`);
    await waitFor(() => expect(within(tile("Signups")).getByText("Not filtered by plan")).toBeTruthy());
    expect(within(tile("AI cost")).getByText("Not filtered by plan")).toBeTruthy();
    expect(within(tile("Revenue")).queryByText("Not filtered by plan")).toBeNull();

    const signups = await card("Signups"); // signups accepts locale and market only
    expect(within(signups).getByText("Not filtered by plan")).toBeTruthy();
    const revenue = await card("Revenue");
    expect(within(revenue).queryByText("Not filtered by plan")).toBeNull();
  });

  it("badges provisional FX on the AI cost chart in TRY and leaves null buckets empty", async () => {
    renderOverview("currency=try");
    const aiCost = await card("AI cost");
    await within(aiCost).findByText("Cost (TRY)");
    expect(within(aiCost.querySelector("header")!).getByText("FX provisional")).toBeTruthy();
    expect(within(tile("AI cost")).getByText("FX provisional")).toBeTruthy();

    fireEvent.click(within(aiCost).getByRole("button", { name: "Table" }));
    const cells = within(aiCost).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toContain("—");
    expect(cells.filter((c) => c === "₺0")).toHaveLength(0);
  });
});
