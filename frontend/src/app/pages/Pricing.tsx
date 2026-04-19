import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { BillingPlanResponseData, EntitlementSummary, UsageSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";

export function Pricing() {
  const { setSidebarVisible } = useSidebar();
  const { api } = useAuth();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

        if (cancelled) {
          return;
        }

        setPlan(planResponse);
        setUsage(usageResponse);
        setEntitlements(entitlementResponse);
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (err instanceof ApiClientError) {
          setError(err.message);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Failed to load billing details.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const openCheckout = async () => {
    setBusy(true);
    setError(null);
    try {
      const base = window.location.origin;
      const response = await api.createBillingCheckout({
        plan_code: "pro",
        success_url: `${base}/app/pricing?checkout=success`,
        cancel_url: `${base}/app/pricing?checkout=cancel`
      });
      window.location.href = response.checkout_url;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open checkout.");
      }
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}/app/pricing`
      });
      window.location.href = response.portal_url;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open billing portal.");
      }
      setBusy(false);
    }
  };

  const currentPlanCode = plan?.plan_code ?? "free";
  const checkoutState = new URLSearchParams(location.search).get("checkout");

  const plans = [
    {
      code: "free",
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Perfect for getting started",
      features: [
        "Master CV + tailored CV generation",
        "AI suggestions within plan limits",
        "PDF export",
        "Job application tracking"
      ],
      cta: currentPlanCode === "free" ? "Current plan" : "Downgrade",
      highlighted: false,
      disabled: true
    },
    {
      code: "pro",
      name: "Pro",
      price: "$12",
      period: "per month",
      description: "For active job seekers",
      features: [
        "Higher monthly usage limits",
        "AI block actions and multi-options",
        "PDF and DOCX export",
        "Stripe billing portal access"
      ],
      cta: currentPlanCode === "pro" ? "Manage billing" : "Upgrade to Pro",
      highlighted: true,
      disabled: false
    },
    {
      code: "enterprise",
      name: "Enterprise",
      price: "Custom",
      period: "contact us",
      description: "For teams and recruiters",
      features: [
        "Everything in Pro",
        "Team collaboration",
        "Custom branding",
        "Dedicated support"
      ],
      cta: "Contact sales",
      highlighted: false,
      disabled: true
    }
  ];

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto text-center mb-12">
        <h1 className="font-medium mb-3" style={{ fontSize: "28px", color: "var(--color-text-primary)" }}>
          Choose your plan
        </h1>
        <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
          Start for free, upgrade when you need more tailored CVs
        </p>
      </div>

      {loading && <p className="text-center" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading billing details...</p>}

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
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {plans.map((planCard) => (
              <div
                key={planCard.name}
                className="p-6 rounded-xl border-2 flex flex-col"
                style={{
                  background: planCard.highlighted ? "var(--color-teal-50)" : "var(--color-background-primary)",
                  borderColor: planCard.highlighted ? "var(--color-teal-400)" : "var(--color-border-tertiary)"
                }}
              >
                {planCard.highlighted && (
                  <div className="mb-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium inline-block"
                      style={{ background: "var(--color-teal-600)", color: "var(--color-teal-50)" }}
                    >
                      Recommended
                    </span>
                  </div>
                )}
                <h3 className="font-medium mb-2" style={{ fontSize: "18px", color: "var(--color-text-primary)" }}>
                  {planCard.name}
                </h3>
                <p className="mb-4" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  {planCard.description}
                </p>
                <div className="mb-6">
                  <span className="font-medium" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
                    {planCard.price}
                  </span>
                  <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                    {" "}/{planCard.period}
                  </span>
                </div>
                <ul className="space-y-3 mb-6 flex-1">
                  {planCard.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                      <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    if (planCard.code === "pro") {
                      if (currentPlanCode === "pro") {
                        void openPortal();
                      } else {
                        void openCheckout();
                      }
                    }
                  }}
                  disabled={planCard.disabled || busy}
                  className="w-full px-6 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
                  style={{
                    fontSize: "13px",
                    background: planCard.highlighted ? "var(--color-teal-600)" : "var(--color-background-primary)",
                    color: planCard.highlighted ? "var(--color-teal-50)" : "var(--color-teal-600)",
                    border: planCard.highlighted ? "none" : "2px solid var(--color-teal-200)",
                    opacity: planCard.disabled ? 0.6 : 1,
                    cursor: planCard.disabled ? "not-allowed" : "pointer"
                  }}
                >
                  {busy && planCard.code === "pro" ? <Loader2 size={14} className="animate-spin" /> : null}
                  {planCard.cta}
                </button>
              </div>
            ))}
          </div>

          {entitlements && usage && (
            <div className="max-w-4xl mx-auto p-5 rounded-xl border" style={{ borderColor: "var(--color-border-tertiary)" }}>
              <h3 className="font-medium mb-3" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
                Current usage snapshot ({usage.period_month})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                <div>
                  Tailored generations: {usage.tailored_cv_generations_count}
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
