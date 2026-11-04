import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CancelBenefitsScreen, CancelOfferAccepted, CancelOfferScreen, CancelTrialRedirect } from "../components/CancelOfferScreen";
import { CheckoutLoading } from "../components/CheckoutScreen";
import { ApiClientError } from "../integration/api-error";
import type { BillingPlanResponseData, CancelOffer, CancelOfferResponseData } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { startCancelOfferCheckout } from "../integration/cancel-offer";
import { planDate } from "../integration/checkout-screen";
import { localeCode } from "../localization/i18n";

const OFFER_FAILED = "We couldn’t open the secure checkout. Nothing has changed and you haven’t been charged. Try again, or continue to cancel.";
const APPLY_FAILED = "We couldn’t apply the offer. Nothing has changed and you haven’t been charged. Try again, or continue to cancel.";
const OFFER_GONE = "This offer is no longer available. You can still cancel below.";
const PORTAL_FAILED = "We couldn’t open the cancellation. Please try again.";

type View =
  | { kind: "loading" }
  | { kind: "offer"; offer: CancelOffer }
  | { kind: "accepted"; offer: CancelOffer }
  | { kind: "benefits"; plan: BillingPlanResponseData }
  | { kind: "redirect" };

const PURCHASE_PLANS = ["weekly", "monthly", "annual"] as const;

/**
 * "Cancel" in Profile lands here, for a trial or a paid weekly, monthly or annual plan. This is the one screen
 * before Stripe's cancellation: the plan's one-time offer, or, without one, what Pro includes. If nothing can be
 * loaded it goes straight on to Stripe, so cancelling never depends on this screen.
 * A trial's offer pays at Stripe Checkout (success returns to the checkout page, which shows the Pro welcome; Stripe's
 * back link returns here with ?checkout=cancel). A paid plan's offer is applied in place, with nothing charged now.
 */
export function CancelSubscription() {
  const { api, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returned = params.get("checkout") === "cancel";
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState<"accept" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerGone, setOfferGone] = useState(false);
  const started = useRef(false);

  const openCancellation = useCallback(async () => {
    setBusy("cancel");
    setError(null);
    try {
      const response = await api.createBillingPortal({ return_url: `${window.location.origin}/app/profile`, flow: "cancel" });
      window.location.href = response.portal_url;
    } catch {
      setBusy(null);
      setError(PORTAL_FAILED);
    }
  }, [api]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let response: CancelOfferResponseData | null = null;
      try { response = await api.getCancelOffer(); } catch { /* No offer: the plain screen, or straight on to Stripe. */ }
      if (response?.status === "available") { setView({ kind: "offer", offer: response.offer }); return; }
      let plan: BillingPlanResponseData | null = null;
      try { plan = await api.getBillingPlan(); } catch { /* The cancellation itself reports a missing subscription. */ }
      if (!plan) { setView({ kind: "redirect" }); await openCancellation(); return; }
      // Already set to end, or nothing to cancel: Profile shows the current state.
      if (plan.cancel_at_period_end || !["trialing", "active"].includes(plan.subscription_status)) {
        navigate("/app/profile", { replace: true });
        return;
      }
      setView({ kind: "benefits", plan });
    })();
  }, [api, navigate, openCancellation]);

  const accept = async (offer: CancelOffer) => {
    setBusy("accept");
    setError(null);
    try {
      if (offer.kind === "checkout") {
        // Navigates to Stripe; the button stays busy until the page unloads.
        await startCancelOfferCheckout(api, offer);
        return;
      }
      const result = await api.acceptCancelOffer();
      setView({ kind: "accepted", offer: result.offer });
      setBusy(null);
      void refreshMe();
    } catch (err) {
      const gone = err instanceof ApiClientError && err.details?.reason === "cancel_offer_unavailable";
      setOfferGone(gone);
      setError(gone ? OFFER_GONE : offer.kind === "checkout" ? OFFER_FAILED : APPLY_FAILED);
      setBusy(null);
    }
  };

  if (view.kind === "loading") return <CheckoutLoading />;
  if (view.kind === "redirect") return <CancelTrialRedirect error={error} onRetry={() => void openCancellation()} />;
  if (view.kind === "accepted") return <CancelOfferAccepted offer={view.offer} onContinue={() => navigate("/app")} />;
  if (view.kind === "benefits") {
    const planCode = PURCHASE_PLANS.find(code => code === view.plan.plan_code) ?? null;
    return <CancelBenefitsScreen trial={view.plan.subscription_status === "trialing"} planCode={planCode}
      periodEnd={planDate(view.plan.current_period_end, localeCode())} busy={busy === "cancel" ? "cancel" : null} error={error}
      onKeep={() => navigate("/app")} onCancel={() => void openCancellation()} />;
  }
  const offer = view.offer;
  return <CancelOfferScreen offer={offer} busy={busy} error={error} offerGone={offerGone} returned={returned}
    onAccept={() => void accept(offer)} onCancel={() => void openCancellation()} />;
}
