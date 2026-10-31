import { CheckoutConfirming, CheckoutLoading, CheckoutScreen } from "../components/CheckoutScreen";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { isCheckoutTarget } from "../../content/pricing";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { clearPendingCheckout, setPendingCheckout } from "../integration/pending-checkout";
import { hasAppAccess, safeReturnPath } from "../integration/subscription-flow";
import { useRegionalPricing } from "../integration/regional-pricing";
import { checkoutKey, checkoutScreen, type CheckoutChoice } from "../integration/checkout-screen";
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
  const [eligibility, setEligibility] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
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
    if (outcome === "success") setConfirming(true);
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
      } finally { if (active) setConfirming(false); }
    })();
    return () => { active = false; };
  }, [api, refreshMe, navigate, destination, outcome, sessionId, attempt, plan, trial]);

  useEffect(() => { started.current = false; }, [plan, trial]);

  const openCheckout = useCallback(async (target: CheckoutChoice = { plan, withTrial: trial }) => {
    if (target.withTrial && eligibility !== true) return;
    setOpening(checkoutKey(target)); setError(null);
    setPendingCheckout({ plan_code: target.plan, with_trial: target.withTrial, return_path: destination });
    try { await startStripeCheckout(api, target.plan, { withTrial: target.withTrial, source: "subscription_activation", returnPath: destination }); }
    catch (err) { setError(err instanceof Error ? err.message : t("Checkout could not be opened.")); setOpening(null); }
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

  if (outcome === "success") return <CheckoutConfirming busy={confirming} error={error} onRetry={() => setAttempt(value => value + 1)} />;
  if (eligibility === null && !error) return <CheckoutLoading />;
  const view = outcome === "cancel" ? "cancel" : "start";
  return <CheckoutScreen screen={checkoutScreen({ outcome: view, plan, trial, eligibility, error: Boolean(error) })} outcome={view}
    regional={regional} eligibility={eligibility} opening={opening} error={error} onCheckout={action => void openCheckout(action)} />;
}
