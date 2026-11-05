import { ApiClientError } from "./api-error";
import { previouslyDisplayedPrices, rememberDisplayedPrices, formatMoney, type BillingPrices } from "./regional-pricing";
import { translate as t } from "../localization/i18n";
import { trialPlanCode, type CheckoutTarget } from "../../content/pricing";
import type { BackendApi } from "./backend-api";
import type { BillingCheckoutConflictReason } from "./api-types";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";
import { checkoutPath, type CheckoutSource } from "./subscription-flow";
import { trackFunnelEvent } from "./funnel-events";
import { planName } from "./cancel-offer";

const browserTimeZone = (): string | undefined => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
};

/** The plan to open at Stripe, and whether it starts with the free trial. */
interface CheckoutTerms { plan: CheckoutTarget; trial: boolean }

/** The 409 reasons after which the terms are read again and confirmed once: the prices, the trial eligibility or the trial plan moved. */
const STALE_TERMS = new Set<BillingCheckoutConflictReason>(["pricing_changed", "trial_unavailable"]);

const pricesKey = (prices: BillingPrices) => JSON.stringify({ market: prices.market, currency: prices.currency, plans: prices.plans });

async function loadPrices(api: BackendApi): Promise<BillingPrices & { quote: string }> {
  const prices = await api.getBillingPrices();
  if (!prices.available || !prices.quote) throw new Error(t("Pricing is temporarily unavailable"));
  return prices as BillingPrices & { quote: string };
}

function priceOf(prices: BillingPrices, plan: CheckoutTarget): number {
  const price = prices.plans.find(item => item.code === plan);
  if (!price) throw new Error(t("Pricing is temporarily unavailable"));
  return price.amount;
}

// A trial is always the catalog's trial plan ("trial wins"). Without a trial this account can start, the user
// confirms that plan's price first: never a silent charge in place of a trial.
async function confirmTerms(api: BackendApi, prices: BillingPrices, requested: CheckoutTarget, wantsTrial: boolean, shown: string | null, refusedTrialPlan: CheckoutTarget | null = null): Promise<CheckoutTerms> {
  const plan = wantsTrial ? trialPlanCode(prices) : requested;
  const price = formatMoney(priceOf(prices, plan), prices.currency);
  if (shown && shown !== pricesKey(prices)) {
    rememberDisplayedPrices(prices);
    if (!window.confirm(t("Pricing changed. Continue with {{price}}?", { price }))) throw new Error(t("Review the current prices before continuing."));
  }
  if (!wantsTrial) return { plan, trial: false };
  const offered = plan !== refusedTrialPlan && prices.plans.some(item => item.code === plan && item.trial_days > 0);
  if (offered && (await api.getBillingPlan()).trial_eligible) return { plan, trial: true };
  if (!window.confirm(t("A free trial is not available for this account. Continue with the paid {{plan}} plan at {{price}}?", { plan: t(planName(plan)), price }))) throw new Error(t("Review the current prices before continuing."));
  return { plan, trial: false };
}

// Creates a Stripe Checkout session for the given plan and sends the browser to
// it. Shared by the in-app pricing page, the public pricing page, and the
// post-signup checkout resumer so the success/cancel URLs and the trial choice
// stay consistent across every entry point. withTrial defaults to a trial only for
// the trial plan itself; a trial on any other plan becomes the trial plan's trial.
export async function startStripeCheckout(
  api: BackendApi,
  plan: CheckoutTarget,
  options?: { withTrial?: boolean; source?: string; returnPath?: string; paywallSource?: CheckoutSource | null; promotionToken?: string | null }
): Promise<void> {
  const base = window.location.origin;
  // A promotion replaces the trial: the discounted first payment is charged now.
  const promotionToken = options?.promotionToken ?? null;
  let prices = await loadPrices(api);
  const wantsTrial = !promotionToken && (options?.withTrial ?? plan === trialPlanCode(prices));
  let terms = await confirmTerms(api, prices, plan, wantsTrial, previouslyDisplayedPrices());
  const request = () => {
    const returnPage = options?.returnPath ? `${base}${checkoutPath({ plan_code: terms.plan, with_trial: terms.trial, return_path: options.returnPath, source: options.paywallSource })}` : null;
    return {
      pricing_quote: prices.quote,
      plan_code: terms.plan,
      success_url: returnPage ? `${returnPage}&checkout=success&session_id={CHECKOUT_SESSION_ID}` : `${base}/app/pricing?checkout=success`,
      cancel_url: returnPage ? `${returnPage}&checkout=cancel` : `${base}/app/pricing?checkout=cancel`,
      // Always explicit: the server never guesses the trial (a trial on a plan without one is refused, a paid
      // Monthly checkout must not start one).
      with_trial: terms.trial,
      ...(promotionToken ? { promotion_token: promotionToken } : {}),
      // Stripe shows the trial end date in the user's own time zone.
      ...(browserTimeZone() ? { time_zone: browserTimeZone() } : {})
    };
  };
  let checkoutInput = request();
  let response;
  let replacedOpenCheckout = false;
  let reconfirmed = false;
  for (;;) {
    try { response = await api.createBillingCheckout(checkoutInput); break; }
    catch (error) {
      const reason = error instanceof ApiClientError ? error.details?.reason : undefined;
      if (reason === "checkout_pending" && !replacedOpenCheckout) {
        replacedOpenCheckout = true;
        await api.cancelBillingCheckout();
        continue;
      }
      if (STALE_TERMS.has(reason as BillingCheckoutConflictReason) && !reconfirmed) {
        reconfirmed = true;
        const shown = pricesKey(prices);
        const refused = reason === "trial_unavailable" && terms.trial ? terms.plan : null;
        prices = await loadPrices(api);
        terms = await confirmTerms(api, prices, terms.plan, terms.trial, shown, refused);
        checkoutInput = request();
        continue;
      }
      throw error;
    }
  }

  // A trial costs nothing today, whatever plan it converts to.
  const value = response.trial_applied
    ? 0
    : (response.promotion?.amount_due ?? response.amount ?? priceOf(prices, terms.plan)) / 100;
  const currency = (response.currency ?? prices.currency).toUpperCase();

  rememberCheckoutAttribution({
    checkout_session_id: response.checkout_session_id,
    plan_code: response.plan_code,
    plan_name: response.plan_name,
    trial_applied: response.trial_applied,
    trial_period_days: response.trial_period_days,
    value,
    currency,
    ...(response.promotion ? { promotion_slug: response.promotion.slug } : {})
  });

  trackPaymentStarted({
    source: options?.source ?? "stripe_checkout",
    plan_code: response.plan_code,
    plan_name: response.plan_name,
    trial_applied: response.trial_applied,
    trial_period_days: response.trial_period_days,
    value,
    currency,
    promotion_slug: response.promotion?.slug
  });

  // Browser Back from Stripe must land where Stripe's own back link does: swap the
  // page that started checkout for the cancel page, and reload if the browser restores
  // the frozen "Opening secure checkout…" page from its back-forward cache.
  trackFunnelEvent("checkout_redirect", response.trial_applied ? "trial" : "pro");
  window.history.replaceState(window.history.state, "", checkoutInput.cancel_url);
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); }, { once: true });
  window.location.href = response.checkout_url;
}
