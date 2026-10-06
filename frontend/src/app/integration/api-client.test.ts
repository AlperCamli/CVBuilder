import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";

afterEach(() => vi.unstubAllGlobals());
describe("API request URLs", () => {
  it("resolves the production /api/v1 base against the deployed frontend origin", async () => {
    vi.stubGlobal("window", { location: { origin: "https://cv.example.com" } });
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ success: true, data: { status: "parsed" } }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiClient({
      baseUrl: "/api/v1",
      getAccessToken: async () => null,
    });
    expect(
      await client.get("/guest-imports/example", { query: { value: "a b" } }),
    ).toEqual({ status: "parsed" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://cv.example.com/api/v1/guest-imports/example?value=a+b",
    );
  });
  it("preserves absolute backend URLs used in development", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true, data: {} }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiClient({
      baseUrl: "http://localhost:4000/api/v1",
      getAccessToken: async () => null,
    });
    await client.get("/health");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:4000/api/v1/health",
    );
  });
});
