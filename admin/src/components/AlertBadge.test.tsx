import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { AlertBadge } from "./AlertBadge";

let openCount = 0;

beforeEach(() => {
  openCount = 2;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ success: true, data: { open_count: openCount, latest_fired_at: "2026-10-28T08:00:00Z" } })),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

const renderBadge = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/monetization?grain=week"]}>
        <AlertBadge />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("AlertBadge", () => {
  it("shows the open count, links to /alerts with the page filters and refreshes every minute while visible", async () => {
    renderBadge();
    const link = await screen.findByRole("link", { name: "Alerts: 2 open" });
    expect(link.getAttribute("href")).toBe("/alerts?grain=week");
    expect(link.textContent).toBe("2");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    openCount = 0;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("link", { name: "Alerts: 0 open" })).toBeTruthy();
    expect(screen.getByRole("link").textContent).toBe("");

    // Hidden tab: no polling.
    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
