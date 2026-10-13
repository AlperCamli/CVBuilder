import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startStripeCheckout } from "./checkout-redirect";
import type { BackendApi } from "./backend-api";

vi.mock("./analytics", () => ({ rememberCheckoutAttribution: vi.fn(), trackPaymentStarted: vi.fn() }));

const prices = { market: "TR", currency: "try", available: true, quote: "signed-quote", plans: [{ code: "weekly", amount: 6990, interval: "week", interval_count: 1, trial_days: 3 }] };
function fixture() {
  return {
    getBillingPrices: vi.fn(async () => prices),
    getBillingPlan: vi.fn(async () => ({ trial_eligible: false })),
    createBillingCheckout: vi.fn(async () => ({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "session", plan_code: "weekly", plan_name: "Weekly", trial_applied: false, trial_period_days: null, amount: 6990, currency: "try" }))
  };
}
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "https://app.example", href: "" }, confirm: vi.fn(() => true) });
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("authoritative checkout terms", () => {
  it("sends explicit paid intent only after a trial-ineligible user confirms the displayed price", async () => {
    const api = fixture();
    await startStripeCheckout(api as unknown as BackendApi, "weekly");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(api.createBillingCheckout).toHaveBeenCalledWith({ plan_code: "weekly", with_trial: false, pricing_quote: "signed-quote", success_url: "https://app.example/app/pricing?checkout=success", cancel_url: "https://app.example/app/pricing?checkout=cancel" });
    expect(window.location.href).toBe("https://checkout.stripe.test/session");
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
