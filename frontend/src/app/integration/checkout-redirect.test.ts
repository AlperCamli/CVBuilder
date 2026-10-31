import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStripeCheckout } from "./checkout-redirect";
import type { BackendApi } from "./backend-api";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";
import { readPendingCheckout, setPendingCheckout } from "./pending-checkout";

vi.mock("./analytics", () => ({ rememberCheckoutAttribution: vi.fn(), trackPaymentStarted: vi.fn() }));

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
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "weekly", pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel" });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
    expect(rememberCheckoutAttribution).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", trial_applied: true, trial_period_days: 3, currency: currency.toUpperCase(), value: 0 }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: true, value: 0, currency: currency.toUpperCase() }));
  });

  it("keeps an explicit paid Weekly choice separate from the trial", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly", { withTrial: false });
    expect(api.getBillingPlan).not.toHaveBeenCalled();
    expect(api.createBillingCheckout).toHaveBeenCalledWith(expect.objectContaining({ plan_code: "weekly", with_trial: false }));
    expect(trackPaymentStarted).toHaveBeenCalledWith(expect.objectContaining({ trial_applied: false, value: 69.9, currency: "TRY" }));
  });

  it("sends explicit paid intent only after a trial-ineligible user confirms the displayed price", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "weekly", with_trial: false, pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel" });
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
  });
  it("requires confirmation when signup changes the displayed market or prices", async () => {
    const api = fixture();
    vi.mocked(sessionStorage.getItem).mockReturnValue(JSON.stringify({ market: "GLOBAL", currency: "usd", plans: [] }));
    vi.mocked(window.confirm).mockReturnValue(false);
    await expect(startStripeCheckout(api as unknown as BackendApi, "weekly")).rejects.toThrow();
    expect(api.createBillingCheckout).not.toHaveBeenCalled();
  });
});
