import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf } from "@/test/people";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { AlertsPage } from "./Alerts";

const measure = (label: string, unit: string, extra: Record<string, unknown> = {}) => ({ label, unit, ...extra });

const CATALOG = [
  {
    name: "kpi_health",
    kind: "metric",
    meta: {
      title: "Health KPIs",
      definition: "d",
      unit: "count",
      shape: "kpi",
      breakdowns: [],
      filters: ["market", "plan"],
      alertable: true,
      measures: {
        ai_failure_rate: measure("AI failure rate", "ratio"),
        failed_payments: measure("Failed payments", "count", { ignores_filters: ["plan"] }),
      },
    },
  },
  {
    name: "kpi_overview",
    kind: "metric",
    meta: {
      title: "Overview KPIs",
      definition: "d",
      unit: "count",
      shape: "kpi",
      breakdowns: [],
      filters: ["market", "plan"],
      alertable: true,
      measures: { ai_cost: measure("AI cost", "currency"), signups: measure("Signups", "count") },
    },
  },
  {
    name: "signups",
    kind: "metric",
    meta: { title: "Signups", definition: "d", unit: "count", shape: "timeseries", breakdowns: [], filters: [], measures: { signups: measure("Signups", "count") } },
  },
];

type Json = Record<string, unknown>;
let rules: Json[];
let events: Json[];
let failNext: string | null;
/** When set, the next matching request waits for `release()` so the optimistic state can be observed. */
let hold: { prefix: string; release: () => void; gate: Promise<void> } | null;
const holdNext = (prefix: string) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  hold = { prefix, release, gate };
  return () => release();
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code: "VALIDATION_ERROR", message } }), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  failNext = null;
  hold = null;
  rules = [
    {
      id: "r1",
      name: "AI cost spike",
      metric: "kpi_overview",
      measure: "ai_cost",
      params: { currency: "usd", include_internal: false, filters: { market: "TR" } },
      window: "1d",
      condition: "gt",
      threshold: 100,
      cooldown_hours: 24,
      enabled: true,
    },
    {
      id: "r2",
      name: "AI failures up",
      metric: "kpi_health",
      measure: "ai_failure_rate",
      params: {},
      window: "7d",
      condition: "pct_change_gt",
      threshold: 0.5,
      cooldown_hours: 12,
      enabled: false,
    },
  ];
  events = [
    {
      id: 11,
      rule_id: "r1",
      rule_name: "AI cost spike",
      metric: "kpi_overview",
      fired_at: "2026-10-28T08:00:00Z",
      window_from: "2026-10-27",
      window_to: "2026-10-27",
      value: 150,
      baseline: null,
      message: "AI cost 150 above 100",
      acknowledged_by: null,
      acknowledged_at: null,
    },
    {
      id: 10,
      rule_id: "r2",
      rule_name: "AI failures up",
      metric: "kpi_health",
      fired_at: "2026-10-20T08:00:00Z",
      window_from: "2026-10-13",
      window_to: "2026-10-19",
      value: 0.09,
      baseline: 0.06,
      message: "AI failure rate up 50%",
      acknowledged_by: "ops@example.com",
      acknowledged_at: "2026-10-20T09:00:00Z",
    },
  ];
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/api/v1", "");
    if (hold && path.startsWith(hold.prefix)) {
      const { gate } = hold;
      hold = null;
      await gate;
    }
    if (failNext && path.startsWith(failNext)) {
      failNext = null;
      return fail(400, "Threshold is out of range");
    }
    if (path === "/admin/catalog") return json({ metrics: CATALOG });
    if (path === "/admin/alerts/rules" && method === "GET") return json(rules);
    if (path === "/admin/alerts/rules" && method === "POST") {
      const rule = { id: "r3", ...bodyOf(init) };
      rules = [...rules, rule];
      return json(rule, 201);
    }
    const ruleMatch = /^\/admin\/alerts\/rules\/(\w+)$/.exec(path);
    if (ruleMatch && method === "PATCH") {
      rules = rules.map((r) => (r.id === ruleMatch[1] ? { ...r, ...bodyOf(init) } : r));
      return json(rules.find((r) => r.id === ruleMatch[1]));
    }
    if (ruleMatch && method === "DELETE") {
      rules = rules.filter((r) => r.id !== ruleMatch[1]);
      events = events.filter((e) => e.rule_id !== ruleMatch[1]);
      return new Response(null, { status: 204 });
    }
    if (path === "/admin/alerts/events") {
      const open = url.searchParams.get("status") === "open";
      return json(open ? events.filter((e) => !e.acknowledged_at) : events);
    }
    const ackMatch = /^\/admin\/alerts\/events\/(\w+)\/ack$/.exec(path);
    if (ackMatch) {
      events = events.map((e) =>
        String(e.id) === ackMatch[1] ? { ...e, acknowledged_by: "me@example.com", acknowledged_at: "2026-10-28T10:00:00Z" } : e,
      );
      return json(events.find((e) => String(e.id) === ackMatch[1]));
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/alerts"]}>
        <AlertsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const calls = (method: string, prefix: string) =>
  fetchMock.mock.calls.filter(
    ([input, init]) => (init?.method ?? "GET") === method && new URL(String(input)).pathname.replace("/api/v1", "").startsWith(prefix),
  );

const rulesList = async () => (await screen.findByRole("heading", { name: "Rules" })).closest("section")!;
const ruleItem = async (name: string) => (await within(await rulesList()).findByText(name)).closest("li")!;

describe("Alerts page", () => {
  it("lists rules with metric · measure, window, condition in the measure's unit and cooldown", async () => {
    renderPage();
    const cost = await ruleItem("AI cost spike");
    expect(within(cost).getByText("Overview KPIs · AI cost")).toBeTruthy();
    expect(within(cost).getByText("Yesterday · Above $100 · cooldown 24 h · USD")).toBeTruthy();
    expect(within(cost).getByText("Market: TR")).toBeTruthy();
    expect(within(cost).getByRole("switch", { name: "Enable AI cost spike" }).getAttribute("aria-checked")).toBe("true");

    const failures = await ruleItem("AI failures up");
    expect(within(failures).getByText("Last 7 complete days · Change vs previous window above +50% · cooldown 12 h")).toBeTruthy();
    expect(within(failures).getByText("Disabled")).toBeTruthy();
  });

  it("shows open events with value vs threshold, and all events with baselines and who acknowledged", async () => {
    renderPage();
    const fired = (await screen.findByRole("heading", { name: "Fired alerts" })).closest("section")!;
    const open = await within(fired).findByText("AI cost spike");
    const item = open.closest("li")!;
    expect(within(item).getByText("$150")).toBeTruthy();
    expect(within(item).getByText(/rule: Above \$100/)).toBeTruthy();
    expect(within(item).getByText("AI cost 150 above 100")).toBeTruthy();
    expect(within(item).getByText(/window Oct 27, 2026/)).toBeTruthy();
    expect(within(fired).queryByText("AI failures up")).toBeNull();

    fireEvent.click(within(fired).getByRole("tab", { name: "All" }));
    const old = (await within(fired).findByText("AI failures up")).closest("li")!;
    expect(within(old).getByText("9%")).toBeTruthy();
    expect(within(old).getByText(/vs previous window 6% \(\+50%\)/)).toBeTruthy();
    expect(within(old).getByText(/Acknowledged by ops@example.com/)).toBeTruthy();
    expect(new URL(String(calls("GET", "/admin/alerts/events").at(-1)![0])).searchParams.get("limit")).toBe("50");
  });

  it("acknowledges optimistically and rolls back when the request fails", async () => {
    renderPage();
    const fired = (await screen.findByRole("heading", { name: "Fired alerts" })).closest("section")!;
    await within(fired).findByText("AI cost spike");

    failNext = "/admin/alerts/events/11/ack";
    fireEvent.click(within(fired).getByRole("button", { name: /Acknowledge/ }));
    expect(await within(fired).findByText(/Could not acknowledge: Threshold is out of range/)).toBeTruthy();
    expect(within(fired).getByText("AI cost spike")).toBeTruthy();

    const release = holdNext("/admin/alerts/events/11/ack");
    fireEvent.click(within(fired).getByRole("button", { name: /Acknowledge/ }));
    // Gone from the open list before the server answers.
    await waitFor(() => expect(within(fired).queryByText("AI cost spike")).toBeNull());
    expect(within(fired).getByText("No open alerts.")).toBeTruthy();
    release();
    expect(calls("POST", "/admin/alerts/events/11/ack")).toHaveLength(2);
  });

  it("toggles a rule optimistically and restores it when the PATCH fails", async () => {
    renderPage();
    const item = await ruleItem("AI cost spike");
    const toggle = within(item).getByRole("switch", { name: "Enable AI cost spike" });

    failNext = "/admin/alerts/rules/r1";
    const release = holdNext("/admin/alerts/rules/r1");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false")); // flipped before the response
    release();
    await waitFor(() => expect(within(item).getByRole("alert").textContent).toMatch(/Could not disable/));
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(toggle);
    await waitFor(() => expect(within(item).getByText("Disabled")).toBeTruthy());
    const [, init] = calls("PATCH", "/admin/alerts/rules/r1").at(-1)!;
    expect(bodyOf(init)).toEqual({ enabled: false });
  });

  it("creates a rule from alertable metrics only, converting percentages and keeping allowed filters", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
    const form = screen.getByRole("form", { name: "New alert rule" });

    const metric = within(form).getByLabelText("Metric") as HTMLSelectElement;
    await waitFor(() => expect([...metric.options].map((o) => o.textContent)).toEqual(["Health KPIs", "Overview KPIs"]));
    const measureSelect = within(form).getByLabelText("Measure") as HTMLSelectElement;
    expect([...measureSelect.options].map((o) => o.value)).toEqual(["ai_failure_rate", "failed_payments"]);
    // A measure that ignores a filter says so.
    fireEvent.change(measureSelect, { target: { value: "failed_payments" } });
    fireEvent.change(within(form).getByLabelText("Plan"), { target: { value: "pro, team" } });
    expect(within(form).getByText(/Not filtered by plan: this measure ignores that filter/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Plan"), { target: { value: "" } });

    fireEvent.change(measureSelect, { target: { value: "ai_failure_rate" } });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Failure rate high" } });
    fireEvent.change(within(form).getByLabelText("Window"), { target: { value: "today" } });
    fireEvent.change(within(form).getByLabelText("Threshold"), { target: { value: "7.5" } });
    expect(within(form).getByText("%")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Market"), { target: { value: "TR, US" } });
    fireEvent.change(within(form).getByLabelText("Cooldown (hours)"), { target: { value: "6" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(calls("POST", "/admin/alerts/rules")).toHaveLength(1));
    expect(bodyOf(calls("POST", "/admin/alerts/rules")[0][1])).toEqual({
      name: "Failure rate high",
      metric: "kpi_health",
      measure: "ai_failure_rate",
      window: "today",
      condition: "gt",
      threshold: 0.075,
      cooldown_hours: 6,
      enabled: true,
      params: { include_internal: false, filters: { market: ["TR", "US"] } },
    });
    expect(await within(await rulesList()).findByText("Failure rate high")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("validates locally, shows server errors and edits with the stored values", async () => {
    renderPage();
    fireEvent.click(within(await ruleItem("AI cost spike")).getByRole("button", { name: "Edit AI cost spike" }));
    const form = screen.getByRole("form", { name: "Edit “AI cost spike”" });
    expect((within(form).getByLabelText("Threshold") as HTMLInputElement).value).toBe("100");
    expect((within(form).getByLabelText("Market") as HTMLInputElement).value).toBe("TR");
    expect((within(form).getByLabelText("Currency") as HTMLSelectElement).value).toBe("usd");
    expect(within(form).getByText("$")).toBeTruthy();

    fireEvent.change(within(form).getByLabelText("Threshold"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByRole("alert").textContent).toMatch(/numeric threshold/);
    expect(calls("PATCH", "/admin/alerts/rules")).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText("Threshold"), { target: { value: "250" } });
    fireEvent.change(within(form).getByLabelText("Condition"), { target: { value: "pct_change_gt" } });
    failNext = "/admin/alerts/rules/r1";
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(await within(form).findByText("Threshold is out of range")).toBeTruthy();

    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    const body = bodyOf(calls("PATCH", "/admin/alerts/rules/r1").at(-1)![1]);
    expect(body).toMatchObject({ condition: "pct_change_gt", threshold: 2.5, params: { currency: "usd", filters: { market: "TR" } } });
  });

  it("deletes a rule only after confirming", async () => {
    renderPage();
    const item = await ruleItem("AI failures up");
    fireEvent.click(within(item).getByRole("button", { name: "Delete AI failures up" }));
    const confirm = within(item).getByRole("group", { name: "Delete AI failures up" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(calls("DELETE", "/admin/alerts/rules")).toHaveLength(0);

    fireEvent.click(within(item).getByRole("button", { name: "Delete AI failures up" }));
    fireEvent.click(within(within(item).getByRole("group")).getByRole("button", { name: /Delete/ }));
    await waitFor(() => expect(within(screen.getByRole("heading", { name: "Rules" }).closest("section")!).queryByText("AI failures up")).toBeNull());
    expect(calls("DELETE", "/admin/alerts/rules/r2")).toHaveLength(1);
  });
});
