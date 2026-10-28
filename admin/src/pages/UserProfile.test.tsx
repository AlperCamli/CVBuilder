import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, page, peopleCalls, renderAt } from "@/test/people";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { UserProfilePage } from "./UserProfile";

const USER = "3f2b6c1e-8a4d-4f7e-9b2a-1c3d5e7f9a0b";
const RESTRICTED = "9a8b7c6d-1111-4222-8333-944455556666";
const GONE = "00000000-0000-4000-8000-000000000000";

const SUMMARY = {
  user_id: USER,
  email: "ali@example.com",
  created_at: "2026-09-14T08:00:00Z",
  locale: "tr",
  market: "TR",
  is_internal: false,
  analytics_consent: true,
  ai_consent: false,
  plan_code: "pro",
  subscription_status: "active",
  trial_ends_at: null,
  current_period_end: "2026-11-14T08:00:00Z",
  cancel_at_period_end: true,
  usage: { tailored_cvs: { used: 10, limit: 10 }, cover_letters: { used: 2, limit: 20 }, ai_suggestions: { used: 7, limit: null } },
  entitlement_denials: 3,
  invoices: 2,
  paid_usd_native: 0,
  paid_try_native: 1499.98,
  last_activity_at: "2026-10-27T18:30:00Z",
  restricted: false,
};

const event = (occurred_at: string, event_type: string, extra: Record<string, unknown> = {}) => ({
  occurred_at,
  event_type,
  entity: event_type,
  entity_id: "aaaaaaaa-0000-4000-8000-000000000001",
  status: "succeeded",
  is_failure: false,
  duration_ms: 1200,
  detail: { model: "gpt-x", tokens: 900 },
  error_code: null,
  error_message: null,
  ...extra,
});

const PAGE_1 = [
  event("2026-10-27T18:30:00Z", "ai_run"),
  event("2026-10-27T09:00:00Z", "export", {
    status: "failed",
    is_failure: true,
    error_code: "PDF_TIMEOUT",
    error_message: "<b>Renderer</b> timed out",
    detail: { format: "pdf", note: "<script>alert(1)</script>" },
  }),
];
const PAGE_2 = [event("2026-10-20T12:00:00Z", "signup", { duration_ms: null, detail: {} })];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const name = url.pathname.split("/").pop()!;
    const body = bodyOf(init);
    const id = body.user_id;
    if (name === "user_summary") {
      if (id === RESTRICTED) return page(name, [{ ...Object.fromEntries(Object.keys(SUMMARY).map((k) => [k, null])), user_id: id, restricted: true }]);
      return page(name, id === USER ? [SUMMARY] : []);
    }
    if (name === "user_timeline") {
      return body.cursor === "c1" ? page(name, PAGE_2) : page(name, PAGE_1, "c1");
    }
    return page(name, []);
  });
});

const renderProfile = (id: string) =>
  renderAt(`/users/${id}`, [
    { path: "/users/:id", element: <UserProfilePage /> },
    { path: "/users", element: <p>search</p> },
  ]);

describe("User profile", () => {
  it("shows a restricted marker and never loads the timeline", async () => {
    renderProfile(RESTRICTED);
    expect(await screen.findByText("Processing restricted")).toBeTruthy();
    expect(screen.queryByText("ali@example.com")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    expect(peopleCalls(fetchMock, "user_timeline")).toHaveLength(0);
  });

  it("explains unknown and pending-deletion users", async () => {
    renderProfile(GONE);
    expect(await screen.findByText("User not found or pending deletion")).toBeTruthy();
    expect(peopleCalls(fetchMock, "user_timeline")).toHaveLength(0);
  });

  it("does not call the API for a malformed id", async () => {
    renderProfile("not-a-uuid");
    expect(screen.getByText("Not a valid user ID")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders the account summary with usage meters", async () => {
    renderProfile(USER);
    const summary = (await screen.findByRole("heading", { name: "ali@example.com" })).closest("section")!;
    expect(within(summary).getByText("Analytics: yes")).toBeTruthy();
    expect(within(summary).getByText("AI: no")).toBeTruthy();
    expect(within(summary).getByText("Cancels at period end")).toBeTruthy();
    expect(within(summary).getByText("$0 · ₺1,499.98")).toBeTruthy();
    expect(within(summary).getByText("3")).toBeTruthy();

    const meters = within(summary).getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual(["Tailored cvs", "Cover letters"]);
    expect(meters[0].getAttribute("aria-valuetext")).toBe("10 of 10, limit reached");
    expect(within(summary).getByText("/ no limit")).toBeTruthy();
    expect(peopleCalls(fetchMock, "user_summary")[0].body.user_id).toBe(USER);
  });

  it("pages the timeline, highlights failures and filters failures client-side", async () => {
    renderProfile(USER);
    const timeline = (await screen.findByRole("heading", { name: "Timeline" })).closest("section")!;
    await within(timeline).findByText("AI run");

    const failed = within(timeline).getByText("PDF_TIMEOUT").closest("li")!;
    expect(failed.getAttribute("data-failure")).toBe("true");
    // Error text and metadata render as text, never as markup.
    expect(within(failed).getByText("<b>Renderer</b> timed out")).toBeTruthy();
    fireEvent.click(within(failed).getByRole("button", { name: "Details" }));
    expect(within(failed).getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();

    expect(within(timeline).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Tue, Oct 27, 2026"]);

    fireEvent.click(within(timeline).getByRole("button", { name: "Load more" }));
    expect(await within(timeline).findByText("Signup")).toBeTruthy();
    expect(within(timeline).queryByRole("button", { name: "Load more" })).toBeNull();
    expect(within(timeline).getByText(/end of list/)).toBeTruthy();
    expect(peopleCalls(fetchMock, "user_timeline").map((c) => c.body.cursor ?? null)).toEqual([null, "c1"]);

    fireEvent.click(within(timeline).getByRole("checkbox", { name: "Failures only" }));
    expect(within(timeline).queryByText("AI run")).toBeNull();
    expect(within(timeline).queryByText("Signup")).toBeNull();
    expect(within(timeline).getByText("PDF_TIMEOUT")).toBeTruthy();
    expect(within(timeline).getByText(/1 failed of 3 loaded events/)).toBeTruthy();
    // Failures-only is a view of loaded rows: no new request.
    expect(peopleCalls(fetchMock, "user_timeline")).toHaveLength(2);
  });

  it("sends event types and dates to the server", async () => {
    renderProfile(USER);
    const timeline = (await screen.findByRole("heading", { name: "Timeline" })).closest("section")!;
    await within(timeline).findByText("AI run");

    fireEvent.click(within(timeline).getByRole("button", { name: "Event types" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Export" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "AI run" }));
    fireEvent.change(within(timeline).getByLabelText("Timeline from (UTC)"), { target: { value: "2026-10-01" } });

    await waitFor(() => {
      const last = peopleCalls(fetchMock, "user_timeline").at(-1)!;
      expect(last.body.filters).toEqual({ event_type: ["ai_run", "export"] });
      expect(last.body.from).toBe("2026-10-01");
      expect("cursor" in last.body).toBe(false);
    });
  });
});
