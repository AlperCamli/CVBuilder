import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutPromotionToken, discountedAmount, effectiveStatus, fetchPromotionOffer, forgetPromotion, formatCountdown,
  isFinalPromotionDetail, isPromotionOffer, promotionCovers, promotionPlanPrice, promotionTokenFromSearch,
  promotionUnavailableDetail, readStoredPromotion, rememberPromotion, remainingMs, resetPromotionCache, type PromotionOffer,
} from "./promotion-offer";
import { readPendingCheckout, setPendingCheckout } from "./pending-checkout";
import { ApiClientError } from "./api-error";
import type { ApiClient } from "./api-client";

vi.mock("./analytics", () => ({ trackEvent: vi.fn() }));

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f901234";
const ENDS = Date.parse("2026-11-05T07:00:00Z");

const activeOffer = (overrides: Partial<PromotionOffer> = {}): PromotionOffer => ({
  status: "active",
  promotion: { slug: "flash50-2026-11", percent_off: 50, plan_codes: ["monthly"], duration: "once", duration_in_months: null,
    replaces_trial: true, starts_at: "2026-11-04T07:00:00Z", ends_at: "2026-11-05T07:00:00Z" },
  prices: { market: "TR", currency: "try", plans: [{ code: "monthly", amount: 29990, discounted_amount: 14995 }] },
  ...overrides,
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() });
  resetPromotionCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("offer response", () => {
  it("accepts every documented status and rejects malformed offers", () => {
    expect(isPromotionOffer(activeOffer())).toBe(true);
    expect(isPromotionOffer({ status: "invalid", promotion: null, prices: null })).toBe(true);
    for (const status of ["upcoming", "ended", "redeemed", "ineligible"] as const) expect(isPromotionOffer(activeOffer({ status }))).toBe(true);
    expect(isPromotionOffer({ status: "expired", promotion: null, prices: null })).toBe(false);
    expect(isPromotionOffer(activeOffer({ promotion: null }))).toBe(false);
    expect(isPromotionOffer(activeOffer({ prices: { market: "TR", currency: "try", plans: [{ code: "monthly", amount: 100, discounted_amount: 200 }] } }))).toBe(false);
    expect(isPromotionOffer(activeOffer({ promotion: { ...activeOffer().promotion!, plan_codes: ["lifetime" as never] } }))).toBe(false);
  });

  it("keeps an active offer whose market has no paid prices", () => {
    const offer = activeOffer({ prices: null });
    expect(isPromotionOffer(offer)).toBe(true);
    const now = ENDS - 1000;
    expect(promotionCovers(offer, "monthly", now)).toBe(true);
    expect(promotionPlanPrice(offer, "monthly", now)).toBeNull();
    // The regional list price (what checkout quotes) gives the same Stripe rounding.
    expect(promotionPlanPrice(offer, "monthly", now, { amount: 1499, currency: "usd" })).toEqual({ code: "monthly", amount: 1499, discounted_amount: 749, currency: "usd", percent_off: 50 });
    expect(discountedAmount(29990, 50)).toBe(14995);
  });

  it("discounts only the plans the offer covers", () => {
    const now = ENDS - 1000;
    expect(promotionPlanPrice(activeOffer(), "monthly", now)).toEqual({ code: "monthly", amount: 29990, discounted_amount: 14995, currency: "try", percent_off: 50 });
    expect(promotionPlanPrice(activeOffer(), "weekly", now, { amount: 9990, currency: "try" })).toBeNull();
    expect(promotionPlanPrice(activeOffer(), "annual", now)).toBeNull();
    expect(promotionPlanPrice(activeOffer({ status: "ended" }), "monthly", now)).toBeNull();
  });

  it("reads 409 promotion_unavailable details, and only them", () => {
    for (const detail of ["ended", "upcoming", "wrong_account", "plan_not_eligible", "redeemed", "invalid"]) {
      const error = new ApiClientError({ status: 409, code: "CONFLICT", message: "Offer unavailable", details: { reason: "promotion_unavailable", detail } });
      expect(promotionUnavailableDetail(error)).toBe(detail);
    }
    expect(promotionUnavailableDetail(new ApiClientError({ status: 409, code: "CONFLICT", message: "x", details: { reason: "promotion_unavailable", detail: "new" } }))).toBe("invalid");
    expect(promotionUnavailableDetail(new ApiClientError({ status: 409, code: "CONFLICT", message: "x", details: { reason: "checkout_pending" } }))).toBeNull();
    expect(promotionUnavailableDetail(new Error("network"))).toBeNull();
    expect(["ended", "redeemed", "invalid"].every(detail => isFinalPromotionDetail(detail as never))).toBe(true);
    expect(isFinalPromotionDetail("wrong_account")).toBe(false);
    expect(isFinalPromotionDetail("upcoming")).toBe(false);
  });
});

describe("countdown", () => {
  it("counts down in hh:mm:ss and ends exactly at ends_at", () => {
    const offer = activeOffer();
    expect(formatCountdown(remainingMs(offer, ENDS - 86_400_000))).toBe("24:00:00");
    expect(formatCountdown(remainingMs(offer, ENDS - 3_723_000))).toBe("01:02:03");
    expect(formatCountdown(remainingMs(offer, ENDS - 400))).toBe("00:00:01");
    expect(effectiveStatus(offer, ENDS - 1)).toBe("active");
    // The window is exclusive of ends_at: the page switches to the ended state without a reload.
    expect(effectiveStatus(offer, ENDS)).toBe("ended");
    expect(formatCountdown(remainingMs(offer, ENDS + 5000))).toBe("00:00:00");
    expect(promotionCovers(offer, "monthly", ENDS)).toBe(false);
    expect(effectiveStatus(activeOffer({ status: "redeemed" }), ENDS - 1)).toBe("redeemed");
  });
});

describe("token persistence", () => {
  it("reads the token from the link and ignores anything else in the query", () => {
    expect(promotionTokenFromSearch(`?promo=${TOKEN}&utm_source=email&utm_content=A`)).toBe(TOKEN);
    expect(promotionTokenFromSearch("?promo=")).toBeNull();
    expect(promotionTokenFromSearch("?promo=<script>")).toBeNull();
    expect(promotionTokenFromSearch(`?promo=${"a".repeat(257)}`)).toBeNull();
    expect(promotionTokenFromSearch("?utm_source=email")).toBeNull();
  });

  it("keeps the token for this tab and forgets it", () => {
    rememberPromotion(TOKEN, activeOffer());
    expect(readStoredPromotion()).toEqual({ token: TOKEN, offer: activeOffer() });
    forgetPromotion();
    expect(readStoredPromotion()).toBeNull();
  });

  it("works when sessionStorage throws", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), get sessionStorage(): Storage { throw new Error("SecurityError"); } });
    expect(() => rememberPromotion(TOKEN, activeOffer())).not.toThrow();
    expect(readStoredPromotion()).toBeNull();
    expect(() => forgetPromotion()).not.toThrow();
    expect(checkoutPromotionToken("monthly", false)).toBeNull();
  });

  it("carries the token through signup in the pending checkout, for its plan only", () => {
    // The pricing CTA stores it; signup, verification and sign-in only read the pending checkout.
    setPendingCheckout({ plan_code: "monthly", with_trial: false, return_path: "/onboarding?step=upload", promotion_token: TOKEN });
    expect(readPendingCheckout()).toEqual({ plan_code: "monthly", with_trial: false, return_path: "/onboarding?step=upload", promotion_token: TOKEN });
    // Another tab after email verification: no sessionStorage, the pending checkout still has it.
    expect(readStoredPromotion()).toBeNull();
    expect(checkoutPromotionToken("monthly", false)).toBe(TOKEN);
    expect(checkoutPromotionToken("annual", false)).toBeNull();
    expect(checkoutPromotionToken("monthly", true)).toBeNull();
  });

  it("uses this tab's active offer for its plan while the window is open", () => {
    rememberPromotion(TOKEN, activeOffer());
    expect(checkoutPromotionToken("monthly", false, ENDS - 1)).toBe(TOKEN);
    expect(checkoutPromotionToken("weekly", false, ENDS - 1)).toBeNull();
    expect(checkoutPromotionToken("monthly", false, ENDS)).toBeNull();
    rememberPromotion(TOKEN, activeOffer({ status: "upcoming" }));
    expect(checkoutPromotionToken("monthly", false, ENDS - 1)).toBeNull();
  });

  it("ignores a malformed token in a stored pending checkout", () => {
    window.localStorage.setItem("cv-builder:pending-checkout", JSON.stringify({ plan_code: "monthly", promotion_token: "", created_at: Date.now() }));
    expect(readPendingCheckout()).toEqual({ plan_code: "monthly", with_trial: undefined });
  });
});

describe("GET /promotions/offer", () => {
  it("resolves a token once per page load and retries after a failure", async () => {
    const get = vi.fn(async () => activeOffer());
    const client = { get } as unknown as ApiClient;
    await expect(fetchPromotionOffer(TOKEN, client)).resolves.toEqual(activeOffer());
    await fetchPromotionOffer(TOKEN, client);
    expect(get).toHaveBeenCalledExactlyOnceWith("/promotions/offer", { query: { token: TOKEN } });
    const failing = { get: vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce({ status: "invalid", promotion: null, prices: null }) } as unknown as ApiClient;
    await expect(fetchPromotionOffer("other-token", failing)).rejects.toThrow("429");
    await expect(fetchPromotionOffer("other-token", failing)).resolves.toEqual({ status: "invalid", promotion: null, prices: null });
  });

  it("rejects an unexpected response", async () => {
    await expect(fetchPromotionOffer(TOKEN, { get: vi.fn(async () => ({ status: "active" })) } as unknown as ApiClient)).rejects.toThrow("Invalid promotion response");
  });
});
