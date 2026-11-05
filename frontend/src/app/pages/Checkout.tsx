import { CheckoutConfirming, CheckoutLoading, CheckoutScreen, CheckoutWelcome } from "../components/CheckoutScreen";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ApiClientError } from "../integration/api-error";
import { trackFunnelEvent } from "../integration/funnel-events";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { clearPendingCheckout, setPendingCheckout } from "../integration/pending-checkout";
import { checkoutChoice, checkoutPath, checkoutSource, hasAppAccess, hasBillingIssue, pricingPath, resolveReturnPath, safeReturnPath } from "../integration/subscription-flow";
import { useRegionalPricing } from "../integration/regional-pricing";
import type { BillingPlanResponseData } from "../integration/api-types";
import { checkoutKey, checkoutScreen, type CheckoutChoice } from "../integration/checkout-screen";
import { translate as t } from "../localization/i18n";
import {
  checkoutPromotionToken, forgetPromotion, isFinalPromotionDetail, promotionPlanPrice, promotionUnavailableDetail,
  readStoredPromotion, type PromotionUnavailableDetail,
} from "../integration/promotion-offer";
import {
  readCheckoutAttribution, clearCheckoutAttribution, paymentCompletedTrackingKey,
  hasTrackedPaymentCompleted, markPaymentCompletedTracked, trackPaymentCompleted, trackEvent,
} from "../integration/analytics";
import { trackTrialStarted } from "../integration/advertising";

// A confirmed Stripe session is counted once per page load, whatever re-renders the return.
const countedSessions = new Set<string>();

// The welcome shows once per Stripe session: a refresh of the return goes straight to the task.
function takeWelcome(sessionId: string): boolean {
  const key = `cv-builder:checkout-welcome:${sessionId}`;
  try {
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch { /* Without storage the welcome may show again on refresh. */ }
  return true;
}

export function Checkout() {
  const { api, me, refreshMe, signOut } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // An old plan=weekly&trial=1 link, bookmark or Stripe return opens the Monthly trial ("trial wins").
  const { plan, withTrial: trial } = checkoutChoice(params);
  const destination = resolveReturnPath(safeReturnPath(params.get("next")), me);
  const source = checkoutSource(params.get("source"));
  const outcome = params.get("checkout");
  const sessionId = params.get("session_id");
  const auto = params.get("auto") === "1";
  const automaticHandoff = auto && !outcome;
  const regional = useRegionalPricing();
  const [eligibility, setEligibility] = useState<boolean | null>(null);
  const [portal, setPortal] = useState<"payment" | "manage" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [handoffDelayed, setHandoffDelayed] = useState(false);
  const [welcome, setWelcome] = useState<BillingPlanResponseData | null>(null);
  // Checkout refused the emailed offer; later attempts from this screen go at the regular price.
  const [promotionIssue, setPromotionIssue] = useState<PromotionUnavailableDetail | null>(null);
  // This tab's active offer, to show its first-month price; the token itself is read per attempt.
  const promotionApplies = useMemo(() => !promotionIssue && Boolean(checkoutPromotionToken(plan, trial)), [plan, trial, promotionIssue]);
  const regionalPrices = regional.prices;
  const promotion = useMemo(() => {
    if (!promotionApplies) return null;
    const list = regionalPrices?.plans.find(item => item.code === plan);
    return promotionPlanPrice(readStoredPromotion()?.offer, plan, Date.now(), list && regionalPrices ? { amount: list.amount, currency: regionalPrices.currency } : null);
  }, [plan, promotionApplies, regionalPrices]);
  // Set before the welcome renders, so a re-run of the confirm effect (refreshMe can change the destination) leaves it on screen.
  const welcomed = useRef(false);
  const started = useRef(false);
  const counted = useRef(new Set<string>());

  useEffect(() => {
    setHandoffDelayed(false);
    if (!automaticHandoff) return;
    // Show recovery controls if a slow request prevents the automatic handoff.
    const timer = window.setTimeout(() => setHandoffDelayed(true), 8000);
    return () => window.clearTimeout(timer);
  }, [automaticHandoff, plan, trial, destination]);

  useEffect(() => {
    if (welcomed.current) return;
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
            // Google Ads conversion: a verified free-trial start only, once per Checkout Session.
            try { if (billing.subscription_status === "trialing") trackTrialStarted(sessionId); }
            catch { /* Ad measurement cannot prevent activation or restore. */ }
          }
          if (outcome === "success" && sessionId && !countedSessions.has(sessionId)) {
            countedSessions.add(sessionId);
            trackFunnelEvent("checkout_success", billing.subscription_status === "trialing" ? "trial" : "pro");
          }
          clearPendingCheckout();
          forgetPromotion();
          await refreshMe();
          if (!active) return;
          if (outcome === "success" && sessionId && takeWelcome(sessionId)) {
            welcomed.current = true;
            setWelcome(billing);
            return;
          }
          navigate(destination, { replace: true });
          return;
        }
        setPortal(hasBillingIssue(billing) ? "payment" : null);
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
    // Only the plan the emailed offer covers carries its token, and never after checkout refused it.
    const promotionToken = promotionIssue ? null : checkoutPromotionToken(target.plan, target.withTrial);
    setPendingCheckout({ plan_code: target.plan, with_trial: target.withTrial, return_path: destination, ...(promotionToken ? { promotion_token: promotionToken } : {}) });
    try { await startStripeCheckout(api, target.plan, { withTrial: target.withTrial, source: "subscription_activation", returnPath: destination, paywallSource: source, promotionToken }); }
    catch (err) {
      const detail = promotionUnavailableDetail(err);
      // Stripe already has a subscription for this account: it is managed in the portal.
      if (err instanceof ApiClientError && err.details?.reason === "subscription_active") setPortal(err.details.billing_issue ? "payment" : "manage");
      else if (detail) {
        trackEvent("promotion_unavailable", { promotion_status: detail, plan_code: target.plan });
        setPromotionIssue(detail);
        if (isFinalPromotionDetail(detail)) {
          forgetPromotion();
          setPendingCheckout({ plan_code: target.plan, with_trial: target.withTrial, return_path: destination });
        }
      }
      else setError(err instanceof Error ? err.message : t("Checkout could not be opened."));
      setOpening(null);
    }
  }, [api, plan, trial, destination, eligibility, source, promotionIssue]);

  // The offer belongs to another account: sign out, then come back to this checkout signed in as the
  // emailed account. The pending checkout keeps the token for that account.
  const switchAccount = useCallback(async () => {
    setOpening("switch_account");
    const from = checkoutPath({ plan_code: plan, with_trial: false, return_path: destination, source, auto: true });
    try { await signOut(); } finally { navigate("/signin", { replace: true, state: { from } }); }
  }, [signOut, navigate, plan, destination, source]);

  const openPortal = useCallback(async () => {
    setOpening("portal"); setError(null);
    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}${checkoutPath({ plan_code: plan, with_trial: trial, return_path: destination, source })}`,
        ...(portal === "payment" ? { flow: "payment_method" as const } : {})
      });
      window.location.href = response.portal_url;
    } catch (err) { setError(err instanceof Error ? err.message : t("Failed to open billing portal.")); setOpening(null); }
  }, [api, plan, trial, destination, source, portal]);
  useEffect(() => {
    if (auto && !outcome && !portal && !started.current && eligibility !== null && regional.ready && !error && (!trial || eligibility)) {
      started.current = true;
      void openCheckout();
    }
  }, [auto, outcome, portal, eligibility, regional.ready, openCheckout, trial, error]);

  // Paid CTA/auth returns are a background handoff, not another purchase step.
  // Retain the screen for deliberate trial activation, cancellation and recovery.
  const hidden = automaticHandoff && !handoffDelayed && !error && !portal && !promotionIssue && !regional.error &&
      (regional.loading || regional.ready) && (!trial || eligibility !== false);
  const view = outcome === "cancel" ? "cancel" : "start";
  const screen = checkoutScreen({ outcome: view, plan, trial, eligibility, error: Boolean(error), source, portal, promotionIssue, promotion: promotionApplies });
  const showsScreen = !hidden && outcome !== "success" && (eligibility !== null || Boolean(error));
  const viewDetail = screen.offer === "trial" ? "trial" : "pro";
  // Once per visit. A cancel return is counted as checkout_canceled, not as another view.
  useEffect(() => {
    const key = outcome === "cancel" ? "canceled" : `view:${viewDetail}`;
    if (counted.current.has(key) || (outcome !== "cancel" && (!showsScreen || screen.offer === "none"))) return;
    counted.current.add(key);
    if (outcome === "cancel") trackFunnelEvent("checkout_canceled");
    else trackFunnelEvent("checkout_view", viewDetail);
  }, [outcome, showsScreen, screen.offer, viewDetail]);

  if (hidden) return null;
  if (welcome) return <CheckoutWelcome billing={welcome} regional={regional} source={source} destination={destination}
    onContinue={() => navigate(destination, { replace: true })} />;
  if (outcome === "success") return <CheckoutConfirming busy={confirming} error={error} onRetry={() => setAttempt(value => value + 1)} />;
  if (eligibility === null && !error) return <CheckoutLoading />;
  return <CheckoutScreen screen={screen} outcome={view} regional={regional} eligibility={eligibility} opening={opening} error={error}
    plansPath={pricingPath({ return_path: destination, source })}
    onCheckout={action => void openCheckout(action)} onPortal={() => void openPortal()}
    onSwitchAccount={() => void switchAccount()} promotion={promotion} />;
}
