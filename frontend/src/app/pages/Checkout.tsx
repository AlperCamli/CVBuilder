import { SupportHelp } from "../components/SupportHelp";
import { CheckoutCancelled } from "../components/CheckoutCancelled";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Loader2, CreditCard } from "lucide-react";
import { isCheckoutTarget } from "../../content/pricing";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { clearPendingCheckout, setPendingCheckout } from "../integration/pending-checkout";
import { checkoutPath, hasAppAccess, safeReturnPath } from "../integration/subscription-flow";
import { useRegionalPricing, formatMoney } from "../integration/regional-pricing";
import { PricingAvailability } from "../components/PricingAvailability";
import { translate as t } from "../localization/i18n";
import {
  readCheckoutAttribution, clearCheckoutAttribution, paymentCompletedTrackingKey,
  hasTrackedPaymentCompleted, markPaymentCompletedTracked, trackPaymentCompleted, trackEvent,
} from "../integration/analytics";

export function Checkout() {
  const { api, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planParam = params.get("plan");
  const plan = isCheckoutTarget(planParam) ? planParam : "weekly";
  const trial = plan === "weekly" && params.get("trial") !== "0";
  const destination = safeReturnPath(params.get("next"));
  const outcome = params.get("checkout");
  const sessionId = params.get("session_id");
  const auto = params.get("auto") === "1";
  const automaticHandoff = auto && !outcome;
  const regional = useRegionalPricing();
  const price = regional.prices?.plans.find(item => item.code === plan);
  const [eligibility, setEligibility] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [handoffDelayed, setHandoffDelayed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    setHandoffDelayed(false);
    if (!automaticHandoff) return;
    // Show recovery controls if a slow request prevents the automatic handoff.
    const timer = window.setTimeout(() => setHandoffDelayed(true), 8000);
    return () => window.clearTimeout(timer);
  }, [automaticHandoff, plan, trial, destination]);

  useEffect(() => {
    let active = true;
    setError(null);
    setEligibility(null);
    if (outcome === "success") setBusy(true);
    void (async () => {
      try {
        // A success query is not proof of payment. Confirm ownership/status at Stripe.
        const billing = outcome === "success" && sessionId
          ? await api.confirmBillingCheckout(sessionId) : await api.getBillingPlan();
        if (!active) return;
        if (hasAppAccess(billing)) {
          if (outcome === "success" && sessionId) {
            // Marketing tracking is optional and must never interrupt the return.
            try {
              const stored = readCheckoutAttribution();
              const attribution = stored?.checkout_session_id === sessionId ? stored : null;
              const key = paymentCompletedTrackingKey({ checkout_session_id: sessionId });
              if (!hasTrackedPaymentCompleted(key)) {
                const event = { ...attribution, plan_code: billing.plan_code, source: "verified_checkout_return" };
                if (billing.subscription_status === "trialing") trackEvent("trial_activated", event);
                else trackPaymentCompleted(event);
                markPaymentCompletedTracked(key);
              }
              clearCheckoutAttribution();
            } catch { /* Analytics cannot prevent activation or restore. */ }
          }
          clearPendingCheckout();
          await refreshMe();
          if (active) navigate(destination, { replace: true });
          return;
        }
        setEligibility(billing.trial_eligible);
        if (outcome === "success") throw new Error(t("Your subscription is not active yet. Please try confirming again."));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : t("Could not verify your subscription."));
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [api, refreshMe, navigate, destination, outcome, sessionId, attempt, plan, trial]);

  useEffect(() => { started.current = false; }, [plan, trial]);

  const openCheckout = useCallback(async () => {
    if (trial && eligibility !== true) return;
    setBusy(true); setError(null);
    setPendingCheckout({ plan_code: plan, with_trial: trial, return_path: destination });
    try { await startStripeCheckout(api, plan, { withTrial: trial, source: "subscription_activation", returnPath: destination }); }
    catch (err) { setError(err instanceof Error ? err.message : t("Checkout could not be opened.")); setBusy(false); }
  }, [api, plan, trial, destination, eligibility]);
  useEffect(() => {
    if (auto && !outcome && !started.current && eligibility !== null && regional.ready && !error && (!trial || eligibility)) {
      started.current = true;
      void openCheckout();
    }
  }, [auto, outcome, eligibility, regional.ready, openCheckout, trial, error]);

  // Paid CTA/auth returns are a background handoff, not another purchase step.
  // Retain the screen for deliberate trial activation, cancellation and recovery.
  if (automaticHandoff && !handoffDelayed && !error && !regional.error &&
      (regional.loading || regional.ready) && (!trial || eligibility !== false)) return null;

  if (outcome === "cancel") return <CheckoutCancelled plan={plan} trial={trial} eligibility={eligibility} destination={destination} regional={regional} busy={busy} error={error} onRetry={() => void openCheckout()} />;

  return <div className="mx-auto max-w-lg px-6 py-14">
    <CreditCard className="mb-4 text-teal-700" size={32} />
    <h1 className="text-2xl font-semibold mb-3">{t(outcome === "success" ? "Confirming your subscription" : trial ? "Activate your 3-day free trial" : "Complete your Pro purchase")}</h1>
    <p className="mb-5 text-sm text-slate-600">{t("Your CV and selected next step are saved. We will take you back automatically after activation.")}</p>
    <PricingAvailability {...regional} />
    {price && <div className="rounded-xl border p-5 mb-5">
      <strong>{trial ? t("3 days free, then Weekly Pro") : t("Pro {{plan}}", { plan: t(plan === "annual" ? "Yearly" : plan === "monthly" ? "Monthly" : "Weekly") })}</strong>
      <p className="mt-2">{trial ? `${formatMoney(0, regional.prices!.currency)} ${t("today")}. ` : ""}{formatMoney(price.amount, regional.prices!.currency)} {t(plan === "annual" ? "billed yearly" : plan === "monthly" ? "billed monthly" : "billed weekly")}</p>
      <p className="mt-2 text-sm">{t(trial ? "Credit card required. Renews weekly after 3 days unless cancelled before the trial ends." : "Your subscription renews automatically. You can manage or cancel it in billing settings.")}</p>
    </div>}
    {error && <p role="alert" className="mb-4 text-red-700">{t(error)}</p>}
    {(error || regional.error) && <SupportHelp topic="Payment" />}
    {trial && eligibility === false && <p role="status" className="mb-4">{t("This account is not eligible for another free trial. Choose a Pro plan to continue.")}</p>}
    {outcome === "success" ? <button className="interactive-button rounded-lg bg-teal-700 text-white px-5 py-3" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{busy ? t("Confirming…") : t("Check activation again")}</button> :
      <button className="interactive-button rounded-lg bg-teal-700 text-white px-5 py-3 inline-flex gap-2 items-center" disabled={busy || !regional.ready || eligibility === null || (trial && !eligibility)} onClick={() => void openCheckout()}>
        {busy && <Loader2 className="animate-spin" size={16} />}{t(busy ? "Opening secure checkout…" : trial ? "Activate 3-day free trial" : "Continue to secure checkout")}
      </button>}
    {!trial && error && eligibility !== false && <div className="mt-5"><p className="mb-2">{t("Having trouble purchasing? Try Pro with a 3-day free trial instead.")}</p><Link className="underline text-teal-700" to={checkoutPath({ with_trial: true, return_path: destination })}>{t("Start Free Trial")}</Link></div>}
    <p className="mt-6"><Link to="/app/pricing" className="text-sm underline">{t("See Pro plans")}</Link></p>
  </div>;
}
