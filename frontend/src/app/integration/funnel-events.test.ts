import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let beacon: ReturnType<typeof vi.fn>;
const location = { pathname: "/", search: "" };
beforeEach(() => {
  vi.resetModules();
  beacon = vi.fn(() => true);
  location.pathname = "/"; location.search = "";
  vi.stubGlobal("window", { location, navigator: { userAgent: "Mozilla/5.0 Safari" }, matchMedia: () => ({ matches: true }) });
  vi.stubGlobal("navigator", { sendBeacon: beacon });
  vi.stubGlobal("document", { documentElement: { lang: "en" } });
});
afterEach(() => vi.unstubAllGlobals());

const sent = async (index: number) => JSON.parse(await (beacon.mock.calls[index][1] as Blob).text());

describe("anonymous funnel events", () => {
  it("keeps the landing campaign for later steps of the same page session", async () => {
    const { trackFunnelEvent } = await import("./funnel-events");
    location.search = "?utm_source=Instagram";
    trackFunnelEvent("landing_view");
    location.pathname = "/onboarding"; location.search = "";
    trackFunnelEvent("onboarding_upload_view");
    expect(await sent(0)).toEqual({ event: "landing_view", locale: "en", device: "mobile", utm_source: "instagram" });
    expect(await sent(1)).toMatchObject({ event: "onboarding_upload_view", utm_source: "instagram" });
    expect(beacon.mock.calls[0][0]).toMatch(/\/funnel-events$/);
  });

  it("drops invalid details and campaigns and skips bots", async () => {
    const { trackFunnelEvent } = await import("./funnel-events");
    location.pathname = "/tr"; location.search = "?utm_source=https://evil.example";
    trackFunnelEvent("cta_click", "Free text");
    expect(await sent(0)).toEqual({ event: "cta_click", locale: "tr", device: "mobile" });
    (window as unknown as { navigator: { userAgent: string } }).navigator.userAgent = "Googlebot/2.1";
    trackFunnelEvent("landing_view");
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});
