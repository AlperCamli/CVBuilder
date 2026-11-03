import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStripeCheckout } from "./checkout-redirect";
import type { BackendApi } from "./backend-api";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";
import { readPendingCheckout, setPendingCheckout } from "./pending-checkout";
import { trackFunnelEvent } from "./funnel-events";
import { ApiClientError } from "./api-error";

vi.mock("./analytics", () => ({ rememberCheckoutAttribution: vi.fn(), trackPaymentStarted: vi.fn() }));
vi.mock("./funnel-events", () => ({ trackFunnelEvent: vi.fn() }));
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const prices = { market: "TR", currency: "try", available: true, quote: "signed-quote", plans: [{ code: "weekly", amount: 6990, interval: "week", interval_count: 1, trial_days: 3 }] };
function fixture() {
  return {
    getBillingPrices: vi.fn(async () => prices),
    getBillingPlan: vi.fn(async () => ({ trial_eligible: false })),
    createBillingCheckout: vi.fn(async () => ({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "weekly", plan_name: "Weekly", trial_applied: false, trial_period_days: null as number | null, amount: 6990, currency: "try" }))
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  const stored = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { origin: "https://app.example", href: "", reload: vi.fn() }, confirm: vi.fn(() => true),
    history: { state: { idx: 3 }, replaceState: vi.fn() }, addEventListener: vi.fn(),
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }
  });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("authoritative checkout terms", () => {
  it.each([
    { market: "TR", currency: "try", amount: 6990 },
    { market: "GLOBAL", currency: "usd", amount: 499 }
  ])("preserves an eligible signup trial in $currency and records zero due today", async ({ market, currency, amount }) => {
    const api = fixture();
    api.getBillingPrices.mockResolvedValue({ ...prices, market, currency, plans: [{ ...prices.plans[0], amount }] });
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    api.createBillingCheckout.mockResolvedValue({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "weekly", plan_name: "Weekly", trial_applied: true, trial_period_days: 3, amount, currency });
    // The same browser storage handoff used by the public trial CTA and signup resumer.
    setPendingCheckout({ plan_code: "weekly", with_trial: true });
    const intent = readPendingCheckout()!;
    await startStripeCheckout(api as unknown as BackendApi, intent.plan_code, { withTrial: intent.with_trial, source: "post_signup_checkout_resume" });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "weekly", pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel", time_zone: timeZone });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
    expect(trackFunnelEvent).toHaveBeenCalledExactlyOnceWith("checkout_redirect", "trial");
    expect(rememberCheckoutAttribution).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", trial_applied: true, trial_period_days: 3, currency: currency.toUpperCase(), value: 0 }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: true, value: 0, currency: currency.toUpperCase() }));
  });

  it("keeps an explicit paid Weekly choice separate from the trial", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: false });
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", with_trial: false }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: false, value: 69.9, currency: "TRY" }));
    expect(trackFunnelEvent).toHaveBeenCalledExactlyOnceWith("checkout_redirect", "pro");
  });

  it("sends explicit paid intent only after a trial-ineligible user confirms the displayed price", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "weekly", with_trial: false, pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel", time_zone: timeZone });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
  });
  it("makes browser Back from Stripe land on the cancel page", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { returnPath: "/app/cv-score?action=editor" });
    const cancelUrl = "https://app.example/app/checkout?plan=monthly&trial=1&next=%2Fapp%2Fcv-score%3Faction%3Deditor&checkout=cancel";
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ cancel_url: cancelUrl }));
    expect(window.history.replaceState).toHaveBeenCalledWith({ idx: 3 }, "", cancelUrl);
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
    const [event, onPageShow] = vi.mocked(window.addEventListener).mock.calls[0] as unknown as [string, (event: { persisted: boolean }) => void];
    expect(event).toBe("pageshow");
    onPageShow({ persisted: false });
    expect(window.location.reload).not.toHaveBeenCalled();
    onPageShow({ persisted: true });
    expect(window.location.reload).toHaveBeenCalledOnce();
  });
  it("keeps the paywall source and next step on the Stripe return pages", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    await startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: true, returnPath: "/app/cv/abc?export=pdf", paywallSource: "export" });
    const { success_url, cancel_url } = api.createBillingCheckout.mock.calls[0][0] as { success_url: string; cancel_url: string };
    for (const url of [new URL(success_url), new URL(cancel_url)]) {
      expect(url.pathname).toBe("/app/checkout");
      expect(url.searchParams.get("source")).toBe("export");
      expect(url.searchParams.get("next")).toBe("/app/cv/abc?export=pdf");
      expect(url.searchParams.get("trial")).toBe("1");
    }
    expect(new URL(success_url).searchParams.get("session_id")).toBe("{CHECKOUT_SESSION_ID}");
  });
  it("leaves history alone when no checkout is created", async () => {
    const api = fixture();
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly")).rejects.toThrow();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
  it("creates no checkout when the user declines paid billing instead of a trial", async () => {
    const api = fixture();
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly")).rejects.toThrow();
    expect(api.createBillingCheckout).not.toHaveBeenCalled();
    expect(trackFunnelEvent).not.toHaveBeenCalled();
  });
  it("sends the emailed offer's token without a trial and records the discounted first payment", async () => {
    const api = fixture();
    api.createBillingCheckout.mockResolvedValue({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "monthly", plan_name: "Monthly", trial_applied: false, trial_period_days: null, amount: 29990, currency: "try", promotion: { slug: "flash50-2026-11", percent_off: 50, amount_due: 14995 } } as never);
    // The pending checkout that survived signup carries the token.
    setPendingCheckout({ plan_code: "monthly", with_trial: false, promotion_token: "a1b2c3d4e5f6" });
    const intent = readPendingCheckout()!;
    await startStripeCheckout(api as unknown as BackendApi, intent.plan_code, { withTrial: intent.with_trial, promotionToken: intent.promotion_token });
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: false, promotion_token: "a1b2c3d4e5f6", pricing_quote: "signed-quote" }));
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(rememberCheckoutAttribution).toHaveBeenCalledWith(expect.objectContaining({ value: 149.95, currency: "TRY", promotion_slug: "flash50-2026-11" }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ value: 149.95, promotion_slug: "flash50-2026-11" }));
  });
  it("never sends an empty or absent token", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { promotionToken: "" });
    await startStripeCheckout(api as unknown as BackendApi, "annual", { promotionToken: null });
    for (const [input] of api.createBillingCheckout.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(input).not.toHaveProperty("promotion_token");
      expect(input).not.toHaveProperty("with_trial");
    }
  });
  it("replaces an open regular checkout with the discounted one", async () => {
    const api = { ...fixture(), cancelBillingCheckout: vi.fn(async () => ({ cancelled: true })) };
    api.createBillingCheckout.mockRejectedValueOnce(new ApiClientError({ status: 409, code: "CONFLICT", message: "Finish or cancel your existing checkout before starting another.", details: { reason: "checkout_pending" } }));
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { promotionToken: "a1b2c3d4e5f6" });
    expect(api.cancelBillingCheckout).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledTimes(2);
    expect(api.createBillingCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ promotion_token: "a1b2c3d4e5f6", with_trial: false }));
  });
  it("surfaces a refused offer instead of falling back to full price", async () => {
    const api = fixture();
    api.createBillingCheckout.mockRejectedValue(new ApiClientError({ status: 409, code: "CONFLICT", message: "Offer unavailable", details: { reason: "promotion_unavailable", detail: "ended" } }));
    await expect(startStripeCheckout(api as unknown as BackendApi, "monthly", { promotionToken: "a1b2c3d4e5f6" })).rejects.toMatchObject({ details: { reason: "promotion_unavailable", detail: "ended" } });
    expect(api.createBillingCheckout).toHaveBeenCalledOnce();
    expect(window.location.href).toBe("");
  });
  it("requires confirmation when signup changes the displayed market or prices", async () => {
    const api = fixture();
    vi.mocked(sessionStorage.getItem).mockReturnValue(JSON.stringify({ market: "GLOBAL", currency: "usd", plans: [] }));
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly")).rejects.toThrow();
    expect(api.createBillingCheckout).not.toHaveBeenCalled();
  });
});
