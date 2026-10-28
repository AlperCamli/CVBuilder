import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
vi.mock("@/lib/supabase", () => ({ getAccessToken: async () => "token" }));

import { anomalyParams } from "./anomalies";
import { CATALOG_KEY } from "./api";
import { freshnessNote, freshnessSummary, freshnessValue } from "./health";
import { dataAsOf, invalidatePrecomputed, isOpen, recomputeStatusSchema, requestRecompute } from "./recompute";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("requestRecompute", () => {
  it("returns the queued run on 202 and POSTs", async () => {
    fetchMock.mockResolvedValue(json({ success: true, data: { status: "queued", run_id: 42 } }, 202));
    await expect(requestRecompute()).resolves.toEqual({ status: "queued", run_id: "42" });
    const [input, init] = fetchMock.mock.calls[0];
    expect(new URL(String(input)).pathname).toBe("/api/v1/admin/recompute");
    expect(init?.method).toBe("POST");
  });

  it("reads the throttle from a 429 in either envelope, or from Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, data: { status: "throttled", run_id: null, retry_after_seconds: 181.2 } }, 429));
    await expect(requestRecompute()).resolves.toEqual({ status: "throttled", run_id: null, retry_after_seconds: 182 });

    fetchMock.mockResolvedValueOnce(
      json({ success: false, error: { code: "RECOMPUTE_THROTTLED", message: "Too soon", details: { retry_after_seconds: 60, run_id: 9 } } }, 429),
    );
    await expect(requestRecompute()).resolves.toEqual({ status: "throttled", run_id: "9", retry_after_seconds: 60 });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "30" } }));
    await expect(requestRecompute()).resolves.toEqual({ status: "throttled", run_id: null, retry_after_seconds: 30 });
  });

  it("throws on other errors", async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: { code: "FORBIDDEN", message: "No" } }, 403));
    await expect(requestRecompute()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("recompute status", () => {
  const status = (extra: Record<string, unknown> = {}) =>
    recomputeStatusSchema.parse({
      run_id: 5,
      kind: "recompute",
      status: "done",
      requested_at: "2026-10-28T09:00:00Z",
      finished_at: "2026-10-28T09:01:00Z",
      duration_seconds: "12.5",
      open_run_id: null,
      retry_after_seconds: 0,
      as_of: "2026-10-28T09:00:40Z",
      ...extra,
    });

  it("parses one row, an array of one row or nothing", () => {
    expect(status().duration_seconds).toBe(12.5);
    expect(recomputeStatusSchema.parse([{ run_id: 1, status: "pending" }]).status).toBe("pending");
    const empty = recomputeStatusSchema.parse(null);
    expect(empty.run_id).toBeNull();
    expect(empty.history).toEqual([]);
  });

  it("is open while a run waits or another request is queued", () => {
    expect(isOpen(status())).toBe(false);
    expect(isOpen(status({ status: "pending", finished_at: null }))).toBe(true);
    expect(isOpen(status({ open_run_id: 6 }))).toBe(true);
    expect(isOpen(undefined)).toBe(false);
  });

  it("dates pre-computed data by the view build, else the latest successful run", () => {
    expect(dataAsOf(status())).toBe("2026-10-28T09:00:40Z");
    expect(dataAsOf(status({ as_of: null }))).toBe("2026-10-28T09:01:00Z");
    expect(dataAsOf(status({ as_of: null, status: "failed" }))).toBeNull();
    expect(
      dataAsOf(status({ as_of: null, status: "pending", finished_at: null, history: [{ status: "done", finished_at: "2026-10-27T03:46:00Z" }] })),
    ).toBe("2026-10-27T03:46:00Z");
  });

  it("invalidates only pre-computed metrics and data_freshness", async () => {
    const client = new QueryClient();
    client.setQueryData(CATALOG_KEY, {
      metrics: [
        { name: "cohort_retention", kind: "metric", meta: { title: "C", precomputed: true } },
        { name: "signups", kind: "metric", meta: { title: "S" } },
      ],
    });
    for (const key of ["cohort_retention", "signups", "data_freshness", "alerts/rules"]) client.setQueryData([key, {}], 1);
    await invalidatePrecomputed(client);
    const stale = client
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => q.queryKey[0]);
    expect(stale.sort()).toEqual(["cohort_retention", "data_freshness"]);
  });
});

describe("anomaly overlay params", () => {
  const host = { from: "2026-10-01", to: "2026-10-28", grain: "day" as const, currency: "usd" as const, include_internal: false };
  it("drops the breakdown and keeps filters the anomaly metric accepts", () => {
    expect(anomalyParams({ ...host, breakdown: "ai_flow", filters: { ai_model: "x" } }, ["ai_flow", "ai_model"])).toEqual({ ...host, filters: { ai_model: "x" } });
    expect(anomalyParams({ ...host, filters: { plan: "pro" } }, ["ai_flow"])).toBeNull();
  });
});

describe("data freshness formatting", () => {
  it("formats each check's value by its meaning", () => {
    expect(freshnessValue({ item: "nightly_refresh", value: 12.5, value_text: "done" })).toBe("done · 12.5 s");
    expect(freshnessValue({ item: "last_recompute", value: null, value_text: "never ran" })).toBe("never ran");
    expect(freshnessValue({ item: "precomputed_as_of", value: 3.25, value_text: "hours old" })).toBe("3.25 hours old");
    expect(freshnessValue({ item: "fx_latest_month", value: 41.2, value_text: "2026-10 month-to-date" })).toBe(
      "2026-10 month-to-date · 41.2 TRY per USD",
    );
    expect(freshnessValue({ item: "scheduler", value: 2, value_text: "analytics_nightly, analytics_recompute_queue" })).toBe(
      "analytics_nightly, analytics_recompute_queue",
    );
    expect(freshnessValue({ item: "pending_recompute", value: 0, value_text: "none" })).toBe("none");
    expect(freshnessValue({ item: "pending_recompute", value: 1, value_text: "queued" })).toBe("1 queued");
    expect(freshnessValue({ item: "unpriced_ai_runs_30d", value: 4, value_text: "runs" })).toBe("4 runs");
  });

  it("notes errors and unpriced models, and counts what needs attention", () => {
    expect(freshnessNote({ detail: { error: "boom", run_id: 1 } })).toBe("boom");
    expect(freshnessNote({ detail: { models: { "gpt-x": 1, "claude-y": 3 } } })).toBe("claude-y: 3, gpt-x: 1");
    expect(freshnessNote({ detail: { jobs: [] } })).toBeNull();
    expect(freshnessSummary([{ status: "ok" }, { status: "warn" }, { status: "error" }, { status: "error" }])).toBe("2 errors, 1 warning");
    expect(freshnessSummary([{ status: "ok" }, { status: "info" }])).toBeNull();
  });
});
