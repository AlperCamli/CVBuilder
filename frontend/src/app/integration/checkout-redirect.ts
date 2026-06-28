import type { CheckoutTarget } from "../../content/pricing";
import { PLAN_VALUE_USD } from "../../content/pricing";
import type { BackendApi } from "./backend-api";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";

// Creates a Stripe Checkout session for the given plan and sends the browser to
// it. Shared by the in-app pricing page, the public pricing page, and the
// post-signup checkout resumer so the success/cancel URLs and the trial opt-out
// stay consistent across every entry point.
export async function startStripeCheckout(
  api: BackendApi,
  plan: CheckoutTarget,
  options?: { withTrial?: boolean; source?: string }
): Promise<void> {
  const base = window.location.origin;
  const response = await api.createBillingCheckout({
    plan_code: plan,
    success_url: `${base}/app/pricing?checkout=success`,
    cancel_url: `${base}/app/pricing?checkout=cancel`,
    ...(plan === "weekly" && options?.withTrial === false ? { with_trial: false } : {})
  });

  const value =
    response.plan_code === "weekly" && response.trial_applied
      ? 0
      : PLAN_VALUE_USD[response.plan_code as CheckoutTarget];
  const currency = value !== undefined ? "USD" : undefined;

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

  window.location.href = response.checkout_url;
}
