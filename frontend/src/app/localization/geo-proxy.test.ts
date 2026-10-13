import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { geolocation, next } from "@vercel/functions";
import proxy from "../../../proxy";

vi.mock("@vercel/functions", () => ({
  geolocation: vi.fn(() => ({ country: "TR" })),
  next: vi.fn(() => new Response(null, { status: 204 }))
}));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("frontend trusted country boundary", () => {
  const secret = "server-only-country-secret-at-least-32-characters";
  it("strips browser geo headers and binds the platform country to method, path and authorization", () => {
    vi.stubEnv("BILLING_GEO_SECRET", secret);
    proxy(new Request("https://app.example/api/v1/billing/checkout?country=US", { method: "POST", headers: { Authorization: "Bearer account", "x-cv-geo-context": "forged", "x-cv-geo-signature": "forged", "x-cv-geo-extra": "US" } }));
    const headers = vi.mocked(next).mock.calls[0][0]!.request!.headers as Headers;
    const encoded = headers.get("x-cv-geo-context")!;
    const context = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(context).toMatchObject({ country: "TR", method: "POST", path: "/api/v1/billing/checkout", authorization: createHash("sha256").update("Bearer account").digest("hex") });
    expect(context.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(headers.get("x-cv-geo-signature")).toBe(createHmac("sha256", secret).update(encoded).digest("hex"));
    expect(headers.get("x-cv-geo-extra")).toBeNull();
  });
  it("signs unknown countries as unknown instead of accepting a browser-selected country", () => {
    vi.stubEnv("BILLING_GEO_SECRET", secret);
    vi.mocked(geolocation).mockReturnValueOnce({} as ReturnType<typeof geolocation>);
    proxy(new Request("https://app.example/api/v1/billing/prices?country=TR"));
    const headers = vi.mocked(next).mock.calls[0][0]!.request!.headers as Headers;
    expect(JSON.parse(Buffer.from(headers.get("x-cv-geo-context")!, "base64url").toString("utf8")).country).toBeNull();
  });
  it("refuses pricing traffic when its signing secret is missing", () => {
    vi.stubEnv("BILLING_GEO_SECRET", "");
    const response = proxy(new Request("https://app.example/api/v1/billing/prices"));
    expect(response.status).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
