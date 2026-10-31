import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CheckoutScreen } from "./CheckoutScreen";
import { checkoutScreen } from "../integration/checkout-screen";
import { i18n } from "../localization/i18n";

const regional = {
  prices: { market: "TR", currency: "try", available: true, quote: "fixture", plans: [
    { code: "weekly", amount: 14990, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: 34990, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: 149900, interval: "year", interval_count: 1, trial_days: 0 },
  ] },
  loading: false, ready: true, error: null, retry: () => undefined,
} as const;

function render(input: Parameters<typeof checkoutScreen>[0], opening: string | null = null) {
  const outcome = input.outcome;
  return renderToStaticMarkup(<MemoryRouter><CheckoutScreen screen={checkoutScreen(input)} outcome={outcome}
    regional={regional as never} eligibility={input.eligibility} opening={opening} error={null} onCheckout={() => undefined} /></MemoryRouter>);
}

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("checkout mascot screen", () => {
  it("reassures about cancelling and shows lira with its symbol in English", () => {
    const html = render({ outcome: "start", plan: "weekly", trial: true, eligibility: true });
    expect(html).toContain("/images/designs/mascot/celebrate.webp");
    expect(html).toContain("Cancel anytime");
    expect(html).toContain("₺149.90");
    expect(html).not.toContain("TRY");
    // The trial button opens Stripe itself; nothing links to another confirmation page.
    expect(html).not.toContain("/app/checkout");
  });

  it("names the plan and price the person backed out of", () => {
    const html = render({ outcome: "cancel", plan: "monthly", trial: false, eligibility: true });
    expect(html).toContain("Continue with Monthly · ₺349.90");
    expect(html).toContain("Checkout wasn’t completed");
  });

  it("renders the Turkish copy", async () => {
    await i18n.changeLanguage("tr");
    const html = render({ outcome: "cancel", plan: "weekly", trial: true, eligibility: true });
    expect(html).toContain("Ücretsiz denemeniz hâlâ sizi bekliyor.");
    expect(html).toContain("İstediğiniz zaman iptal edin");
    expect(html).toContain("₺149,90");
  });

  it("shows the spinner only on the button that is opening checkout", () => {
    const html = render({ outcome: "cancel", plan: "annual", trial: false, eligibility: true }, "weekly:true");
    expect(html.match(/Opening secure checkout…/g)).toHaveLength(1);
    expect(html).toContain("Continue with Yearly");
  });
});
