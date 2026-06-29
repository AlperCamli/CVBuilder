import { Check } from "lucide-react";
import { useNavigate } from "react-router";
import { PublicHeader } from "../components/PublicHeader";
import { setPendingCheckout } from "../integration/pending-checkout";
import { PLAN_CARDS, type CheckoutTarget, type PlanCard } from "../../content/pricing";

export function PublicPricing() {
  const navigate = useNavigate();
  const trialEligible = true;

  // From the public marketing page we never load auth or call Stripe directly.
  // The plan choice is stashed and the authenticated app resumes checkout after
  // sign-up, keeping the SEO bundle small.
  const choosePlan = (target: CheckoutTarget, withTrial = true) => {
    setPendingCheckout({
      plan_code: target,
      ...(target === "weekly" && !withTrial ? { with_trial: false } : {})
    });
    navigate("/signup", { state: { from: "/app/create" } });
  };

  const goFree = () => {
    navigate("/signup", { state: { from: "/app/create" } });
  };

  const resolveCta = (card: PlanCard): { label: string; onClick: () => void } => {
    if (card.code === "free") {
      return { label: "Get started free", onClick: goFree };
    }
    if (card.code === "weekly") {
      return {
        label: trialEligible ? "Start 3-day free trial" : "Start weekly plan",
        onClick: () => choosePlan("weekly")
      };
    }
    return { label: `Choose ${card.name.toLowerCase()}`, onClick: () => choosePlan(card.code) };
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
            Compare plans by weekly price. Weekly starts with a 3-day trial, while monthly and annual reduce the weekly equivalent for active job searches.
          </p>
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-5 items-stretch">
          {PLAN_CARDS.map((card) => {
            const cta = resolveCta(card);
            const badge = card.code === "weekly" && !trialEligible ? null : card.badge;
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
                    {card.weeklyPrice}
                  </span>
                  <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                    {" "}/{card.billingPeriod}
                  </span>
                  <p className="mt-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {card.totalPrice}
                  </p>
                  {card.savings ? (
                    <p className="mt-1 font-medium" style={{ fontSize: "12px", color: "var(--color-teal-700)" }}>
                      {card.savings}
                    </p>
                  ) : null}
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
                    cursor: "pointer"
                  }}
                >
                  {cta.label}
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center mt-8" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          You'll create your account first, then continue straight to secure checkout.
        </p>
      </section>

      <footer className="border-t mt-8" style={{ borderColor: "var(--color-border-tertiary)" }}>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src="/images/logo.png"
                alt=""
                width="20"
                height="20"
                decoding="async"
                className="w-5 h-5 rounded-lg object-contain shrink-0"
              />
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
