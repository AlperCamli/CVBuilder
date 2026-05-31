import type { CheckoutTarget } from "../../content/pricing";
import type { BackendApi } from "./backend-api";

// Creates a Stripe Checkout session for the given plan and sends the browser to
// it. Shared by the in-app pricing page, the public pricing page, and the
// post-signup checkout resumer so the success/cancel URLs and the trial opt-out
// stay consistent across every entry point.
export async function startStripeCheckout(
  api: BackendApi,
  plan: CheckoutTarget,
  options?: { withTrial?: boolean }
): Promise<void> {
  const base = window.location.origin;
  const response = await api.createBillingCheckout({
    plan_code: plan,
    success_url: `${base}/app/pricing?checkout=success`,
    cancel_url: `${base}/app/pricing?checkout=cancel`,
    ...(plan === "pro" && options?.withTrial === false ? { with_trial: false } : {})
  });

  window.location.href = response.checkout_url;
}
