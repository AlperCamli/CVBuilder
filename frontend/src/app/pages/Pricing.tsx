import { checkoutPath, checkoutSource, hasAppAccess, hasBillingIssue, pricingPath, restartCheckoutPath, safeReturnPath } from "../integration/subscription-flow";
import { SupportHelp } from "../components/SupportHelp";
import { formatMoney, useRegionalPricing } from "../integration/regional-pricing";
import { PricingAvailability } from "../components/PricingAvailability";
import { PromotionBanner } from "../components/PromotionBanner";
import { usePromotionOffer } from "../integration/promotion-offer";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { BillingPlanResponseData, EntitlementSummary, UsageSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import {
  clearCheckoutAttribution,
  hasTrackedPaymentCompleted,
  markPaymentCompletedTracked,
  paymentCompletedTrackingKey,
  readCheckoutAttribution,
  trackPaymentCompleted
} from "../integration/analytics";
import { isLegacyPaidPlanCode, isPaidPlanCode, trialPlanCode, type CheckoutTarget, type PlanCard } from "../../content/pricing";

const formatTrialEnd = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

type PlanChangeTarget = "weekly" | "monthly" | "annual";
const PLAN_RANK: Record<PlanChangeTarget, number> = { weekly: 1, monthly: 2, annual: 3 };
const isPlanChangeTarget = (code: string): code is PlanChangeTarget => code in PLAN_RANK;

export function Pricing() {
  const regional = useRegionalPricing();
  // An emailed ?promo= offer (or this tab's remembered one); checkout reads its token.
  const promo = usePromotionOffer();
  useTranslation();
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState<CheckoutTarget | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<BillingPlanResponseData | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);
  const paymentCompletedTrackedRef = useRef(false);
  // Opened from a paywall's checkout: purchases return to its next step (Checkout sends
  // onboarded accounts to the app when there is none).
  const query = new URLSearchParams(location.search);
  const nextParam = query.get("next");
  const returnPath = safeReturnPath(nextParam);
  const source = checkoutSource(query.get("source"));

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [planResponse, usageResponse, entitlementResponse] = await Promise.all([
          api.getBillingPlan(),
          api.getBillingUsage(),
          api.getBillingEntitlements()
        ]);

        if (cancelled) return;

        setPlan(planResponse);
        setUsage(usageResponse);
        setEntitlements(entitlementResponse);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError || err instanceof Error) {
          setError(err.message);
        } else {
          setError(t("Failed to load billing details."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const startCheckout = async (target: CheckoutTarget) => {
    setBusyTarget(target);
    setError(null);
    try {
      navigate(checkoutPath({ plan_code: target, with_trial: false, return_path: returnPath, source, auto: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to open checkout."));
      setBusyTarget(null);
    }
  };

  const openPortal = async (flow?: "payment_method" | "change_plan", planCode?: PlanChangeTarget) => {
    setBusyTarget("portal");
    setError(null);
    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}${pricingPath({ return_path: nextParam ?? undefined, source })}`,
        ...(flow ? { flow } : {}),
        ...(flow === "change_plan" && planCode ? { plan_code: planCode } : {})
      });
      window.location.href = response.portal_url;
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === "VALIDATION_ERROR" &&
        err.details?.reason === "provider_customer_not_found"
      ) {
        // The Stripe customer is gone: start again at checkout, with the trial while this account can start one.
        navigate(restartCheckoutPath({ trial_eligible: trialEligible, plan_code: planCode ?? (isPlanChangeTarget(currentPlanCode) ? currentPlanCode : null), return_path: returnPath, source }));
        return;
      }

      setError(err instanceof Error ? err.message : t("Failed to open billing portal."));
      setBusyTarget(null);
    }
  };

  const currentPlanCode = plan?.plan_code ?? "free";
  const subscriptionStatus = plan?.subscription_status ?? "inactive";
  const isTrialing = subscriptionStatus === "trialing";
  const isLegacyPaidPlan = isLegacyPaidPlanCode(currentPlanCode);
  const hasPaidPlan = isPaidPlanCode(currentPlanCode);
  const billingIssue = hasBillingIssue(plan);
  // Default to eligible only until the plan loads, to avoid flashing the wrong
  // trial CTA; once loaded this reflects the backend's authoritative decision.
  const trialEligible = plan?.trial_eligible ?? true;
  // The plan card that carries the free trial (Monthly), for an account that can still start one.
  const trialPlan = trialPlanCode(regional.prices);
  const offersTrialOn = (code: PlanCard["code"]) =>
    code === trialPlan && trialEligible && !hasPaidPlan && !billingIssue && !promo.covers(code);
  const trialEnd = useMemo(() => formatTrialEnd(plan?.current_period_end ?? null), [plan]);
  const checkoutState = new URLSearchParams(location.search).get("checkout");

  useEffect(() => {
    if (checkoutState !== "success" || paymentCompletedTrackedRef.current) {
      return;
    }

    const attribution = readCheckoutAttribution();
    const trackingKey = paymentCompletedTrackingKey(attribution);
    paymentCompletedTrackedRef.current = true;

    if (hasTrackedPaymentCompleted(trackingKey)) {
      clearCheckoutAttribution();
      return;
    }

    trackPaymentCompleted({
      source: "stripe_success_return",
      plan_code: attribution?.plan_code,
      plan_name: attribution?.plan_name,
      trial_applied: attribution?.trial_applied,
      trial_period_days: attribution?.trial_period_days,
      value: attribution?.value,
      currency: attribution?.currency
    });

    markPaymentCompletedTracked(trackingKey);
    clearCheckoutAttribution();
  }, [checkoutState]);

  const resolveCta = (card: PlanCard): { label: string; disabled: boolean; onClick?: () => void } => {
    if (card.code === "trial") {
      return {
        label: hasPaidPlan || billingIssue ? "Included in your subscription" : trialEligible ? "Start Free Trial" : "Trial already used",
        disabled: hasPaidPlan || billingIssue || !trialEligible,
        onClick: () => navigate(checkoutPath({ with_trial: true, return_path: returnPath, source }))
      };
    }

    if (currentPlanCode === card.code) {
      return {
        label: isTrialing ? "Manage trial" : "Manage billing",
        disabled: false,
        onClick: () => void openPortal()
      };
    }

    if (isLegacyPaidPlan) {
      return { label: "Included in your legacy plan", disabled: true };
    }

    // The trial plan's card starts the trial, as the trial card does: never a charge under a trial badge.
    if (offersTrialOn(card.code)) {
      return { label: "Start Free Trial", disabled: false, onClick: () => navigate(checkoutPath({ with_trial: true, return_path: returnPath, source })) };
    }

    return {
      label:
        t("Choose {{plan}}", { plan: card.name }),
      disabled: false,
      onClick: () => {
        if (billingIssue) void openPortal("payment_method");
        // A paying account changes its plan: an upgrade (or any change in a trial) is confirmed at Stripe with the
        // amount due today; a downgrade, or any choice while a change is waiting, goes to the change-plan page.
        else if (hasPaidPlan && isPlanChangeTarget(card.code) && isPlanChangeTarget(currentPlanCode)) {
          if (!plan?.scheduled_change && (isTrialing || PLAN_RANK[card.code] > PLAN_RANK[currentPlanCode])) void openPortal("change_plan", card.code);
          else navigate(`/app/change-plan?plan=${card.code}`);
        }
        else if (hasPaidPlan) void openPortal();
        else void startCheckout(card.code as CheckoutTarget);
      }
    };
  };

  return (
    <div className="p-8">
      {nextParam && (
        <Link to={checkoutPath({ with_trial: true, return_path: returnPath, source })} className="max-w-7xl mx-auto mb-4 flex items-center gap-1.5"
          style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          <ArrowLeft size={13} aria-hidden="true" />{t("Back")}
        </Link>
      )}
      <PromotionBanner promo={promo} layout="card" />
      <div className="max-w-4xl mx-auto text-center mb-10">
        <h1 className="font-medium mb-3" style={{ fontSize: "28px", color: "var(--color-text-primary)" }}>
          {t("Choose your plan")}</h1>
        <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
          {hasPaidPlan
            ? t("You have unlimited access to job-specific CVs, exports, AI rewrites, cover letters, and job tracking.")
            : t("Pick a plan by weekly price. Monthly starts with a 3-day free trial; weekly is billed weekly with no trial, and annual has the lowest weekly equivalent.")}
        </p>
      </div>

      {loading && (
        <p className="text-center" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {t("Loading billing details...")}</p>
      )}

      {isTrialing && trialEnd && (
        <div
          className="max-w-3xl mx-auto mb-6 p-4 rounded-lg border flex items-center gap-3"
          style={{ borderColor: "var(--color-teal-200)", background: "var(--color-teal-50)" }}
        >
          <Sparkles size={16} style={{ color: "var(--color-teal-600)" }} />
          <span style={{ fontSize: "13px", color: "var(--color-teal-800)" }}>
            {t("You're on a free trial. Your first charge is on")}{" "}<strong>{trialEnd}</strong>{t(". Cancel any time before then in the billing portal.")}</span>
        </div>
      )}

      {billingIssue && (
        <div
          className="max-w-3xl mx-auto mb-6 p-4 rounded-lg border flex flex-wrap items-center gap-3"
          style={{ borderColor: "var(--color-red-200)", background: "var(--color-red-50)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--color-red-600)" }} aria-hidden="true" />
          <span className="flex-1" style={{ fontSize: "13px", color: "var(--color-red-700)", minWidth: "200px" }}>
            {t("Your last payment didn’t go through. Update your payment method to keep your Pro subscription.")}</span>
          <button
            type="button"
            onClick={() => void openPortal("payment_method")}
            disabled={busyTarget === "portal"}
            className="px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2"
            style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "var(--color-teal-50)" }}
          >
            {busyTarget === "portal" && <Loader2 size={14} className="animate-spin" />}
            {t("Update payment method")}
          </button>
        </div>
      )}

      {checkoutState === "success" && (
        <div
          className="max-w-3xl mx-auto mb-8 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-teal-200)",
            background: "var(--color-teal-50)",
            color: "var(--color-teal-800)",
            fontSize: "13px"
          }}
        >
          {t("Checkout completed. Refreshing your billing state...")}</div>
      )}

      {checkoutState === "cancel" && (
        <div
          className="max-w-3xl mx-auto mb-8 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-border-tertiary)",
            background: "var(--color-background-secondary)",
            color: "var(--color-text-secondary)",
            fontSize: "13px"
          }}
        >
          {t("Checkout was canceled.")}</div>
      )}

      {error && <SupportHelp topic="Payment" />}
      {error && (
        <div
          className="max-w-3xl mx-auto mb-8 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {t(error)}
        </div>
      )}

      {!loading && (
        <>
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-5 mb-12 items-stretch">
            {regional.cards.map((card) => {
              const cta = resolveCta(card);
              const isBusy =
                (card.code !== "trial" && busyTarget === card.code) ||
                (card.code !== "trial" && currentPlanCode === card.code && busyTarget === "portal");
              // The emailed offer discounts its plan's first payment (never alongside a plan already held).
              const list = card.code !== "trial" ? regional.prices?.plans.find(item => item.code === card.code) : undefined;
              const promoCovered = card.code !== "trial" && !hasPaidPlan && promo.covers(card.code);
              const promoPrice = promoCovered && card.code !== "trial"
                ? promo.planPrice(card.code, list && regional.prices ? { amount: list.amount, currency: regional.prices.currency } : null)
                : null;
              const percentOff = promo.offer?.promotion?.percent_off;
              // The trial badge sits on the trial plan's card only while this account can start the trial.
              const badge = promoCovered && percentOff
                ? t("{{percent}}% off first month", { percent: percentOff })
                : offersTrialOn(card.code) ? t("3-day free trial") : card.badge;
              return (
                <div
                  key={card.code}
                  className="p-6 rounded-xl border-2 flex flex-col relative"
                  style={{
                    background: card.highlighted
                      ? "var(--color-teal-50)"
                      : "var(--color-background-primary)",
                    borderColor: card.highlighted
                      ? "var(--color-teal-400)"
                      : "var(--color-border-tertiary)"
                  }}
                >
                  {badge && (
                    <div className="mb-4">
                      <span
                        className="px-3 py-1 rounded-full font-medium inline-block"
                        style={{
                          fontSize: "11px",
                          background: card.highlighted ? "var(--color-teal-600)" : "var(--color-slate-800)",
                          color: card.highlighted ? "var(--color-teal-50)" : "white"
                        }}
                      >
                        {badge}
                      </span>
                    </div>
                  )}
                  <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                    {card.name}
                  </h3>
                  <p className="mb-4" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                    {t(card.description)}
                  </p>
                  {promoPrice ? (
                  <div className="mb-6">
                    <s className="block" style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
                      <span className="sr-only">{t("Regular price:")}{" "}</span>{formatMoney(promoPrice.amount, promoPrice.currency)}
                    </s>
                    <span className="font-medium" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
                      <span className="sr-only">{t("First month:")}{" "}</span>{formatMoney(promoPrice.discounted_amount, promoPrice.currency)}
                    </span>
                    <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                      {" "}{"/"}{t("first month")}
                    </span>
                    <p className="mt-1 font-medium" style={{ fontSize: "12px", color: "var(--color-teal-700)" }}>
                      {t("then {{price}}/month · cancel anytime", { price: formatMoney(promoPrice.amount, promoPrice.currency) })}
                    </p>
                  </div>
                  ) : (
                  <div className="mb-6">
                    <span className="font-medium" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
                      {card.weeklyPrice}
                    </span>
                    <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                      {" "}{"/"}{t(card.billingPeriod)}
                    </span>
                    <p className="mt-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                      {card.totalPrice}
                    </p>
                    {card.savings ? (
                      <p className="mt-1 font-medium" style={{ fontSize: "12px", color: "var(--color-teal-700)" }}>
                        {t(card.savings)}
                      </p>
                    ) : null}
                  </div>
                  )}
                  <ul className="space-y-3 mb-6 flex-1">
                    {card.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check
                          size={16}
                          className="mt-0.5 flex-shrink-0"
                          style={{ color: "var(--color-teal-600)" }}
                        />
                        <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={cta.onClick}
                    disabled={cta.disabled || isBusy || (card.code !== "trial" && !regional.ready)}
                    className="w-full px-6 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
                    style={{
                      fontSize: "13px",
                      background: card.highlighted
                        ? "var(--color-teal-600)"
                        : card.code === "annual"
                          ? "var(--color-slate-800)"
                          : "var(--color-background-primary)",
                      color: card.highlighted
                        ? "var(--color-teal-50)"
                        : card.code === "annual"
                          ? "white"
                          : "var(--color-teal-600)",
                      border: card.highlighted || card.code === "annual"
                        ? "none"
                        : "2px solid var(--color-teal-200)",
                      opacity: cta.disabled ? 0.6 : 1,
                      cursor: cta.disabled ? "not-allowed" : "pointer"
                    }}
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {promoCovered && percentOff && !cta.disabled
                      ? t("Get {{percent}}% off {{plan}}", { percent: percentOff, plan: card.name })
                      : t(cta.label)}
                  </button>
                </div>
              );
            })}
          </div>

          {plan && hasAppAccess(plan) && entitlements && usage && (
            <div
              className="max-w-4xl mx-auto p-5 rounded-xl border"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              <h3 className="font-medium mb-3" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
                {t("Current usage snapshot (")}{usage.period_month}{")"}</h3>
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
              >
                <div>
                  {t("Customized generations:")}{" "}{usage.tailored_cv_generations_count}
                  {usage.limits.tailored_cv_generations !== null
                    ? ` / ${usage.limits.tailored_cv_generations}`
                    : t(" / unlimited")}
                </div>
                <div>
                  {t("Exports:")}{" "}{usage.exports_count}
                  {usage.limits.exports !== null ? ` / ${usage.limits.exports}` : t(" / unlimited")}
                </div>
                <div>
                  {t("AI actions:")}{" "}{usage.ai_actions_count}
                  {usage.limits.ai_actions !== null ? ` / ${usage.limits.ai_actions}` : t(" / unlimited")}
                </div>
                <div>
                  {t("Remaining storage:")}{" "}{entitlements.remaining.storage_bytes ?? t("unlimited")}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
