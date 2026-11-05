import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { PlanComparison, proCheckoutIntent, RegionalPricingCards } from "./DesignShared";
import { checkoutPath } from "../../integration/subscription-flow";
import { formatMoney, type BillingPrices } from "../../integration/regional-pricing";
import { i18n } from "../../localization/i18n";

vi.mock("../../integration/analytics", () => ({ trackEvent: vi.fn(), trackCtaClick: vi.fn() }));

afterEach(async () => { await i18n.changeLanguage("en"); });

// Since 2026-11-05 the catalog marks Monthly as the trial plan; Weekly is sold without a trial.
const catalog = (trialPlan: "weekly" | "monthly"): BillingPrices => ({
  market: "GLOBAL", currency: "usd", available: true, quote: "fixture", plans: [
    { code: "weekly", amount: 499, interval: "week", interval_count: 1, trial_days: trialPlan === "weekly" ? 3 : 0 },
    { code: "monthly", amount: 1499, interval: "month", interval_count: 1, trial_days: trialPlan === "monthly" ? 3 : 0 },
    { code: "annual", amount: 9990, interval: "year", interval_count: 1, trial_days: 0 },
  ],
});

const regional = (prices: BillingPrices | null) => ({
  prices, cards: [], loading: false, ready: Boolean(prices?.available && prices.quote), error: null, retry: () => undefined, locale: "en",
});

const render = (prices: BillingPrices | null) => renderToStaticMarkup(
  <MemoryRouter initialEntries={["/pricing"]}>
    <RegionalPricingCards regional={regional(prices) as never} concept="journey" guided={{ pricingPath: "/pricing" }} />
  </MemoryRouter>,
);

const footnotes = (html: string) => [...html.matchAll(/<p class="cv-plan-footnote">([^<]*)<\/p>/g)].map(match => match[1]);

describe("public trial card terms", () => {
  it("states the monthly renewal of the catalog's trial plan, never a weekly one", () => {
    const [trialTerms] = footnotes(render(catalog("monthly")));
    expect(trialTerms).toContain("Monthly Pro");
    expect(trialTerms).toContain(formatMoney(1499, "usd"));
    expect(trialTerms).not.toContain(formatMoney(499, "usd"));
    expect(trialTerms).not.toMatch(/week/i);
  });

  it("keeps the monthly wording with a placeholder before the regional catalog loads (prerendered HTML)", () => {
    const [trialTerms] = footnotes(render(null));
    expect(trialTerms).toContain("Monthly Pro");
    expect(trialTerms).toContain("—");
    expect(trialTerms).not.toMatch(/week/i);
  });

  it("falls back to neutral terms if a catalog still marks a non-monthly trial plan", () => {
    const [trialTerms] = footnotes(render(catalog("weekly")));
    expect(trialTerms).not.toContain("Monthly Pro");
    expect(trialTerms).not.toMatch(/week/i);
  });

  it("says the trial continues as Monthly Pro in the plan comparison", () => {
    const html = renderToStaticMarkup(<PlanComparison />);
    expect(html).toContain("continues as Monthly Pro");
    expect(html).not.toMatch(/renews weekly/);
  });
});

describe("public Pro button", () => {
  it("starts the free trial on the trial plan and keeps Weekly and Annual as paid choices", () => {
    const prices = catalog("monthly");
    expect(proCheckoutIntent("monthly", prices)).toMatchObject({ plan_code: "monthly", with_trial: true });
    expect(proCheckoutIntent("weekly", prices)).toMatchObject({ plan_code: "weekly", with_trial: false });
    expect(proCheckoutIntent("annual", prices)).toMatchObject({ plan_code: "annual", with_trial: false });
    // After signup the checkout grants the trial when eligible, otherwise it asks to confirm the paid monthly price.
    const url = new URL(checkoutPath({ ...proCheckoutIntent("monthly", prices), auto: true }), "https://app.example");
    expect([url.searchParams.get("plan"), url.searchParams.get("trial")]).toEqual(["monthly", "1"]);
    const paid = new URL(checkoutPath({ ...proCheckoutIntent("weekly", prices), auto: true }), "https://app.example");
    expect([paid.searchParams.get("plan"), paid.searchParams.get("trial")]).toEqual(["weekly", "0"]);
  });

  it("lets a promotion on the trial plan replace the trial, and never offers a trial the catalog does not have", () => {
    expect(proCheckoutIntent("monthly", catalog("monthly"), true).with_trial).toBe(false);
    const noTrial = { ...catalog("monthly"), plans: catalog("monthly").plans.map(plan => ({ ...plan, trial_days: 0 })) };
    expect(proCheckoutIntent("monthly", noTrial).with_trial).toBe(false);
    // A catalog that still attaches the trial to Weekly is followed.
    expect(proCheckoutIntent("monthly", catalog("weekly")).with_trial).toBe(false);
    expect(proCheckoutIntent("weekly", catalog("weekly")).with_trial).toBe(true);
  });

  it("labels the default Monthly selection as starting the free trial, including the prerendered page", () => {
    for (const html of [render(catalog("monthly")), render(null)]) {
      expect(html).toContain("Start 3-day free trial");
      expect(html).not.toContain("Choose Pro");
      expect(html).toContain("start your free trial at secure checkout");
    }
    expect(render(catalog("monthly"))).toContain(`Free for 3 days, then ${formatMoney(1499, "usd")} billed monthly.`);
  });
});
