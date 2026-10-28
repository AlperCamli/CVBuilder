import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, page, peopleCalls, renderAt } from "@/test/people";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { UsersPage } from "./Users";

const USER = "3f2b6c1e-8a4d-4f7e-9b2a-1c3d5e7f9a0b";
const RESTRICTED = "9a8b7c6d-1111-4222-8333-944455556666";

const ROWS = [
  {
    user_id: USER,
    email: "ali@example.com",
    created_at: "2026-09-14T08:00:00Z",
    market: "TR",
    plan_code: "pro",
    subscription_status: "active",
    analytics_consent: true,
    is_internal: true,
    restricted: false,
  },
  {
    user_id: RESTRICTED,
    email: null,
    created_at: null,
    market: null,
    plan_code: null,
    subscription_status: null,
    analytics_consent: null,
    is_internal: null,
    restricted: true,
  },
];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_input, init) => {
    const q = bodyOf(init).q;
    return page("search_users", q === "nobody" ? [] : ROWS);
  });
});

function Profile() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      back
    </button>
  );
}

const renderUsers = (search = "") =>
  renderAt(`/users${search}`, [
    { path: "/users", element: <UsersPage /> },
    { path: "/users/:id", element: <Profile /> },
  ]);
const searchBox = () => screen.getByRole("searchbox", { name: "Find a user" });

describe("Users search", () => {
  it("waits for 3 characters before searching", async () => {
    renderUsers();
    expect(screen.getByText("Search for a user")).toBeTruthy();
    fireEvent.change(searchBox(), { target: { value: "al" } });
    expect(screen.getByText("Type at least 3 characters.")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("location").textContent).toBe("/users");
  });

  it("debounces into a POSTed search that never touches the URL, with restricted users reduced to a marker", async () => {
    renderUsers("?range=7d");
    fireEvent.change(searchBox(), { target: { value: " ali " } });
    const table = await screen.findByRole("table");
    expect(screen.getByTestId("location").textContent).toBe("/users?range=7d");
    const calls = peopleCalls(fetchMock, "search_users");
    expect(calls.map((c) => [c.method, c.body.q, c.url.search])).toEqual([["POST", "ali", ""]]);

    const [, first, second] = within(table).getAllByRole("row");
    const link = within(first).getByRole("link", { name: "ali@example.com" });
    // The profile link keeps page filters but never the search term.
    expect(link.getAttribute("href")).toBe(`/users/${USER}?range=7d`);
    expect(within(first).getAllByText("Internal").length).toBeGreaterThan(0);
    expect(within(first).getAllByText("Analytics: yes").length).toBeGreaterThan(0);
    expect(within(first).getAllByText("Pro").length).toBeGreaterThan(0);

    expect(second.getAttribute("data-restricted")).toBe("true");
    expect(within(second).queryByRole("link")).toBeNull();
    expect(within(second).getByText("Restricted user (no data shown)")).toBeTruthy();
    expect(within(second).getByText("9a8b7c6d…")).toBeTruthy();
    expect(within(second).queryByText(RESTRICTED)).toBeNull();
    expect(within(second).getAllByText(/Restricted — no data shown/).length).toBeGreaterThan(0);
    expect(within(second).queryByText(/Analytics/)).toBeNull();
  });

  it("restores the search from history state on back, without it ever reaching the URL", async () => {
    renderUsers("?range=7d");
    fireEvent.change(searchBox(), { target: { value: "ali" } });
    fireEvent.click(await screen.findByRole("link", { name: "ali@example.com" }));
    expect(screen.getByTestId("location").textContent).toBe(`/users/${USER}?range=7d`);

    fireEvent.click(screen.getByRole("button", { name: "back" }));
    await waitFor(() => expect((searchBox() as HTMLInputElement).value).toBe("ali"));
    expect(await screen.findByRole("link", { name: "ali@example.com" })).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/users?range=7d");
  });

  it("scrubs a legacy ?q= from the address bar but keeps the search", async () => {
    renderUsers("?q=nobody&range=7d");
    expect((searchBox() as HTMLInputElement).value).toBe("nobody");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/users?range=7d"));
    expect(await screen.findByText("No matching users")).toBeTruthy();
    expect(peopleCalls(fetchMock, "search_users").map((c) => c.body.q)).toEqual(["nobody"]);
  });

  it("recognises a full user id", async () => {
    renderUsers();
    fireEvent.change(searchBox(), { target: { value: USER } });
    expect(screen.getByText("Looking up this exact user ID.")).toBeTruthy();
    await waitFor(() => expect(peopleCalls(fetchMock, "search_users")[0]?.body.q).toBe(USER));
  });
});
