import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseLocale, clearPendingLocale, i18n, pendingLocale, readLocale, translate } from "./i18n";
import { injectPreviewPlaceholders } from "../integration/preview-placeholders";
import { regionalCards, formatMoney, isBillingPrices, type BillingPrices } from "../integration/regional-pricing";
import type { CvContent } from "../integration/api-types";

afterEach(async () => { vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });

describe("independent locale, document language and currency", () => {
  it("rejects incomplete pricing responses before rendering money or checkout controls", () => {
    expect(isBillingPrices({})).toBe(false);
    expect(isBillingPrices({ market: "TR", available: true, quote: "fixture", plans: [] })).toBe(false);
    expect(isBillingPrices({ market: "TR", currency: "try", available: false, quote: null, plans: [] })).toBe(true);
    const catalog = { market: "GLOBAL", currency: "usd", available: true, quote: "fixture", plans: [
      { code: "weekly", amount: 499, interval: "week", interval_count: 1, trial_days: 3 },
      { code: "monthly", amount: 1499, interval: "month", interval_count: 1, trial_days: 0 },
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
    expect(injectPreviewPlaceholders({ ...content, language: "tr" }, "standard").metadata.full_name).toBe("⟪Adınız Soyadınız⟫");
    expect(content.metadata).toEqual({});
    expect(content.sections[0].blocks).toEqual([]);
  });
  it("calculates prices and rounded savings from the server catalog instead of USD constants", async () => {
    await i18n.changeLanguage("tr");
    const prices: BillingPrices = { market: "TR", currency: "try", available: true, quote: "fixture", plans: [{ code: "weekly", amount: 6990, interval: "week", interval_count: 1, trial_days: 3 }, { code: "monthly", amount: 19990, interval: "month", interval_count: 1, trial_days: 0 }, { code: "annual", amount: 149990, interval: "year", interval_count: 1, trial_days: 0 }] };
    const card = regionalCards(prices).find(card => card.code === "monthly")!;
    expect(card.weeklyPrice).toBe(formatMoney(Math.round(19990 * 12 / 52), "TRY"));
    expect(card.totalPrice).toContain(formatMoney(19990, "TRY"));
    expect(card.name).toBe("Aylık");
    expect(card.weeklyPrice).not.toContain("$3.46");
    expect(regionalCards(null).find(card => card.code === "monthly")!.weeklyPrice).toBe("—");
  });
});
