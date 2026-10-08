import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const consent = vi.hoisted(() => ({allowed: false, config: vi.fn()}));
vi.mock("./privacy", () => ({analyticsAllowed: () => consent.allowed, getPrivacyConfig: consent.config, PRIVACY_EVENT: "privacy-change", CONSENT_KEY: "consent"}));
let analytics: typeof import("./analytics");
let scripts: Map<string, any>; let gtag: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST"); vi.useFakeTimers();
  consent.allowed = false; consent.config.mockReset(); consent.config.mockResolvedValue({analytics_enabled: true});
  scripts = new Map(); gtag = vi.fn();
  const storage = {getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(), length: 0};
  vi.stubGlobal("window", {gtag, navigator: {userAgent: "test browser"}, location: {origin: "https://cv.example", hostname: "cv.example", pathname: "/", reload: vi.fn()}, localStorage: storage, sessionStorage: storage, addEventListener: vi.fn(), setInterval});
  vi.stubGlobal("document", {cookie: "", getElementById: (id: string) => scripts.get(id), createElement: () => {const script: any = {}; script.remove = () => scripts.delete(script.id); return script;}, head: {appendChild: (script: any) => scripts.set(script.id, script)}});
  analytics = await import("./analytics");
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});
const settle = async () => {await vi.advanceTimersByTimeAsync(0);};
const events = () => gtag.mock.calls.filter(call => call[0] === "event");

describe("consented analytics delivery", () => {
  it("captures the current screen after acceptance without replaying rejected actions", async () => {
    analytics.trackPageView("/guided-journey"); analytics.trackEvent("rejected_action");
    expect(consent.config).not.toHaveBeenCalled(); expect(gtag).not.toHaveBeenCalled();
    consent.allowed = true; analytics.scheduleAnalytics(); await settle();
    expect(events()).toEqual([["event", "page_view", {page_location: "https://cv.example/guided-journey", page_referrer: "", page_title: "Guided landing"}]]);
  });
  it("retains consented events during configuration loading and preserves safe funnel parameters", async () => {
    let finish!: (config: any) => void;
    consent.config.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    consent.allowed = true; analytics.trackPageView("/app/cv/private-id");
    analytics.trackEvent("onboarding_step_completed", {flow: "checklist_v1", surface: "editor", source: "/app/cv/private-id?token=private", method: "email", answer: "doctorate", email: "private@example.invalid", file_name: "private.pdf", account_id: "private", page_location: "https://unsafe.example"});
    expect(scripts.size).toBe(0); expect(consent.config).toHaveBeenCalledTimes(1);
    finish({analytics_enabled: true}); await settle();
    expect(events().map(call => call[1])).toEqual(["page_view", "onboarding_step_completed"]);
    expect(events()[1][2]).toMatchObject({flow: "checklist_v1", method: "email", source: "/app/cv/editor", page_location: "https://cv.example/app/cv/editor"});
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/private|doctorate|unsafe/);
  });
  it("tracks SPA screens once with safe URLs and excludes authentication callbacks", async () => {
    consent.allowed = true; analytics.trackPageView("/onboarding"); await settle();
    analytics.trackPageView("/onboarding"); analytics.trackPageView("/app/cv-score?import=secret");
    analytics.trackPageView("/app/cv/secret"); analytics.trackPageView("/auth/callback?code=secret"); analytics.trackEvent("callback_action");
    expect(events().filter(call => call[1] === "page_view")).toHaveLength(3);
    expect(JSON.stringify(gtag.mock.calls)).not.toContain("secret");
    expect(events().some(call => call[1] === "callback_action")).toBe(false);
  });
  it("discards pending events on withdrawal and ignores stale initialization", async () => {
    let finish!: (config: any) => void;
    consent.config.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    consent.allowed = true; analytics.trackPageView("/onboarding"); analytics.trackEvent("withdrawn_action");
    consent.allowed = false; analytics.removeAnalyticsData(); finish({analytics_enabled: true}); await settle();
    expect(scripts.size).toBe(0); expect(events()).toHaveLength(0);
    consent.allowed = true; analytics.scheduleAnalytics(); await settle();
    expect(events().map(call => call[1])).toEqual(["page_view"]);
  });
  it("does not load Google on an auth callback while an earlier config request finishes", async () => {
    let finish!: (config: any) => void;
    consent.config.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
    consent.allowed = true; analytics.trackPageView("/guided-journey");
    analytics.trackPageView("/auth/callback?code=private");
    finish({analytics_enabled: true}); await settle();
    expect(scripts.size).toBe(0); expect(events()).toHaveLength(0);
    analytics.trackPageView("/app/dashboard"); await settle();
    expect(events().map(call => call[1])).toEqual(["page_view", "page_view"]);
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/callback|private/);
  });
  it("retries a temporary configuration failure without losing consented events", async () => {
    consent.config.mockRejectedValueOnce(new Error("offline")); consent.allowed = true;
    analytics.trackPageView("/onboarding"); analytics.trackEvent("upload_started"); await settle();
    expect(scripts.size).toBe(0);
    analytics.scheduleAnalytics(); await settle();
    expect(events().map(call => call[1])).toEqual(["page_view", "upload_started"]);
  });
  it("does not initialize when the operator disabled analytics", async () => {
    consent.allowed = true; consent.config.mockResolvedValue({analytics_enabled: false});
    analytics.trackPageView("/onboarding"); await settle();
    expect(scripts.size).toBe(0); expect(events()).toHaveLength(0);
  });
});
