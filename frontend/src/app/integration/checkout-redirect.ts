import { ApiClientError } from "./api-error";
import { previouslyDisplayedPrices, rememberDisplayedPrices, formatMoney } from "./regional-pricing";
import { translate as t } from "../localization/i18n";
import type { CheckoutTarget } from "../../content/pricing";
import type { BackendApi } from "./backend-api";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";
import { checkoutPath } from "./subscription-flow";

// Creates a Stripe Checkout session for the given plan and sends the browser to
// it. Shared by the in-app pricing page, the public pricing page, and the
// post-signup checkout resumer so the success/cancel URLs and the trial opt-out
// stay consistent across every entry point.
export async function startStripeCheckout(
  api: BackendApi,
  plan: CheckoutTarget,
  options?: { withTrial?: boolean; source?: string; returnPath?: string }
): Promise<void> {
  const base = window.location.origin;
  const prices = await api.getBillingPrices();
  if (!prices.available || !prices.quote) throw new Error(t("Pricing is temporarily unavailable"));
  const planPrice = prices.plans.find(item => item.code === plan)!;
  const displayed = previouslyDisplayedPrices();
  let withTrial = options?.withTrial;
  if (displayed && displayed !== JSON.stringify({ market: prices.market, currency: prices.currency, plans: prices.plans })) {
    rememberDisplayedPrices(prices);
    if (!window.confirm(t("Pricing changed. Continue with {{price}}?", { price: formatMoney(planPrice.amount, prices.currency) }))) throw new Error(t("Review the current prices before continuing."));
  }
  if (plan === "weekly" && withTrial !== false) {
    const billing = await api.getBillingPlan();
    if (!billing.trial_eligible) {
      if (!window.confirm(t("A free trial is not available for this account. Continue with the paid weekly plan at {{price}}?", { price: formatMoney(planPrice.amount, prices.currency) }))) throw new Error(t("Review the current prices before continuing."));
      withTrial = false;
    }
  }
  const returnPage = options?.returnPath ? `${base}${checkoutPath({ plan_code: plan, with_trial: withTrial, return_path: options.returnPath })}` : null;
  const checkoutInput = {
    pricing_quote: prices.quote,
    plan_code: plan,
    success_url: returnPage ? `${returnPage}&checkout=success&session_id={CHECKOUT_SESSION_ID}` : `${base}/app/pricing?checkout=success`,
    cancel_url: returnPage ? `${returnPage}&checkout=cancel` : `${base}/app/pricing?checkout=cancel`,
    ...(plan === "weekly" && withTrial === false ? { with_trial: false } : {})
  };
  let response;
  try { response = await api.createBillingCheckout(checkoutInput); }
  catch (error) {
    if (!(error instanceof ApiClientError) || error.details?.reason !== "checkout_pending") throw error;
    await api.cancelBillingCheckout();
    response = await api.createBillingCheckout(checkoutInput);
  }

  const value =
    response.plan_code === "weekly" && response.trial_applied
      ? 0
      : (response.amount ?? planPrice.amount) / 100;
  const currency = (response.currency ?? prices.currency).toUpperCase();

  rememberCheckoutAttribution({
    checkout_session_id: response.checkout_session_id,
    plan_code: response.plan_code,
    plan_name: response.plan_name,
    trial_applied: response.trial_applied,
    trial_period_days: response.trial_period_days,
    value,
    currency
  });

  trackPaymentStarted({
    source: options?.source ?? "stripe_checkout",
    plan_code: response.plan_code,
    plan_name: response.plan_name,
    trial_applied: response.trial_applied,
    trial_period_days: response.trial_period_days,
    value,
    currency
  });

  // Browser Back from Stripe must land where Stripe's own back link does: swap the
  // page that started checkout for the cancel page, and reload if the browser restores
  // the frozen "Opening secure checkout…" page from its back-forward cache.
  window.history.replaceState(window.history.state, "", checkoutInput.cancel_url);
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); }, { once: true });
  window.location.href = response.checkout_url;
}
