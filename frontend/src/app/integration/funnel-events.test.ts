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

  it("counts the landing and pricing views once per page load", async () => {
    const { trackPageViewOnce } = await import("./funnel-events");
    trackPageViewOnce("landing_view");
    // The remembered-locale redirect renders the landing page again under /tr.
    location.pathname = "/tr";
    trackPageViewOnce("landing_view");
    // A real move to pricing still counts, once, also across its own locale redirect.
    location.pathname = "/tr/pricing";
    trackPageViewOnce("pricing_view");
    location.pathname = "/pricing";
    trackPageViewOnce("pricing_view");
    trackPageViewOnce("landing_view");
    expect(beacon).toHaveBeenCalledTimes(2);
    expect([(await sent(0)).event, (await sent(1)).event]).toEqual(["landing_view", "pricing_view"]);
  });
});
