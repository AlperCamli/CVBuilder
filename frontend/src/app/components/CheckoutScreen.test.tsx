import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CheckoutScreen, CheckoutWelcome } from "./CheckoutScreen";
import { checkoutScreen, trialEndDate } from "../integration/checkout-screen";
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
    regional={regional as never} eligibility={input.eligibility} opening={opening} error={null}
    plansPath="/app/pricing?next=%2Fapp%2Fcv%2F1&amp;source=export" onCheckout={() => undefined} onPortal={() => undefined} /></MemoryRouter>);
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

  it("lays out today, the reminder and the first charge, with the cancel promise and Stripe", () => {
    const html = render({ outcome: "start", plan: "weekly", trial: true, eligibility: true, source: "export" });
    const date = trialEndDate(3, "en-US");
    expect(html).toContain("Your tailored CV is ready to download");
    expect(html).toContain("Today: ₺0<");
    expect(html).toContain("Reminder email before your trial ends");
    expect(html).toContain(`${date}: ₺149.90/week`);
    expect(html).toContain(`Cancel anytime from your Profile in two clicks. If you cancel before ${date}, you won’t be charged.`);
    expect(html).toContain("Secure checkout powered by Stripe");
    expect(html).toContain("We never see or store your card details.");
    expect(html).toContain("What you unlock");
    for (const question of ["Why do you need a card?", "When will I be charged?", "How do I cancel?"]) expect(html).toContain(`<summary>${question}`);
    // The plans link keeps the paywall's next step and source.
    expect(html).toContain('href="/app/pricing?next=%2Fapp%2Fcv%2F1&amp;source=export"');
  });

  it("keeps the paid variant about its price, without trial dates or the card question", () => {
    const html = render({ outcome: "start", plan: "monthly", trial: false, eligibility: false });
    expect(html).toContain("Complete your Pro purchase");
    expect(html).toContain("₺349.90");
    expect(html).not.toContain("Reminder email before your trial ends");
    expect(html).not.toContain("Why do you need a card?");
    expect(html).toContain("Secure checkout powered by Stripe");
  });

  it("offers only the billing portal after a failed renewal", () => {
    const html = render({ outcome: "start", plan: "weekly", trial: true, eligibility: false, portal: "payment" });
    expect(html).toContain("Update payment method");
    expect(html).not.toContain("Start my 3-day free trial");
    expect(html).not.toContain("/app/pricing");
  });

  it("renders the Turkish timeline and Stripe block", async () => {
    await i18n.changeLanguage("tr");
    const html = render({ outcome: "start", plan: "weekly", trial: true, eligibility: true });
    expect(html).toContain("Bugün: ₺0<");
    expect(html).toContain(`${trialEndDate(3, "tr-TR")}: haftalık ₺149,90`);
    expect(html).toContain("Güvenli ödeme altyapısı: Stripe");
    expect(html).toContain("Neden kart gerekiyor?");
  });
});

describe("welcome after checkout", () => {
  const welcome = (billing: { plan_code: "weekly" | "monthly"; subscription_status: string; current_period_end: string | null }, source: "export" | "tailoring" | null, destination = "/app/cv/1?resume=export") =>
    renderToStaticMarkup(<MemoryRouter><CheckoutWelcome billing={billing} regional={regional as never} source={source} destination={destination} onContinue={() => undefined} /></MemoryRouter>);

  it("welcomes a trial to Pro with the trial chip, the benefits, the task button and the trial dates", () => {
    const html = welcome({ plan_code: "weekly", subscription_status: "trialing", current_period_end: "2026-11-05T12:00:00Z" }, "export");
    expect(html).toContain("FREE TRIAL STARTED");
    expect(html).toContain("Welcome to Pro. Everything is unlocked.");
    for (const benefit of ["Tailor your CV to every job", "Unlimited PDF &amp; DOCX downloads", "AI improvements", "Cover letters"]) expect(html).toContain(benefit);
    expect(html).toContain("Download your CV");
    expect(html).toContain("Free until November 5, then ₺149.90 a week. We’ll email you before your trial ends.");
  });

  it("uses the same headline for a Pro purchase, with the Pro chip and the renewal date", () => {
    const html = welcome({ plan_code: "monthly", subscription_status: "active", current_period_end: "2026-12-02T12:00:00Z" }, "tailoring");
    expect(html).toContain("PRO IS ACTIVE");
    expect(html).not.toContain("FREE TRIAL STARTED");
    expect(html).toContain("Welcome to Pro. Everything is unlocked.");
    expect(html).toContain("Continue tailoring");
    expect(html).toContain("Your Monthly plan renews on December 2. Manage it anytime in Profile.");
  });

  it("opens the app when no paywall started checkout, and stays truthful without a date", () => {
    const html = welcome({ plan_code: "weekly", subscription_status: "trialing", current_period_end: null }, null, "/app");
    expect(html).toContain("Go to my CVs");
    expect(html).toContain("We’ll email you before your trial ends.");
    expect(html).not.toContain("Free until");
  });

  it("renders the Turkish welcome", async () => {
    await i18n.changeLanguage("tr");
    const html = welcome({ plan_code: "weekly", subscription_status: "trialing", current_period_end: "2026-11-05T12:00:00Z" }, "export");
    expect(html).toContain("ÜCRETSİZ DENEME BAŞLADI");
    expect(html).toContain("Pro’ya hoş geldiniz. Tüm özellikler açıldı.");
    expect(html).toContain("5 Kasım tarihine kadar ücretsiz, sonrasında haftalık ₺149,90.");
  });
});
