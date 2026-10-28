import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./supabase", () => ({ getAccessToken: vi.fn(async () => "token-123") }));

import { ApiError, apiGet, catalogSchema, measureOf, metricQuery, relabelCsv, shouldRetry, toMetricParams, type MetricMeta } from "./api";
import { parseFilters } from "./filters";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected rejection");
};

describe("apiGet", () => {
  it("sends the bearer token and unwraps the success envelope", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { email: "a@b.co", is_admin: true } }));
    const data = await apiGet("/admin/me", z.object({ email: z.string(), is_admin: z.boolean() }), { x: "1", y: undefined });
    expect(data).toEqual({ email: "a@b.co", is_admin: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/admin\/me\?x=1$/);
    expect(init?.headers).toEqual({ Authorization: "Bearer token-123" });
  });

  it("throws ApiError with the envelope's code and message", async () => {
    fetchMock.mockResolvedValueOnce(
      json(504, { success: false, error: { code: "ANALYTICS_TIMEOUT", message: "Query timed out", details: { ms: 15000 } } }),
    );
    const error = await failure(apiGet("/admin/metrics/signups", z.unknown()));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 504, code: "ANALYTICS_TIMEOUT", message: "Query timed out", details: { ms: 15000 } });
  });

  it("maps non-JSON errors, malformed bodies and network failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await failure(apiGet("/x", z.unknown()))).toMatchObject({ status: 502, code: "HTTP_ERROR" });

    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    expect(await failure(apiGet("/x", z.unknown()))).toMatchObject({ status: 200, code: "INVALID_RESPONSE" });

    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: { is_admin: "yes" } }));
    expect(await failure(apiGet("/x", z.object({ is_admin: z.boolean() })))).toMatchObject({ code: "INVALID_RESPONSE" });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await failure(apiGet("/x", z.unknown()))).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});

describe("metric params", () => {
  const meta: MetricMeta = {
    title: "Signups",
    definition: "",
    unit: "count",
    shape: "timeseries",
    breakdowns: ["locale", "market"],
    filters: ["locale", "market"],
  };
  const filters = parseFilters(
    new URLSearchParams(`breakdown=plan&include_internal=true&filters=${encodeURIComponent('{"market":"TR","plan":"pro"}')}`),
    new Date("2026-10-28T00:00:00Z"),
  );

  it("strips breakdowns and filter keys the metric does not accept", () => {
    const params = toMetricParams(filters, meta);
    expect(params.breakdown).toBeUndefined();
    expect(params.filters).toEqual({ market: "TR" });
    expect(toMetricParams({ ...filters, breakdown: "market" }, meta).breakdown).toBe("market");
  });

  it("serialises to the contract's query string", () => {
    expect(metricQuery(toMetricParams(filters, meta))).toEqual({
      from: "2026-09-29",
      to: "2026-10-28",
      grain: "day",
      currency: "usd",
      include_internal: "true",
      breakdown: undefined,
      filters: '{"market":"TR"}',
    });
    expect(metricQuery(toMetricParams({ ...filters, filters: {} })).filters).toBeUndefined();
  });
});

describe("catalog parsing", () => {
  it("drops malformed entries and defaults a missing title to the function name", () => {
    const parsed = catalogSchema.parse({
      metrics: [
        { name: "signups", kind: "metric", meta: { title: "Signups", definition: "d", unit: "count", shape: "timeseries", breakdowns: ["market", "nope"], filters: [] } },
        { name: "revenue", kind: "metric", meta: { unit: "currency", breakdowns: [], filters: [] } },
        { name: "broken", kind: "metric", meta: "not json" },
        { kind: "metric" },
        42,
      ],
    });
    expect(parsed.metrics.map((m) => [m.name, m.meta.title])).toEqual([
      ["signups", "Signups"],
      ["revenue", "revenue"],
      ["broken", "broken"],
    ]);
    expect(parsed.metrics[0].meta.breakdowns).toEqual(["market"]);
    expect(parsed.metrics[2].meta).toMatchObject({ unit: "count", breakdowns: [], filters: [] });
  });
});

describe("measures meta", () => {
  const parse = (meta: unknown) => catalogSchema.parse({ metrics: [{ name: "ai_cost", kind: "metric", meta }] }).metrics[0].meta;

  it("keeps valid measures, drops malformed ones and ignores unknown keys", () => {
    const meta = parse({
      title: "AI cost",
      unit: "currency",
      future_key: { nested: true },
      measures: {
        cost: { label: "Cost", unit: "currency", description: "USD", extra: 1 },
        runs: { label: "Runs", unit: "count" },
        exact_share: { label: "Exact share", unit: "bogus" },
        broken: { unit: "count" },
        junk: 7,
      },
    });
    expect(meta.measures).toEqual({
      cost: { label: "Cost", unit: "currency", description: "USD" },
      runs: { label: "Runs", unit: "count" },
      exact_share: { label: "Exact share", unit: undefined, description: undefined },
    });
    expect(measureOf(meta, "exact_share")).toEqual({ label: "Exact share", unit: "currency" });
    expect(measureOf(meta, "unpriced_runs")).toEqual({ label: "Unpriced runs", unit: "currency" });
  });

  it("survives a non-object measures value", () => {
    expect(parse({ title: "X", measures: "nope" }).measures).toBeUndefined();
  });
});

describe("relabelCsv", () => {
  it("relabels header columns, re-adds the BOM and leaves data rows alone", () => {
    const csv = "bucket,dimension,cost,runs\r\n2026-10-01,,1.5,3\r\n";
    expect(relabelCsv(csv, { cost: "Cost (USD)", runs: "Runs, total", bogus: "x" })).toBe(
      '\uFEFFbucket,dimension,Cost (USD),"Runs, total"\r\n2026-10-01,,1.5,3\r\n',
    );
    expect(relabelCsv("\uFEFFcost", { cost: "=Cost" })).toBe("\uFEFF'=Cost");
  });
});

describe("retry policy", () => {
  it("retries transient failures once and never 4xx, 503 or 504", () => {
    expect(shouldRetry(0, new ApiError(0, "NETWORK_ERROR", ""))).toBe(true);
    expect(shouldRetry(0, new ApiError(502, "HTTP_ERROR", ""))).toBe(true);
    expect(shouldRetry(1, new ApiError(502, "HTTP_ERROR", ""))).toBe(false);
    for (const status of [400, 401, 403, 404, 429, 503, 504]) {
      expect(shouldRetry(0, new ApiError(status, "X", ""))).toBe(false);
    }
  });
});
