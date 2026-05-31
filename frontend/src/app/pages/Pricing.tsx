import { Check, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { BillingPlanResponseData, EntitlementSummary, UsageSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { PLAN_CARDS, type CheckoutTarget, type PlanCard } from "../../content/pricing";

const formatTrialEnd = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export function Pricing() {
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState<CheckoutTarget | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<BillingPlanResponseData | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementSummary | null>(null);

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
          setError("Failed to load billing details.");
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

  const startCheckout = async (target: CheckoutTarget, withTrial = true) => {
    setBusyTarget(target);
    setError(null);
    try {
      await startStripeCheckout(api, target, { withTrial });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open checkout.");
      setBusyTarget(null);
    }
  };

  const openPortal = async () => {
    setBusyTarget("portal");
    setError(null);
    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}/app/pricing`
      });
      window.location.href = response.portal_url;
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === "VALIDATION_ERROR" &&
        err.message.includes("Start checkout again")
      ) {
        await startCheckout("pro");
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to open billing portal.");
      setBusyTarget(null);
    }
  };

  const currentPlanCode = plan?.plan_code ?? "free";
  const subscriptionStatus = plan?.subscription_status ?? "inactive";
  const isTrialing = subscriptionStatus === "trialing";
  // Default to eligible only until the plan loads, to avoid flashing the wrong
  // CTA; once loaded this reflects the backend's authoritative decision.
  const trialEligible = plan?.trial_eligible ?? true;
  const trialEnd = useMemo(() => formatTrialEnd(plan?.current_period_end ?? null), [plan]);
  const checkoutState = new URLSearchParams(location.search).get("checkout");

  const resolveCta = (card: PlanCard): { label: string; disabled: boolean; onClick?: () => void } => {
    if (card.code === "free") {
      return {
        label: currentPlanCode === "free" ? "Current plan" : "Downgrade via portal",
        disabled: true
      };
    }

    if (card.code === "pro") {
      if (currentPlanCode === "lifetime") {
        return { label: "Included in Lifetime", disabled: true };
      }
      if (currentPlanCode === "pro") {
        return {
          label: isTrialing ? "Manage trial" : "Manage billing",
          disabled: false,
          onClick: () => void openPortal()
        };
      }
      return {
        label: trialEligible ? "Start 3-day free trial" : "Start your subscription",
        disabled: false,
        onClick: () => void startCheckout("pro")
      };
    }

    // lifetime
    if (currentPlanCode === "lifetime") {
      return { label: "Lifetime — thank you!", disabled: true };
    }
    return {
      label: "Get Lifetime — $99",
      disabled: false,
      onClick: () => void startCheckout("lifetime")
    };
  };

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto text-center mb-10">
        <h1 className="font-medium mb-3" style={{ fontSize: "28px", color: "var(--color-text-primary)" }}>
          Choose your plan
        </h1>
        <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
          {trialEligible
            ? "Try Pro free for 3 days. Cancel anytime — no charge during the trial."
            : "You've already used your free trial. Subscribe to Pro for unlimited access — cancel anytime."}
        </p>
      </div>

      {loading && (
        <p className="text-center" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Loading billing details...
        </p>
      )}

      {isTrialing && trialEnd && (
        <div
          className="max-w-3xl mx-auto mb-6 p-4 rounded-lg border flex items-center gap-3"
          style={{ borderColor: "var(--color-teal-200)", background: "var(--color-teal-50)" }}
        >
          <Sparkles size={16} style={{ color: "var(--color-teal-600)" }} />
          <span style={{ fontSize: "13px", color: "var(--color-teal-800)" }}>
            You're on a free trial. Your first charge is on <strong>{trialEnd}</strong>. Cancel any time before then in
            the billing portal.
          </span>
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
          Checkout completed. Refreshing your billing state...
        </div>
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
          Checkout was canceled.
        </div>
      )}

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
          {error}
        </div>
      )}

      {!loading && (
        <>
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 items-stretch">
            {PLAN_CARDS.map((card) => {
              const cta = resolveCta(card);
              const isBusy =
                (card.code === "pro" && busyTarget === "pro") ||
                (card.code === "lifetime" && busyTarget === "lifetime") ||
                (card.code === "pro" && currentPlanCode === "pro" && busyTarget === "portal");
              // The "3-day free trial" badge is misleading once the trial is used.
              const badge =
                card.code === "pro" && !trialEligible ? "Most popular" : card.badge;
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
                    {card.description}
                  </p>
                  <div className="mb-6">
                    <span className="font-medium" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
                      {card.price}
                    </span>
                    <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                      {" "}/{card.period}
                    </span>
                  </div>
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
                    disabled={cta.disabled || isBusy}
                    className="w-full px-6 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
                    style={{
                      fontSize: "13px",
                      background: card.highlighted
                        ? "var(--color-teal-600)"
                        : card.code === "lifetime"
                          ? "var(--color-slate-800)"
                          : "var(--color-background-primary)",
                      color: card.highlighted
                        ? "var(--color-teal-50)"
                        : card.code === "lifetime"
                          ? "white"
                          : "var(--color-teal-600)",
                      border: card.highlighted || card.code === "lifetime"
                        ? "none"
                        : "2px solid var(--color-teal-200)",
                      opacity: cta.disabled ? 0.6 : 1,
                      cursor: cta.disabled ? "not-allowed" : "pointer"
                    }}
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {cta.label}
                  </button>
                  {card.code === "pro" &&
                    trialEligible &&
                    currentPlanCode !== "pro" &&
                    currentPlanCode !== "lifetime" && (
                      <button
                        onClick={() => void startCheckout("pro", false)}
                        disabled={isBusy}
                        className="w-full mt-2 px-6 py-2 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2 bg-transparent"
                        style={{
                          fontSize: "12px",
                          color: "var(--color-teal-700)",
                          border: "none",
                          textDecoration: "underline",
                          cursor: isBusy ? "not-allowed" : "pointer",
                          opacity: isBusy ? 0.6 : 1
                        }}
                      >
                        Subscribe now without trial
                      </button>
                    )}
                </div>
              );
            })}
          </div>

          {entitlements && usage && (
            <div
              className="max-w-4xl mx-auto p-5 rounded-xl border"
              style={{ borderColor: "var(--color-border-tertiary)" }}
            >
              <h3 className="font-medium mb-3" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
                Current usage snapshot ({usage.period_month})
              </h3>
              <div
                className="grid grid-cols-1 md:grid-cols-2 gap-3"
                style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
              >
                <div>
                  Customized generations: {usage.tailored_cv_generations_count}
                  {usage.limits.tailored_cv_generations !== null
                    ? ` / ${usage.limits.tailored_cv_generations}`
                    : " / unlimited"}
                </div>
                <div>
                  Exports: {usage.exports_count}
                  {usage.limits.exports !== null ? ` / ${usage.limits.exports}` : " / unlimited"}
                </div>
                <div>
                  AI actions: {usage.ai_actions_count}
                  {usage.limits.ai_actions !== null ? ` / ${usage.limits.ai_actions}` : " / unlimited"}
                </div>
                <div>
                  Remaining storage: {entitlements.remaining.storage_bytes ?? "unlimited"}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
