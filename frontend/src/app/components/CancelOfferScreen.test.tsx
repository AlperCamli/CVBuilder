import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CancelBenefitsScreen, CancelOfferAccepted, CancelOfferScreen, CancelTrialRedirect } from "./CancelOfferScreen";
import type { CancelOffer } from "../integration/api-types";
import { cancelOfferView } from "../integration/cancel-offer";
import { i18n } from "../localization/i18n";

const PERIOD_END = "2026-11-05T09:13:29.000Z";
// Production TRY prices: weekly ₺149,90, monthly ₺349,90.
const trialOffer: CancelOffer = { kind: "checkout", slug: "trial-cancel-save50", percent_off: 50, plan_code: "monthly", currency: "try", amount: 34990, discounted_amount: 17495, current_plan_code: "weekly", current_amount: 14990, period_end: PERIOD_END };
const weeklyOffer: CancelOffer = { ...trialOffer, kind: "switch_at_period_end", slug: "weekly-cancel-save50" };
const monthlyOffer: CancelOffer = { ...trialOffer, kind: "renewal_discount", slug: "monthly-cancel-save50", current_plan_code: "monthly", current_amount: 34990 };
const usdOffer: CancelOffer = { ...trialOffer, currency: "usd", amount: 1499, discounted_amount: 749, current_amount: 499 };

const render = (offer: CancelOffer, props: Partial<Parameters<typeof CancelOfferScreen>[0]> = {}) =>
  renderToStaticMarkup(<MemoryRouter><CancelOfferScreen offer={offer} busy={null} error={null} offerGone={false} returned={false} onAccept={() => undefined} onCancel={() => undefined} {...props} /></MemoryRouter>);
const page = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("cancel offer view", () => {
  it("dates a trial's checkout from today and a paid plan's offer from its period end", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(cancelOfferView(trialOffer, "en-US", now)).toMatchObject({ price: "₺349.90", firstCharge: "₺174.95", periodEnd: "November 5", chargeDate: "November 4", nextDate: "December 4", weekComparison: false });
    expect(cancelOfferView(weeklyOffer, "en-US", now)).toMatchObject({ chargeDate: "November 5", nextDate: "December 5", currentPlanName: "Weekly" });
    expect(cancelOfferView(monthlyOffer, "en-US", now)).toMatchObject({ chargeDate: "November 5", nextDate: "December 5", period: "month" });
    expect(cancelOfferView({ ...monthlyOffer, plan_code: "annual", current_plan_code: "annual" }, "en-US", now)).toMatchObject({ nextDate: "November 5", period: "year" });
  });

  it("compares with one week only when the discounted month really costs about a week", () => {
    expect(cancelOfferView({ ...trialOffer, amount: 29990, discounted_amount: 14995 }, "en-US").weekComparison).toBe(true);
    expect(cancelOfferView(usdOffer, "en-US").weekComparison).toBe(false);
  });
});

describe("trial offer", () => {
  it("shows the mascot, the discounted monthly card and both choices as full buttons", () => {
    const html = render(trialOffer);
    expect(html).toContain("/images/designs/mascot/guide.webp");
    expect(html).toContain("ONE-TIME OFFER");
    expect(html).toContain("Still job hunting? Keep Pro for half price.");
    expect(html).toMatch(/<s>₺349\.90<\/s>/);
    expect(html).toContain("₺174.95");
    expect(html).toContain("Keep Pro at 50% off");
    expect(html).toMatch(/class="checkout-screen-secondary cancel-offer-decline"[^>]*>No thanks, cancel my trial</);
  });

  it("says Pro is paid today and the trial ends uncharged, for a weekly trial and a monthly one", () => {
    const monthlyTrial: CancelOffer = { ...trialOffer, current_plan_code: "monthly", current_amount: 34990 };
    for (const offer of [trialOffer, monthlyTrial]) {
      const html = render(offer);
      expect(html).toContain("Today: ₺174.95");
      expect(html).toContain("Pro Monthly starts right away. Your free trial ends and is never charged.");
      expect(html).toContain("Keeping Pro starts the Monthly plan today: ₺174.95 now, then ₺349.90 every month until you cancel. Your free trial ends at once and is never charged.");
      expect(html).not.toMatch(/weekly price/i);
      expect(html).toContain("Secure checkout powered by Stripe");
    }
    // The "about one week" comparison only speaks to a weekly trial.
    expect(cancelOfferView({ ...trialOffer, current_plan_code: "monthly", current_amount: 34990, amount: 29990, discounted_amount: 14995 }, "en-US").weekComparison).toBe(false);
  });

  it("tells someone back from Stripe that nothing changed, and locks both buttons while one is busy", () => {
    expect(render(trialOffer, { returned: true })).toContain("Payment wasn’t completed. Your free trial hasn’t changed.");
    const opening = render(trialOffer, { busy: "accept" });
    expect(opening).toContain("Opening secure checkout…");
    expect(opening.match(/disabled=""/g)).toHaveLength(2);
    const gone = render(trialOffer, { offerGone: true, error: "This offer is no longer available. You can still cancel below." });
    expect(gone).not.toContain("Keep Pro at 50% off");
    expect(gone).toContain("No thanks, cancel my trial");
  });

  it("renders the Turkish copy", async () => {
    await i18n.changeLanguage("tr");
    const html = render(trialOffer);
    expect(html).toContain("İş aramanız sürüyor mu? Pro yarı fiyatına.");
    expect(html).toContain("Bugün: ₺174,95");
    expect(html).toContain("Hayır, teşekkürler. Denememi iptal et");
  });
});

describe("paid plan offers", () => {
  it("paid weekly: Monthly from the end of the paid week, first month 50% off, nothing charged today", () => {
    const html = render(weeklyOffer);
    expect(html).toContain("Still job hunting? Get a month of Pro for half price.");
    expect(html).toContain("Your weekly plan runs until November 5. Then switch to Monthly and pay ₺174.95 for your first month.");
    expect(html).toContain("Today: nothing to pay");
    expect(html).toContain("November 5: ₺174.95");
    expect(html).toContain("Pro Monthly starts with 50% off the first month. No more weekly charges.");
    expect(html).toContain("Switch to Monthly at 50% off");
    expect(html).toContain("No thanks, cancel my plan");
    expect(html).toContain("Nothing is charged today.");
    // No checkout: no Stripe badge, and the busy label says the offer is being applied.
    expect(html).not.toContain("Secure checkout powered by Stripe");
    expect(render(weeklyOffer, { busy: "accept" })).toContain("Applying your offer…");
  });

  it("monthly: the next renewal at half price on the same plan", () => {
    const html = render(monthlyOffer);
    expect(html).toContain("Still job hunting? Your next month is half price.");
    expect(html).toContain("Keep Pro and pay ₺174.95 instead of ₺349.90 when your plan renews on November 5.");
    expect(html).toContain("Your Monthly plan renews on November 5.");
    expect(html).toContain("next month");
    expect(html).toContain("Your next month, 50% off.");
    expect(html).toContain("Your renewal on November 5 costs ₺174.95 instead of ₺349.90. After that, ₺349.90 every month until you cancel. Nothing is charged today.");
  });

  it("an annual renewal discount names the year", () => {
    const html = render({ ...monthlyOffer, plan_code: "annual", current_plan_code: "annual", percent_off: 20, amount: 149900, discounted_amount: 119920 });
    expect(html).toContain("Stay on Pro with 20% off your next year.");
    expect(html).toContain("every year");
  });

  it("renders the paid offers in Turkish", async () => {
    await i18n.changeLanguage("tr");
    expect(render(weeklyOffer)).toContain("%50 indirimle Aylık plana geçin");
    const monthly = render(monthlyOffer);
    expect(monthly).toContain("İş aramanız sürüyor mu? Sonraki ayınız yarı fiyatına.");
    expect(monthly).toContain("Hayır, teşekkürler. Planımı iptal et");
  });

  it("confirms what changes and when, with what Pro includes", () => {
    const weekly = page(<CancelOfferAccepted offer={weeklyOffer} onContinue={() => undefined} />);
    expect(weekly).toContain("Your weekly plan runs until November 5. Then Pro Monthly starts at ₺174.95 for the first month.");
    expect(weekly).toContain("Unlimited PDF &amp; DOCX downloads");
    expect(page(<CancelOfferAccepted offer={monthlyOffer} onContinue={() => undefined} />)).toContain("Your renewal on November 5 costs ₺174.95 instead of ₺349.90.");
  });
});

describe("without an offer", () => {
  it("shows what Pro includes, keeps the paid period, and offers Keep Pro or cancel", () => {
    const annual = page(<CancelBenefitsScreen trial={false} planCode="annual" periodEnd="March 3" busy={null} error={null} onKeep={() => undefined} onCancel={() => undefined} />);
    expect(annual).toContain("/images/designs/mascot/thinking.webp");
    expect(annual).toContain("Are you sure? Here’s what you’d lose.");
    expect(annual).toContain("Your Yearly plan stays active until March 3 either way.");
    expect(annual).toContain("Unlimited PDF &amp; DOCX downloads");
    expect(annual).toContain("Keep Pro");
    expect(annual).toContain("No thanks, cancel my plan");
    const trial = page(<CancelBenefitsScreen trial planCode="weekly" periodEnd="November 5" busy={null} error={null} onKeep={() => undefined} onCancel={() => undefined} />);
    expect(trial).toContain("Your free trial stays active until November 5 either way.");
    expect(trial).toContain("No thanks, cancel my trial");
  });

  it("offers a retry and the way back when Stripe cannot be reached", () => {
    const failed = page(<CancelTrialRedirect error="We couldn’t open the cancellation. Please try again." onRetry={() => undefined} />);
    expect(failed).toContain("Try again");
    expect(failed).toContain('href="/app/profile"');
  });
});
