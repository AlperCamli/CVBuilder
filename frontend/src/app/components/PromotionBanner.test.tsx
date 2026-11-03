import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { PromotionBanner } from "./PromotionBanner";
import { CheckoutScreen } from "./CheckoutScreen";
import { RegionalPricingCards } from "../pages/designs/DesignShared";
import { checkoutScreen } from "../integration/checkout-screen";
import { promotionCovers, promotionPlanPrice, type PromotionOffer, type PromotionOfferState, type PromotionStatus } from "../integration/promotion-offer";
import { i18n } from "../localization/i18n";

vi.mock("../integration/analytics", () => ({ trackEvent: vi.fn(), trackCtaClick: vi.fn() }));

const ENDS = Date.parse("2026-11-05T07:00:00Z");
const offer = (status: PromotionStatus = "active", prices: PromotionOffer["prices"] = { market: "TR", currency: "try", plans: [{ code: "monthly", amount: 29990, discounted_amount: 14995 }] }): PromotionOffer => ({
  status,
  promotion: { slug: "flash50-2026-11", percent_off: 50, plan_codes: ["monthly"], duration: "once", duration_in_months: null,
    replaces_trial: true, starts_at: "2026-11-04T07:00:00Z", ends_at: "2026-11-05T07:00:00Z" },
  prices,
});

/** The hook's value for a resolved offer at `now` (the hook itself runs effects, which static rendering does not). */
function promo(value: PromotionOffer | null, now = ENDS - 3_723_000, extra: Partial<PromotionOfferState> = {}): PromotionOfferState {
  const status = value ? (value.status === "active" && now >= ENDS ? "ended" : value.status) : null;
  return {
    state: value ? { phase: "resolved", token: "a1b2c3d4e5f6", offer: value, status: status! } : { phase: "loading", token: "a1b2c3d4e5f6" },
    now, offer: value, status, token: "a1b2c3d4e5f6", dismissed: false, dismiss: () => undefined,
    covers: plan => promotionCovers(value, plan, now),
    planPrice: (plan, fallback) => promotionPlanPrice(value, plan, now, fallback),
    ...extra,
  };
}

const regional = {
  prices: { market: "TR", currency: "try", available: true, quote: "fixture", plans: [
    { code: "weekly", amount: 14990, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: 29990, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: 149900, interval: "year", interval_count: 1, trial_days: 0 },
  ] },
  cards: [], loading: false, ready: true, error: null, retry: () => undefined, locale: "en",
} as const;

const banner = (state: PromotionOfferState) => renderToStaticMarkup(<PromotionBanner promo={state} layout="band" />);
const cards = (state: PromotionOfferState | undefined) => renderToStaticMarkup(
  <MemoryRouter initialEntries={["/pricing"]}>
    <RegionalPricingCards regional={regional as never} concept="journey" guided={{ pricingPath: "/pricing" }} promotion={state} />
  </MemoryRouter>);

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("promotion banner", () => {
  it("shows the offer, its terms and a fixed-width countdown to ends_at", () => {
    const html = banner(promo(offer()));
    expect(html).toContain("50% off your first month of Monthly Pro");
    expect(html).toContain("Your personal offer: ₺149.95 for the first month, then ₺299.90/month. Cancel anytime.");
    expect(html).toContain('class="promo-countdown" dateTime="2026-11-05T07:00:00Z" aria-hidden="true">01:02:03</time>');
    // Screen readers get the deadline, not a ticking number.
    expect(html).toMatch(/class="promo-sr-only">Offer ends November 5/);
    expect(html).toContain("/images/designs/mascot/celebrate.webp");
    expect(html).not.toMatch(/trial/i);
  });

  it("renders the active offer without prices when its market has none", () => {
    const html = banner(promo(offer("active", null)));
    expect(html).toContain("50% off your first month of Monthly Pro");
    expect(html).not.toContain("Your personal offer");
    expect(html).toContain(">01:02:03<");
  });

  it("reserves its slot while the token resolves", () => {
    const html = banner(promo(null));
    expect(html).toContain('class="promo-banner promo-banner-pending" aria-hidden="true"');
  });

  it("switches to the ended notice once the countdown reaches ends_at", () => {
    const html = banner(promo(offer(), ENDS));
    expect(html).toContain("This offer has ended. Regular prices apply.");
    expect(html).not.toContain("promo-countdown");
  });

  it.each([
    ["ended", "This offer has ended. Regular prices apply."],
    ["upcoming", "Your offer opens on November 4"],
    ["redeemed", "You’ve already used this offer. Regular prices apply."],
    ["ineligible", "This offer isn’t available for this account. Regular prices apply."],
    ["invalid", "We couldn’t find this offer. The link may be incomplete. Regular prices apply."],
  ] as const)("shows a dismissible notice for %s", (status, text) => {
    const html = banner(promo(status === "invalid" ? { status, promotion: null, prices: null } : offer(status)));
    expect(html).toContain(text);
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).not.toContain("promo-countdown");
    expect(banner(promo(offer(status), undefined, { dismissed: true }))).not.toContain("promo-notice");
  });

  it("renders natural Turkish copy", async () => {
    await i18n.changeLanguage("tr");
    const html = banner(promo(offer()));
    expect(html).toContain("Aylık Pro’da ilk aya %50 indirim");
    expect(html).toContain("Size özel: ilk ay ₺149,95, sonrasında aylık ₺299,90.");
    expect(html).toContain("Kalan süre");
  });
});

describe("pricing card with an emailed offer", () => {
  it("discounts Monthly: badge, crossed-out list price, first-month price and disclosure", () => {
    const html = cards(promo(offer()));
    expect(html).toContain('class="promo-plan-badge">50% off first month');
    expect(html).toMatch(/<s class="promo-was"><span class="cv-sr-only">Regular price: <\/span>₺299.90<\/s>/);
    expect(html).toContain("₺149.95</strong><span>/first month</span>");
    expect(html).toContain("then ₺299.90/month · cancel anytime");
    expect(html).toMatch(/Get 50% off Monthly/);
    // No trial wording on the discounted CTA.
    expect(html).not.toMatch(/Get 50% off Monthly[^<]*trial/i);
  });

  it("keeps the other periods and every other status at regular prices", () => {
    // Monthly (the default period) is not discounted by an offer for another plan.
    const annualOnly = offer();
    annualOnly.promotion!.plan_codes = ["annual"];
    expect(cards(promo(annualOnly))).not.toContain("promo-was");
    for (const status of ["ended", "upcoming", "redeemed", "ineligible"] as const) {
      const html = cards(promo(offer(status)));
      expect(html).not.toContain("promo-plan-badge");
      expect(html).toContain("Choose Pro");
    }
    expect(cards(promo(offer(), ENDS))).not.toContain("promo-plan-badge");
    expect(cards(undefined)).not.toContain("promo-");
  });

  it("uses the regional list price when the offer has no prices", () => {
    const html = cards(promo(offer("active", null)));
    expect(html).toContain("₺299.90</s>");
    expect(html).toContain("₺149.95</strong>");
  });
});

describe("checkout and the emailed offer", () => {
  const render = (input: Parameters<typeof checkoutScreen>[0], promotion: Parameters<typeof CheckoutScreen>[0]["promotion"] = null) =>
    renderToStaticMarkup(<MemoryRouter><CheckoutScreen screen={checkoutScreen(input)} outcome={input.outcome} regional={regional as never}
      eligibility={input.eligibility} opening={null} error={null} plansPath="/app/pricing" onCheckout={() => undefined} onPortal={() => undefined}
      onSwitchAccount={() => undefined} promotion={promotion} /></MemoryRouter>);

  it("shows the first-month price for the discounted plan", () => {
    const html = render({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotion: true }, promotionPlanPrice(offer(), "monthly", ENDS - 1));
    expect(html).toContain("₺299.90</s>");
    expect(html).toContain("₺149.95</strong><span>first month</span>");
    expect(html).toContain("50% off your first month, charged today. Then ₺299.90/month until you cancel.");
  });

  it("does not pitch the trial instead of the offer after a cancelled Stripe checkout", () => {
    expect(checkoutScreen({ outcome: "cancel", plan: "monthly", trial: false, eligibility: true }).offer).toBe("trial");
    const screen = checkoutScreen({ outcome: "cancel", plan: "monthly", trial: false, eligibility: true, promotion: true });
    expect(screen.offer).toBe("plan");
    expect(screen.primary).toMatchObject({ kind: "checkout", plan: "monthly", withTrial: false });
  });

  it.each([
    ["ended", "This offer has ended"],
    ["upcoming", "Your offer hasn’t started yet"],
    ["plan_not_eligible", "The offer doesn’t cover this plan"],
    ["redeemed", "You’ve already used this offer"],
    ["invalid", "We couldn’t verify this offer"],
  ] as const)("explains a refused offer (%s) and offers the regular price", (detail, title) => {
    const screen = checkoutScreen({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotionIssue: detail });
    expect(screen.primary).toEqual({ kind: "checkout", plan: "monthly", withTrial: false, label: "Continue at the regular price · {{price}}" });
    const html = render({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotionIssue: detail });
    expect(html).toContain(title);
    expect(html).toContain("Continue at the regular price · ₺299.90");
    expect(html).not.toContain("first month");
  });

  it("suggests the emailed account when the offer belongs to another one", async () => {
    const screen = checkoutScreen({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotionIssue: "wrong_account" });
    expect(screen.primary.kind).toBe("switch_account");
    expect(screen.secondary).toMatchObject({ kind: "checkout", withTrial: false });
    const html = render({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotionIssue: "wrong_account" });
    expect(html).toContain("This offer belongs to another account");
    expect(html).toContain("Sign in with the emailed account");
    expect(html).toContain("Continue at the regular price · ₺299.90");
    await i18n.changeLanguage("tr");
    const tr = render({ outcome: "start", plan: "monthly", trial: false, eligibility: true, promotionIssue: "wrong_account" });
    expect(tr).toContain("Bu teklif başka bir hesaba ait");
    expect(tr).toContain("Normal fiyatla devam et · ₺299,90");
  });
});
