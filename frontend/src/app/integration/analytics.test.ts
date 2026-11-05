import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsPage } from "./analytics-pages";
const screenPath = (path: string) => analyticsPage(path)?.path;
const consent = vi.hoisted(() => ({allowed: false, config: vi.fn()}));
vi.mock("./privacy", () => ({analyticsAllowed: () => consent.allowed, getPrivacyConfig: consent.config, PRIVACY_EVENT: "privacy-change", CONSENT_KEY: "consent"}));
const funnel = vi.hoisted(() => vi.fn());
vi.mock("./funnel-events", () => ({trackFunnelEvent: funnel}));
let analytics: typeof import("./analytics");
let scripts: Map<string, any>; let gtag: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv("VITE_GA_MEASUREMENT_ID", "G-TEST"); vi.useFakeTimers();
  funnel.mockReset(); consent.allowed = false; consent.config.mockReset(); consent.config.mockResolvedValue({analytics_enabled: true});
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

describe("signup and CTA tracking", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");
  const google = {id: "u1", created_at: "2026-11-07T09:59:00Z", last_sign_in_at: "2026-11-07T09:59:01Z", app_metadata: {provider: "google"}};

  it("recognises only brand-new Google accounts", () => {
    expect(analytics.isNewOAuthAccount(google, "google", now)).toBe(true);
    expect(analytics.isNewOAuthAccount({...google, last_sign_in_at: "2026-11-07T09:59:58Z", created_at: "2026-10-01T08:00:00Z"}, "google", now)).toBe(false);
    expect(analytics.isNewOAuthAccount({...google, app_metadata: {provider: "email"}}, "google", now)).toBe(false);
    expect(analytics.isNewOAuthAccount(google, "google", now + 11 * 60_000)).toBe(false);
    expect(analytics.isNewOAuthAccount({id: "u2"}, "google", now)).toBe(false);
  });

  it("counts a new Google signup once and sends the GA event with the first screen after the callback", async () => {
    consent.allowed = true;
    analytics.trackPageView("/auth/callback");
    expect(analytics.trackGoogleSignupCompleted(google, now)).toBe(true);
    expect(analytics.trackGoogleSignupCompleted(google, now)).toBe(false);
    expect(analytics.trackGoogleSignupCompleted({...google, id: "u3", created_at: "2026-09-01T00:00:00Z"}, now)).toBe(false);
    expect(funnel.mock.calls).toEqual([["signup_completed", "google"]]);
    await settle(); expect(events()).toHaveLength(0);
    analytics.trackPageView("/app/onboarding"); await settle();
    expect(events().map(call => call[1])).toEqual(["page_view", "pre_signup_account_created"]);
    expect(events()[1][2]).toMatchObject({method: "google", verification_required: false, page_location: "https://cv.example/app/onboarding"});
  });

  it("does not hold a GA signup event without consent but still counts the anonymous funnel", async () => {
    analytics.trackPageView("/auth/callback");
    expect(analytics.trackGoogleSignupCompleted({...google, id: "u4"}, now)).toBe(true);
    consent.allowed = true; analytics.trackPageView("/app/onboarding"); await settle();
    expect(funnel).toHaveBeenCalledWith("signup_completed", "google");
    expect(events().map(call => call[1])).toEqual(["page_view"]);
  });

  it("reports landing CTA placements to the funnel and to consented GA with screen-level destinations", async () => {
    consent.allowed = true; analytics.trackPageView("/"); await settle();
    analytics.trackCtaClick("hero", "/onboarding?template=private");
    analytics.trackEvent("blog_cta_click", {destination: "/app/cv/123?x=1", post_auth_destination: "/app/checkout?plan_code=weekly", cta_text: "Start now"});
    await settle();
    expect(funnel).toHaveBeenCalledWith("cta_click", "hero");
    expect(events()[1]).toEqual(["event", "cta_click", expect.objectContaining({location: "hero", destination: "/onboarding"})]);
    expect(events()[2][2]).toMatchObject({destination: "/app/cv/editor", post_auth_destination: "/app/checkout", cta_text: "Start now"});
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/private|123|weekly/);
  });

  it("ignores CTA clicks on design previews", () => {
    (window as unknown as {location: {pathname: string}}).location.pathname = "/designs/editorial";
    analytics.trackCtaClick("hero", "/onboarding");
    expect(funnel).not.toHaveBeenCalled();
  });

  it("labels the Turkish landing, support and checkout screens", () => {
    expect(["/tr", "/tr/pricing", "/support", "/tr/support", "/app/checkout?plan_code=weekly"].map(path => screenPath(path))).toEqual(
      ["/tr", "/tr/pricing", "/support", "/tr/support", "/app/checkout"]);
  });
});

describe("checkout value", () => {
  it("values a trial checkout at zero whatever plan it converts to, and a paid one at its plan price", () => {
    consent.allowed = true;
    const stored = () => JSON.parse(vi.mocked(window.sessionStorage.setItem).mock.calls.at(-1)![1] as string);
    for (const plan_code of ["weekly", "monthly", "annual", "pro"]) {
      analytics.rememberCheckoutAttribution({ checkout_session_id: "cs_trial", plan_code, trial_applied: true });
      expect(stored()).toMatchObject({ plan_code, value: 0, currency: "USD" });
    }
    for (const [plan_code, value] of [["weekly", 4.99], ["monthly", 14.99], ["annual", 99.9]] as const) {
      analytics.rememberCheckoutAttribution({ checkout_session_id: "cs_paid", plan_code, trial_applied: false });
      expect(stored()).toMatchObject({ plan_code, value });
    }
    // A value computed from the live price wins over the USD list price.
    analytics.rememberCheckoutAttribution({ plan_code: "monthly", trial_applied: false, value: 349.9, currency: "TRY" });
    expect(stored()).toMatchObject({ value: 349.9, currency: "TRY" });
  });
});
