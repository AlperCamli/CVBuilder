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

// The live catalog after the switch: the trial is on Monthly, Weekly is sold without one.
const plans = (trialPlan: string | null = "monthly", amounts: Record<string, number> = { weekly: 14990, monthly: 34990, annual: 149900 }) => ([
  { code: "weekly", amount: amounts.weekly, interval: "week", interval_count: 1, trial_days: trialPlan === "weekly" ? 3 : 0 },
  { code: "monthly", amount: amounts.monthly, interval: "month", interval_count: 1, trial_days: trialPlan === "monthly" ? 3 : 0 },
  { code: "annual", amount: amounts.annual, interval: "year", interval_count: 1, trial_days: 0 }
]);
const prices = { market: "TR", currency: "try", available: true, quote: "signed-quote", plans: plans() };
function fixture() {
  return {
    getBillingPrices: vi.fn(async () => prices),
    getBillingPlan: vi.fn(async () => ({ trial_eligible: false })),
    cancelBillingCheckout: vi.fn(async () => ({ cancelled: true })),
    createBillingCheckout: vi.fn(async (input: { plan_code: string; with_trial?: boolean }) => ({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: input.plan_code, plan_name: input.plan_code, trial_applied: false, trial_period_days: null as number | null, amount: prices.plans.find(plan => plan.code === input.plan_code)!.amount, currency: "try" }))
  };
}
const conflict = (reason: string) => new ApiClientError({ status: 409, code: "CONFLICT", message: "Conflict", details: { reason } });
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
    { market: "TR", currency: "try", amount: 34990 },
    { market: "GLOBAL", currency: "usd", amount: 1499 }
  ])("preserves an eligible signup trial on Monthly in $currency and records zero due today", async ({ market, currency, amount }) => {
    const api = fixture();
    api.getBillingPrices.mockResolvedValue({ ...prices, market, currency, plans: plans("monthly", { weekly: 499, monthly: amount, annual: 9990 }) });
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    api.createBillingCheckout.mockResolvedValue({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "monthly", plan_name: "Monthly", trial_applied: true, trial_period_days: 3, amount, currency });
    // The same browser storage handoff used by the public trial CTA and signup resumer.
    setPendingCheckout({ plan_code: "monthly", with_trial: true });
    const intent = readPendingCheckout()!;
    await startStripeCheckout(api as unknown as BackendApi, intent.plan_code, { withTrial: intent.with_trial, source: "post_signup_checkout_resume" });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "monthly", with_trial: true, pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel", time_zone: timeZone });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
    expect(trackFunnelEvent).toHaveBeenCalledExactlyOnceWith("checkout_redirect", "trial");
    expect(rememberCheckoutAttribution).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", trial_applied: true, trial_period_days: 3, currency: currency.toUpperCase(), value: 0 }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: true, value: 0, currency: currency.toUpperCase() }));
  });

  it("resumes a weekly-trial intent stored before the switch as a Monthly trial, never a weekly charge", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    window.localStorage.setItem("cv-builder:pending-checkout", JSON.stringify({ plan_code: "weekly", with_trial: true, created_at: Date.now() }));
    const intent = readPendingCheckout()!;
    await startStripeCheckout(api as unknown as BackendApi, intent.plan_code, { withTrial: intent.with_trial });
    expect(api.createBillingCheckout).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: true }));
    // Even a caller that still asks for a weekly trial gets the trial plan's trial.
    await startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: true });
    expect(api.createBillingCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: true }));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("follows the server's trial plan instead of contradicting it", async () => {
    const api = fixture();
    api.getBillingPrices.mockResolvedValue({ ...prices, plans: plans("weekly") });
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true });
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", with_trial: true }));
  });

  it("keeps an explicit paid Weekly choice separate from the trial", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: false });
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", with_trial: false }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: false, value: 149.9, currency: "TRY" }));
    expect(trackFunnelEvent).toHaveBeenCalledExactlyOnceWith("checkout_redirect", "pro");
  });

  it("says no to a trial for a paid Monthly choice, so the server never adds one", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: false });
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: false }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ value: 349.9 }));
  });

  it("sends the paid Monthly plan only after a trial-ineligible user confirms its price", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "monthly");
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Monthly.*₺349\.90/));
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "monthly", with_trial: false, pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel", time_zone: timeZone });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
  });

  it("asks before charging when the server offers no trial at all", async () => {
    const api = fixture();
    api.getBillingPrices.mockResolvedValue({ ...prices, plans: plans(null) });
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: false }));
  });

  it.each(["trial_unavailable", "pricing_changed"])("re-reads the terms after %s and drops the trial only with the user's consent", async reason => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValueOnce({ trial_eligible: true }).mockResolvedValue({ trial_eligible: reason !== "pricing_changed" });
    api.createBillingCheckout.mockRejectedValueOnce(conflict(reason));
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true });
    expect(api.getBillingPrices).toHaveBeenCalledTimes(2);
    expect(api.createBillingCheckout).toHaveBeenCalledTimes(2);
    expect(api.createBillingCheckout.mock.calls[0][0]).toMatchObject({ plan_code: "monthly", with_trial: true });
    expect(api.createBillingCheckout.mock.calls[1][0]).toMatchObject({ plan_code: "monthly", with_trial: false });
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/Monthly.*₺349\.90/));
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
  });

  it("keeps the trial when only the quote went stale, and confirms changed prices", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    api.getBillingPrices.mockResolvedValueOnce(prices).mockResolvedValue({ ...prices, plans: plans("monthly", { weekly: 14990, monthly: 39990, annual: 149900 }) });
    api.createBillingCheckout.mockRejectedValueOnce(conflict("pricing_changed"));
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true });
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("₺399.90"));
    expect(api.createBillingCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: true }));
  });

  it("creates no checkout when the user declines the paid price after a refused trial", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValueOnce({ trial_eligible: true });
    api.createBillingCheckout.mockRejectedValueOnce(conflict("trial_unavailable"));
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true })).rejects.toThrow();
    expect(api.createBillingCheckout).toHaveBeenCalledOnce();
    expect(window.history.replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe("");
  });

  it("re-reads the terms once, then surfaces the conflict", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    api.createBillingCheckout.mockRejectedValue(conflict("trial_unavailable"));
    await expect(startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true })).rejects.toMatchObject({ details: { reason: "trial_unavailable" } });
    expect(api.createBillingCheckout).toHaveBeenCalledTimes(2);
    expect(window.location.href).toBe("");
  });

  it("makes browser Back from Stripe land on the cancel page", async () => {
    const api = fixture();
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
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
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true, returnPath: "/app/cv/abc?export=pdf", paywallSource: "export" });
    const { success_url, cancel_url } = api.createBillingCheckout.mock.calls[0][0] as unknown as { success_url: string; cancel_url: string };
    for (const url of [new URL(success_url), new URL(cancel_url)]) {
      expect(url.pathname).toBe("/app/checkout");
      expect(url.searchParams.get("source")).toBe("export");
      expect(url.searchParams.get("next")).toBe("/app/cv/abc?export=pdf");
      expect(url.searchParams.get("trial")).toBe("1");
      expect(url.searchParams.get("plan")).toBe("monthly");
    }
    expect(new URL(success_url).searchParams.get("session_id")).toBe("{CHECKOUT_SESSION_ID}");
  });
  it("leaves history alone when no checkout is created", async () => {
    const api = fixture();
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "monthly", { withTrial: true })).rejects.toThrow();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });
  it("creates no checkout when the user declines paid billing instead of a trial", async () => {
    const api = fixture();
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: true })).rejects.toThrow();
    expect(api.createBillingCheckout).not.toHaveBeenCalled();
    expect(trackFunnelEvent).not.toHaveBeenCalled();
  });
  it("sends the emailed offer's token without a trial and records the discounted first payment", async () => {
    const api = fixture();
    api.createBillingCheckout.mockResolvedValue({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "monthly", plan_name: "Monthly", trial_applied: false, trial_period_days: null, amount: 29990, currency: "try", promotion: { slug: "flash50-2026-11", percent_off: 50, amount_due: 14995 } } as never);
    api.getBillingPlan.mockResolvedValue({ trial_eligible: true });
    // The pending checkout that survived signup carries the token.
    setPendingCheckout({ plan_code: "monthly", with_trial: false, promotion_token: "a1b2c3d4e5f6" });
    const intent = readPendingCheckout()!;
    await startStripeCheckout(api as unknown as BackendApi, intent.plan_code, { withTrial: intent.with_trial, promotionToken: intent.promotion_token });
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "monthly", with_trial: false, promotion_token: "a1b2c3d4e5f6", pricing_quote: "signed-quote" }));
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(rememberCheckoutAttribution).toHaveBeenCalledWith(expect.objectContaining({ value: 149.95, currency: "TRY", promotion_slug: "flash50-2026-11" }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ value: 149.95, promotion_slug: "flash50-2026-11" }));
  });
  it("never sends an empty or absent token, and always states the trial choice", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "monthly", { promotionToken: "", withTrial: false });
    await startStripeCheckout(api as unknown as BackendApi, "annual", { promotionToken: null });
    for (const [input] of api.createBillingCheckout.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      expect(input).not.toHaveProperty("promotion_token");
      expect(input).toHaveProperty("with_trial", false);
    }
  });
  it("replaces an open regular checkout with the discounted one", async () => {
    const api = fixture();
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
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: false })).rejects.toThrow();
    expect(api.createBillingCheckout).not.toHaveBeenCalled();
  });
});
