import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseLocale, clearPendingLocale, i18n, pendingLocale, readLocale, translate } from "./i18n";
import en from "./en.json";
import tr from "./tr.json";
import { GUIDED_JOURNEY_FAQ_ITEMS, GUIDED_JOURNEY_FAQ_ITEMS_TR } from "../../content/seo-meta.mjs";
import { injectPreviewPlaceholders } from "../integration/preview-placeholders";
import { regionalCards, formatMoney, isBillingPrices, type BillingPrices } from "../integration/regional-pricing";
import type { CvContent } from "../integration/api-types";

afterEach(async () => { vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

const EN = en as Record<string, string>;
const TR = tr as Record<string, string>;
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]).sort();

// Since 2026-11-05 the free trial converts to Monthly; Weekly is sold without a trial.
const trCatalog = (trialPlan: "weekly" | "monthly" = "monthly"): BillingPrices => ({ market: "TR", currency: "try", available: true, quote: "fixture", plans: [
  { code: "weekly", amount: 6990, interval: "week", interval_count: 1, trial_days: trialPlan === "weekly" ? 3 : 0 },
  { code: "monthly", amount: 19990, interval: "month", interval_count: 1, trial_days: trialPlan === "monthly" ? 3 : 0 },
  { code: "annual", amount: 149990, interval: "year", interval_count: 1, trial_days: 0 },
] });

describe("independent locale, document language and currency", () => {
  it("rejects incomplete pricing responses before rendering money or checkout controls", () => {
    expect(isBillingPrices({})).toBe(false);
    expect(isBillingPrices({ market: "TR", available: true, quote: "fixture", plans: [] })).toBe(false);
    expect(isBillingPrices({ market: "TR", currency: "try", available: false, quote: null, plans: [] })).toBe(true);
    const catalog = { market: "GLOBAL", currency: "usd", available: true, quote: "fixture", plans: [
      { code: "weekly", amount: 499, interval: "week", interval_count: 1, trial_days: 0 },
      { code: "monthly", amount: 1499, interval: "month", interval_count: 1, trial_days: 3 },
      { code: "annual", amount: 9999, interval: "year", interval_count: 1, trial_days: 0 }
    ] };
    expect(isBillingPrices(catalog)).toBe(true);
    expect(isBillingPrices({ ...catalog, currency: undefined })).toBe(false);
    expect(isBillingPrices({ ...catalog, plans: [...catalog.plans.slice(0, 2), catalog.plans[0]] })).toBe(false);
  });
  it("remembers explicit language choices and marks account synchronization separately", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal("document", { documentElement: { lang: "en" }, cookie: "" });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    expect(readLocale()).toBeNull();
    chooseLocale("tr");
    expect(readLocale()).toBe("tr");
    expect(pendingLocale()).toBe("tr");
    expect(translate("Save")).toBe("Kaydet");
    clearPendingLocale();
    chooseLocale("en", false);
    expect(pendingLocale()).toBeNull();
    expect(readLocale()).toBe("en");
  });
  it("localizes preview placeholders by document language and preserves saved content", async () => {
    const content: CvContent = { version: "v1", language: "en", metadata: {}, sections: [{ id: "summary", type: "summary", title: null, order: 0, meta: {}, blocks: [] }] };
    await i18n.changeLanguage("tr");
    expect(injectPreviewPlaceholders(content, "standard").metadata.full_name).toBe("⟪Your Name⟫");
    expect(injectPreviewPlaceholders({ ...content, language: "tr" }, "standard").metadata.full_name).toBe("⟪Ad Soyad⟫");
    expect(content.metadata).toEqual({});
    expect(content.sections[0].blocks).toEqual([]);
  });
  it("calculates prices and rounded savings from the server catalog instead of USD constants", async () => {
    await i18n.changeLanguage("tr");
    const card = regionalCards(trCatalog()).find(card => card.code === "monthly")!;
    expect(card.weeklyPrice).toBe(formatMoney(Math.round(19990 * 12 / 52), "TRY"));
    expect(card.totalPrice).toContain(formatMoney(19990, "TRY"));
    expect(card.name).toBe("Aylık");
    expect(card.weeklyPrice).not.toContain("$3.46");
    expect(regionalCards(null).find(card => card.code === "monthly")!.weeklyPrice).toBe("—");
  });
});

describe("free trial converting to Monthly", () => {
  it("tells Turkish visitors the trial renews monthly at the catalog's monthly price", async () => {
    await i18n.changeLanguage("tr");
    const cards = regionalCards(trCatalog());
    const trial = cards.find(card => card.code === "trial")!;
    expect(trial.totalPrice).toBe(`Bugün ödeme yok. İptal etmezseniz 3 gün sonra aylık ${formatMoney(19990, "TRY")} tahsil edilir.`);
    expect(trial.totalPrice).not.toMatch(/haftal/i);
    expect(cards.find(card => card.code === "monthly")!.trialEligible).toBe(true);
    const weekly = cards.find(card => card.code === "weekly")!;
    expect(weekly.trialEligible).toBe(false);
    expect(weekly.description).toBe("En kısa taahhüt; haftalık ücretlendirilir. Ücretsiz deneme içermez.");
  });
  it("keeps the weekly renewal copy for a catalog that still attaches the trial to Weekly (legacy)", async () => {
    await i18n.changeLanguage("tr");
    const trial = regionalCards(trCatalog("weekly")).find(card => card.code === "trial")!;
    expect(trial.totalPrice).toBe(`Bugün ödeme yok. İptal etmezseniz 3 gün sonra haftalık ${formatMoney(6990, "TRY")} tahsil edilir.`);
  });
  it("translates every trial-to-Monthly string with its placeholders and without a weekly claim", () => {
    const keys = [
      "After 3 days, {{amount}} a month unless you cancel.",
      "A free trial is not available for this account. Continue with the paid {{plan}} plan at {{price}}?",
      "Your {{plan}} plan starts, unless you cancel before then.",
      "{{date}}: {{price}}/month",
      "Not today. If you keep Pro, your first payment of {{price}} is on {{date}}, then every month. We’ll email you a reminder before your trial ends.",
      "Not today. If you keep Pro, your first payment is on {{date}}. We’ll email you a reminder before your trial ends.",
      "Card required to start. After 3 days, {{amount}} is billed monthly until you cancel.",
      "Free until {{date}}, then {{price}} a month. We’ll email you before your trial ends.",
      "Pro {{plan}} starts right away. Your free trial ends and is never charged.",
      "Keeping Pro starts the {{plan}} plan today: {{first}} now, then {{price}} every month until you cancel. Your free trial ends at once and is never charged.",
      "Start monthly plan",
      "Start with a 3-day free trial on Monthly Pro, then create unlimited tailored CVs, exports, cover letters, and AI rewrites.",
      "Pick a plan by weekly price. Monthly starts with a 3-day free trial; weekly is billed weekly with no trial, and annual has the lowest weekly equivalent.",
      "Start by uploading your CV or creating a new one, answer a few onboarding questions and see your CV Score. Then pick your next step and start the trial with a card to use the app — you won’t pay anything today. After 3 days, the trial continues as Monthly Pro and renews monthly at the price shown at checkout, unless you cancel before the trial ends.",
      "After 3 days, it continues as Monthly Pro at {{amount}} a month unless you cancel before the trial ends. Finish onboarding first, then start your trial with a card.",
      "The trial and Pro include the same features. You start the trial with a card, and it continues as Monthly Pro unless you cancel before the trial ends.",
      "Try Pro for 3 days. Make room for every opportunity.",
      "A tailored CV for every role. One subscription to keep you moving.",
    ];
    for (const key of keys) {
      expect(TR[key], key).toBeTruthy();
      expect(EN[key], key).toBeTruthy();
      expect(placeholders(TR[key]), key).toEqual(placeholders(key));
      expect(placeholders(EN[key]), key).toEqual(placeholders(key));
    }
    // Weekly is still sold: the pricing subtitle and hero name it as a paid option without a trial.
    // Nothing else may mention a week.
    const namesWeeklyPlan = ["Pick a plan by weekly price", "Try Pro for 3 days"];
    for (const key of keys.filter(key => !namesWeeklyPlan.some(prefix => key.startsWith(prefix)))) {
      expect(EN[key], key).not.toMatch(/week/i);
      expect(TR[key], key).not.toMatch(/haftal/i);
    }
    expect(TR["Try Pro for 3 days. Make room for every opportunity."]).toContain("Aylık Pro");
    expect(TR["A tailored CV for every role. One subscription to keep you moving."]).toContain("Aylık Pro");
  });
  it("shows the same Turkish guided FAQ answers as the TR FAQPage structured data", () => {
    GUIDED_JOURNEY_FAQ_ITEMS.forEach((item, index) => {
      expect(TR[item.question]).toBe(GUIDED_JOURNEY_FAQ_ITEMS_TR[index].question);
      expect(TR[item.answer]).toBe(GUIDED_JOURNEY_FAQ_ITEMS_TR[index].answer);
      expect(EN[item.answer] ?? item.answer).toBe(item.answer);
    });
  });
  it("no longer says the free trial converts to Weekly Pro anywhere in either catalog", () => {
    for (const catalog of [EN, TR])
      for (const [key, value] of Object.entries(catalog)) {
        expect(`${key} ${value}`, key).not.toMatch(/Weekly Pro|Haftalık Pro|renews weekly|haftalık olarak yenilenir/);
      }
  });
});
