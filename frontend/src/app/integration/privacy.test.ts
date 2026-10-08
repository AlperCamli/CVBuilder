import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./supabase-client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import { analyticsAllowed, CONSENT_KEY, NOTICE_VERSION, readAnalyticsChoice, saveAnalyticsChoice } from "./privacy";
import { initializeAnalytics, trackEvent, rememberCheckoutAttribution, readCheckoutAttribution, markPaymentCompletedTracked, removeAnalyticsData } from "./analytics";
let local: Map<string, string>; let session: Map<string, string>; let append: ReturnType<typeof vi.fn>;
const storage = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), get length() { return data.size; }, key: (index: number) => [...data.keys()][index] });
beforeEach(() => {
  local = new Map(); session = new Map(); append = vi.fn();
  vi.stubGlobal("navigator", { globalPrivacyControl: false, userAgent: "test browser" });
  vi.stubGlobal("localStorage", storage(local));
  vi.stubGlobal("window", { localStorage: storage(local), sessionStorage: storage(session), navigator, location: { hostname: "example.invalid", pathname: "/", origin: "https://example.invalid" }, dispatchEvent: vi.fn() });
  vi.stubGlobal("document", { getElementById: () => null, cookie: "", head: { appendChild: append }, createElement: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("privacy choices and analytics", () => {
  it("unknown, corrupt, expired and outdated choices are denied", () => {
    expect(readAnalyticsChoice()).toBeNull(); expect(analyticsAllowed()).toBe(false);
    for (const raw of ["bad", JSON.stringify({ version: "old", analytics: true }), JSON.stringify({ version: NOTICE_VERSION, analytics: true, expires_at: new Date(0).toISOString() })]) {
      local.set(CONSENT_KEY, raw); expect(analyticsAllowed()).toBe(false);
    }
  });
  it("requires a positive choice and treats GPC as rejection", () => {
    saveAnalyticsChoice(true); expect(analyticsAllowed()).toBe(true);
    vi.stubGlobal("navigator", { globalPrivacyControl: true }); expect(analyticsAllowed()).toBe(false);
    saveAnalyticsChoice(true); expect(JSON.parse(local.get(CONSENT_KEY)!).analytics).toBe(false);
  });
  it("does not let a slow acceptance overwrite a newer rejection from another tab", () => {
    const accepting = saveAnalyticsChoice(true, {notify: false, pending: true})!;
    saveAnalyticsChoice(false, {notify: false});
    expect(saveAnalyticsChoice(true, {expectedSnapshot: accepting})).toBeNull();
    expect(analyticsAllowed()).toBe(false);
  });
  it("does not initialize tags, queue events or write attribution without consent", () => {
    initializeAnalytics(); trackEvent("pre_signup_answer", { answer: "doctorate", email: "private@example.invalid" });
    rememberCheckoutAttribution({ checkout_session_id: "secret", value: 10 }); markPaymentCompletedTracked("analytics:completed");
    expect(append).not.toHaveBeenCalled(); expect(window.dataLayer).toBeUndefined(); expect(session.size).toBe(0); expect(readCheckoutAttribution()).toBeNull();
  });
  it("clears analytics storage while preserving essential recovery and preferences", () => {
    local.set("cv-builder:guest-import", "essential"); local.set(CONSENT_KEY, "choice"); local.set("analytics:payment", "tracking"); session.set("analytics:checkout-attribution", "tracking");
    removeAnalyticsData(); expect(local.get("cv-builder:guest-import")).toBe("essential"); expect(local.get(CONSENT_KEY)).toBe("choice"); expect(local.has("analytics:payment")).toBe(false); expect(session.size).toBe(0);
  });
});
