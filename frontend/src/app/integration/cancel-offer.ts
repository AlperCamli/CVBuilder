import type { BackendApi } from "./backend-api";
import type { CancelOffer } from "./api-types";
import { planDate } from "./checkout-screen";
import { rememberCheckoutAttribution, trackPaymentStarted } from "./analytics";
import { trackFunnelEvent } from "./funnel-events";
import { formatMoney } from "./regional-pricing";
import { checkoutPath } from "./subscription-flow";

// What the cancel screen prints, and the Stripe Checkout behind a trial's "Keep Pro". Copy stays in the component;
// this only formats the server's numbers and dates.

const PLAN_NAME: Record<CancelOffer["plan_code"], string> = { weekly: "Weekly", monthly: "Monthly", annual: "Yearly" };
// The noun used in "every {{period}}" / "your next {{period}}".
const PERIOD: Record<CancelOffer["plan_code"], string> = { weekly: "week", monthly: "month", annual: "year" };

export const planName = (plan: CancelOffer["plan_code"]): string => PLAN_NAME[plan];
export const planPeriod = (plan: CancelOffer["plan_code"]): string => PERIOD[plan];

export interface CancelOfferView {
  percent: number;
  planName: string;
  currentPlanName: string;
  /** The offered plan's billing period, e.g. "month". */
  period: string;
  /** The offered plan's list price, charged after the discounted one. */
  price: string;
  /** The discounted charge. */
  firstCharge: string;
  /** The end of the current trial or paid period ("November 5"). */
  periodEnd: string;
  /** When the discounted charge is made: today for a trial's checkout, else the period end. */
  chargeDate: string;
  /** When the full price is charged next: one billing period after the discounted charge. */
  nextDate: string;
  /** Only when the discounted month costs no more than about one week of the current weekly plan. */
  weekComparison: boolean;
}

const addPeriod = (from: Date, plan: CancelOffer["plan_code"]): Date => {
  const date = new Date(from);
  if (plan === "weekly") date.setDate(date.getDate() + 7);
  else if (plan === "monthly") date.setMonth(date.getMonth() + 1);
  else date.setFullYear(date.getFullYear() + 1);
  return date;
};

export function cancelOfferView(offer: CancelOffer, locale: string, now = new Date()): CancelOfferView {
  const weekly = offer.current_plan_code === "weekly" ? offer.current_amount : null;
  const charge = offer.kind === "checkout" ? now : new Date(offer.period_end);
  return {
    percent: offer.percent_off,
    planName: PLAN_NAME[offer.plan_code],
    currentPlanName: PLAN_NAME[offer.current_plan_code],
    period: PERIOD[offer.plan_code],
    price: formatMoney(offer.amount, offer.currency),
    firstCharge: formatMoney(offer.discounted_amount, offer.currency),
    periodEnd: planDate(offer.period_end, locale) ?? "",
    chargeDate: planDate(charge.toISOString(), locale) ?? "",
    nextDate: planDate(addPeriod(charge, offer.plan_code).toISOString(), locale) ?? "",
    weekComparison: offer.plan_code === "monthly" && weekly !== null && offer.discounted_amount <= weekly * 1.05,
  };
}

export const CANCEL_PATH = "/app/cancel";
/** Where Stripe returns: the checkout page confirms the payment and shows the Pro welcome; Back returns to the offer. */
export const CANCEL_OFFER_RETURN = `${CANCEL_PATH}?checkout=cancel`;

/** Opens the offer's Stripe Checkout, like startStripeCheckout does for the pricing page. */
export async function startCancelOfferCheckout(api: BackendApi, offer: CancelOffer): Promise<void> {
  const base = window.location.origin;
  const cancelUrl = `${base}${CANCEL_OFFER_RETURN}`;
  const response = await api.createCancelOfferCheckout({
    success_url: `${base}${checkoutPath({ plan_code: offer.plan_code, with_trial: false, return_path: "/app" })}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
  });
  const attribution = {
    checkout_session_id: response.checkout_session_id,
    plan_code: offer.plan_code,
    plan_name: PLAN_NAME[offer.plan_code],
    trial_applied: false,
    trial_period_days: null,
    value: response.amount_due / 100,
    currency: response.currency.toUpperCase(),
    promotion_slug: offer.slug,
  };
  rememberCheckoutAttribution(attribution);
  trackPaymentStarted({ source: "cancel_offer", ...attribution });
  trackFunnelEvent("checkout_redirect", "pro");
  // Browser Back from Stripe lands on the offer again, as Stripe's own back link does.
  window.history.replaceState(window.history.state, "", cancelUrl);
  window.addEventListener("pageshow", event => { if (event.persisted) window.location.reload(); }, { once: true });
  window.location.href = response.checkout_url;
}
