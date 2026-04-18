import { Check } from "lucide-react";
import { useEffect } from "react";
import { useSidebar } from "../contexts/SidebarContext";

export function Pricing() {
  const { setSidebarVisible } = useSidebar();

  // Show sidebar when on this page
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  const plans = [
    {
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Perfect for getting started",
      features: [
        "1 master CV",
        "2 tailored CV versions",
        "Basic AI suggestions",
        "PDF export",
        "1 job application tracking",
      ],
      cta: "Current plan",
      highlighted: false,
    },
    {
      name: "Pro",
      price: "$12",
      period: "per month",
      description: "For active job seekers",
      features: [
        "Unlimited master CVs",
        "Unlimited tailored versions",
        "Advanced AI customization",
        "PDF & DOCX export",
        "Unlimited job tracking",
        "Cover letter generation",
        "Priority support",
        "ATS optimization score",
      ],
      cta: "Upgrade to Pro",
      highlighted: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      period: "contact us",
      description: "For teams and recruiters",
      features: [
        "Everything in Pro",
        "Team collaboration",
        "Custom branding",
        "API access",
        "Dedicated support",
        "Volume discounts",
      ],
      cta: "Contact sales",
      highlighted: false,
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="max-w-4xl mx-auto text-center mb-12">
        <h1 className="font-medium mb-3" style={{ fontSize: "28px", color: "var(--color-text-primary)" }}>
          Choose your plan
        </h1>
        <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
          Start for free, upgrade when you need more tailored CVs
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className="p-6 rounded-xl border-2 flex flex-col"
            style={{
              background: plan.highlighted ? "var(--color-teal-50)" : "var(--color-background-primary)",
              borderColor: plan.highlighted ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
            }}
          >
            {plan.highlighted && (
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
              {plan.name}
            </h3>
            <p className="mb-4" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {plan.description}
            </p>
            <div className="mb-6">
              <span className="font-medium" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
                {plan.price}
              </span>
              <span style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
                {" "}/{plan.period}
              </span>
            </div>
            <ul className="space-y-3 mb-6 flex-1">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
                  <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                  <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
            <button
              className="w-full px-6 py-2.5 rounded-lg font-medium transition-colors"
              style={{
                fontSize: "13px",
                background: plan.highlighted ? "var(--color-teal-600)" : "var(--color-background-primary)",
                color: plan.highlighted ? "var(--color-teal-50)" : "var(--color-teal-600)",
                border: plan.highlighted ? "none" : "2px solid var(--color-teal-200)",
              }}
            >
              {plan.cta}
            </button>
          </div>
        ))}
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto">
        <h2 className="font-medium mb-6 text-center" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Frequently asked questions
        </h2>
        <div className="space-y-4">
          {[
            {
              q: "Can I cancel anytime?",
              a: "Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit cards, PayPal, and offer invoicing for Enterprise customers.",
            },
            {
              q: "Is my data secure?",
              a: "Yes, we use industry-standard encryption and never share your personal information with third parties.",
            },
            {
              q: "Can I export my CVs?",
              a: "Yes, all plans include PDF export. Pro plan includes both PDF and DOCX formats.",
            },
          ].map((faq, index) => (
            <div
              key={index}
              className="p-5 rounded-xl border"
              style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
            >
              <h4 className="font-medium mb-2" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                {faq.q}
              </h4>
              <p style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}