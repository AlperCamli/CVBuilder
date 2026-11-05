import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ads from "./advertising";

let storage: Map<string, string>; let scripts: Set<string>; let dataLayer: unknown[]; let reload: ReturnType<typeof vi.fn>;
const grant = (advertising: boolean, version = ads.AD_NOTICE_VERSION) =>
  storage.set(ads.AD_CHOICE_KEY, JSON.stringify({ version, advertising, expires_at: new Date(Date.now() + 86_400_000).toISOString() }));
beforeEach(() => {
  storage = new Map(); scripts = new Set(); dataLayer = []; reload = vi.fn();
  vi.stubGlobal("window", {
    navigator: {}, location: { hostname: "jobspecificcv.com", reload }, dataLayer, dispatchEvent: vi.fn(), addEventListener: vi.fn(),
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  vi.stubGlobal("document", { cookie: "", getElementById: (id: string) => scripts.has(id) ? {} : null });
});
afterEach(() => vi.unstubAllGlobals());

describe("Google Ads measurement", () => {
  it("keeps the index.html loader in sync with this module", () => {
    const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
    for (const value of [ads.AD_CHOICE_KEY, ads.AD_NOTICE_VERSION, ads.GTM_SCRIPT_ID, ads.AD_PRIVACY_EVENT, "gtm.js?id=GTM-PGVDXFTR"]) expect(html).toContain(value);
    expect(html.match(/googletagmanager\.com\/gtm\.js/g)).toHaveLength(1);
  });

  it("treats a missing, outdated or Global Privacy Control choice as no", () => {
    expect(ads.readAdvertisingChoice()).toBeNull();
    grant(true, "older"); expect(ads.advertisingAllowed()).toBe(false);
    grant(true); expect(ads.advertisingAllowed()).toBe(true);
    (window.navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl = true;
    expect(ads.readAdvertisingChoice()).toBe(false);
    expect(ads.saveAdvertisingChoice(true)).toBe(false);
  });

  it("grants ad storage only with consent and never grants personalization", () => {
    expect(ads.adConsentState()).toEqual({ ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    grant(true);
    expect(ads.adConsentState()).toEqual({ ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied" });
  });

  it("sends trial_started once per Checkout Session, and only with consent and the tag loaded", () => {
    ads.trackTrialStarted("cs_test_1");
    grant(true); ads.trackTrialStarted("cs_test_1");
    expect(dataLayer).toEqual([]);
    scripts.add(ads.GTM_SCRIPT_ID);
    ads.trackTrialStarted("cs_test_1"); ads.trackTrialStarted("cs_test_1"); ads.trackTrialStarted("cs_test_2");
    expect(dataLayer).toEqual([{ event: "trial_started", transaction_id: "cs_test_1" }, { event: "trial_started", transaction_id: "cs_test_2" }]);
    grant(false); ads.trackTrialStarted("cs_test_3");
    expect(dataLayer).toHaveLength(2);
  });

  it("clears Google Ads cookies when the choice is withdrawn", () => {
    const written: string[] = [];
    Object.defineProperty(document, "cookie", { get: () => "_gcl_au=1; _ga=2; session=3", set: (value: string) => written.push(value), configurable: true });
    ads.saveAdvertisingChoice(false);
    expect(written.length).toBeGreaterThan(0);
    expect(written.every(value => value.startsWith("_gcl_au=;"))).toBe(true);
    expect(ads.readAdvertisingChoice()).toBe(false);
  });
});
