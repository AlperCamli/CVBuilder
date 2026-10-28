import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bodyOf, page, peopleCalls, renderAt } from "@/test/people";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { DrillDrawer } from "./DrillDrawer";

const u = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (_input, init) =>
    bodyOf(init).cursor === "k1"
      ? page("drill_users", [{ user_id: u(3), email: "c@example.com", value: 1, detail: null }])
      : page(
          "drill_users",
          [
            { user_id: u(1), email: "a@example.com", value: 3, detail: { ai_flow: "tailoring" } },
            { user_id: u(2), email: "b@example.com", value: 2.5, detail: null },
          ],
          "k1",
        ),
  );
});

describe("DrillDrawer", () => {
  it("lists the users behind a point, pages with the cursor and links to profiles", async () => {
    const onClose = vi.fn();
    renderAt("/?range=7d", [
      {
        path: "/",
        element: (
          <DrillDrawer
            metric="ai_failures"
            title="Failed AI runs"
            filters={{ market: "TR" }}
            from="2026-10-20"
            to="2026-10-26"
            onClose={onClose}
          />
        ),
      },
    ]);
    const dialog = screen.getByRole("dialog", { name: "Users behind Failed AI runs" });
    const first = await within(dialog).findByRole("link", { name: "a@example.com" });
    expect(first.getAttribute("href")).toBe(`/users/${u(1)}?range=7d`);
    expect(within(dialog).getByText("tailoring")).toBeTruthy();
    expect(within(dialog).getByText("2.5")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    expect(await within(dialog).findByRole("link", { name: "c@example.com" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();

    const calls = peopleCalls(fetchMock, "drill_users");
    expect(calls.map((c) => c.body.cursor ?? null)).toEqual([null, "k1"]);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.body.filters).toEqual({ market: "TR", metric: "ai_failures" });
      expect(call.body.from).toBe("2026-10-20");
      expect(call.body.to).toBe("2026-10-26");
    }

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
