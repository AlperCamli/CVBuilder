import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { PublicHeader } from "../components/PublicHeader";
import { useAuth } from "../integration/auth-context";
import { setPendingCheckout } from "../integration/pending-checkout";
import { PLAN_CARDS, type CheckoutTarget, type PlanCard } from "../../content/pricing";

export function PublicPricing() {
  const navigate = useNavigate();
  const { isAuthenticated, api } = useAuth();
  // Anonymous visitors are assumed eligible (most are, post-signup). For a
  // signed-in visitor who already used their trial, reflect that here too so the
  // marketing CTA matches what they'd see inside the app.
  const [trialEligible, setTrialEligible] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const plan = await api.getBillingPlan();
        if (!cancelled) {
          setTrialEligible(plan.trial_eligible);
        }
      } catch {
        // Non-fatal: keep the default trial copy if eligibility can't be loaded.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, api]);

  // From the public marketing page we never call Stripe directly. Authenticated
  // visitors are sent to the full in-app billing page; anonymous visitors have
  // their plan choice stashed and are routed to sign-up, where the
  // CheckoutIntentResumer finishes the job once they land authenticated.
  const choosePlan = (target: CheckoutTarget, withTrial = true) => {
    if (isAuthenticated) {
      navigate("/app/pricing");
      return;
    }

    setPendingCheckout({
      plan_code: target,
      ...(target === "pro" && !withTrial ? { with_trial: false } : {})
    });
    navigate("/signup");
  };

  const goFree = () => {
    navigate(isAuthenticated ? "/app/create" : "/signup");
  };

  const resolveCta = (card: PlanCard): { label: string; onClick: () => void } => {
    if (card.code === "free") {
      return { label: "Get started free", onClick: goFree };
    }
    if (card.code === "pro") {
      return {
        label: trialEligible ? "Start 3-day free trial" : "Start your subscription",
        onClick: () => choosePlan("pro")
      };
    }
    return { label: "Get Lifetime — $99", onClick: () => choosePlan("lifetime") };
  };

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <section className="max-w-7xl mx-auto px-6 pt-16 pb-10">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h1
            className="font-medium mb-3"
            style={{ fontSize: "32px", lineHeight: "1.2", color: "var(--color-text-primary)" }}
          >
            Simple pricing for a faster job search
          </h1>
          <p style={{ fontSize: "15px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
            {trialEligible
              ? "Start free, or go Pro with a 3-day free trial. Cancel anytime — no charge during the trial."
              : "Start free, or subscribe to Pro for unlimited access. Cancel anytime."}
          </p>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {PLAN_CARDS.map((card) => {
            const cta = resolveCta(card);
            const badge = card.code === "pro" && !trialEligible ? "Most popular" : card.badge;
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
                    cursor: "pointer"
                  }}
                >
                  {cta.label}
                </button>
                {card.code === "pro" && trialEligible && (
                  <button
                    onClick={() => choosePlan("pro", false)}
                    className="w-full mt-2 px-6 py-2 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2 bg-transparent"
                    style={{
                      fontSize: "12px",
                      color: "var(--color-teal-700)",
                      border: "none",
                      textDecoration: "underline",
                      cursor: "pointer"
                    }}
                  >
                    Subscribe now without trial
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-center mt-8" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {isAuthenticated
            ? "You're signed in — choosing a plan takes you to your billing page."
            : "You'll create your account first, then continue straight to secure checkout."}
        </p>
      </section>

      <footer className="border-t mt-8" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/images/logo.png" alt="" className="w-5 h-5 rounded-lg object-contain shrink-0" />
              <span className="font-medium" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                jobspecificCV
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              © 2026 jobspecificCV. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
