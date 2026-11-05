import { useRegionalPricing } from "../integration/regional-pricing";
import { PricingAvailability } from "./PricingAvailability";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Loader2, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useAuth } from "../integration/auth-context";
import { useOnboarding } from "../contexts/OnboardingContext";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { paywallCheckoutPath, trialPromptCopy } from "../integration/entitlement-upsell";
import { trackFunnelEvent } from "../integration/funnel-events";
import {
  PAID_PLAN_CARDS,
  trialPlanCode,
  type CheckoutTarget,
  type PlanCard
} from "../../content/pricing";
import {
  trackPostExportPaywallDismissed,
  trackPostExportPaywallPlanClick,
  trackPostExportPaywallView
} from "../integration/analytics";
import type { UpgradePromptOptions, UpgradePromptVariant } from "../contexts/UpgradePromptContext";

interface UpgradePromptModalProps {
  open: boolean;
  variant: UpgradePromptVariant;
  options: UpgradePromptOptions;
  onClose: () => void;
}

interface VariantCopy {
  eyebrow: string;
  title: string;
  body: string;
  ctaPrimary: string;
  dismiss: string;
}

const UNLIMITED_FEATURES = [
  "Unlimited job-specific CVs",
  "Unlimited PDF + DOCX exports",
  "Unlimited AI rewrites and suggestions",
  "Cover letters and job tracking"
];

const POST_EXPORT_CHECKLIST = [
  "Exported tailored CV is ready",
  "Create matching cover letters for each role",
  "Generate unlimited job-specific CV versions",
  "Export unlimited PDF and DOCX files",
  "Use AI rewrites and track applications"
];

// The trial plan's card (Monthly) carries the trial; Weekly is a plain paid option without one.
const postExportPlanBadge = (
  card: (typeof PAID_PLAN_CARDS)[number],
  trialPlan: CheckoutTarget,
  trialEligible: boolean
): string | null => {
  if (card.code === trialPlan && trialEligible) return "3-day free trial";
  return card.savings ?? card.badge ?? null;
};

const getCopy = (
  variant: UpgradePromptVariant,
  options: UpgradePromptOptions,
  trialEligible: boolean
): VariantCopy => {
  // The primary button starts the trial plan: with the trial when eligible, else paid.
  const planCta = trialEligible ? "Start 3-day free trial" : "Start monthly plan";

  switch (variant) {
    case "welcome":
      return {
        eyebrow: "Welcome",
        title: "Unlock the full job-specific CV workflow",
        body: trialEligible
          ? "Start with a 3-day free trial on Monthly Pro, then create unlimited tailored CVs, exports, cover letters, and AI rewrites."
          : "Create unlimited tailored CVs, exports, cover letters, and AI rewrites with a paid plan.",
        ctaPrimary: planCta,
        dismiss: "Maybe later"
      };
    case "trial_required": {
      const copy = trialPromptCopy(options.surface ?? "other", trialEligible);
      return {
        ...copy,
        ctaPrimary: trialEligible ? "Start free trial" : "See Pro plans",
        dismiss: "Not now"
      };
    }
    case "limit_reached":
      return {
        eyebrow: "Limit reached",
        title: "You've reached your plan limit",
        body: options.reason ?? "Choose a Pro plan to keep going.",
        ctaPrimary: planCta,
        dismiss: "Not now"
      };
    case "post_export":
      return {
        eyebrow: "Your job-specific CV is exported",
        title: "Your customized CV is ready. Keep going with the full application workflow.",
        body:
          "You have seen the core value: one CV tailored for one real job. Choose a plan to create unlimited versions for every application.",
        ctaPrimary: planCta,
        dismiss: "Not now"
      };
  }
};

export function UpgradePromptModal({ open, variant, options, onClose }: UpgradePromptModalProps) {
  const regional = useRegionalPricing();
  useTranslation();
  const { api, isAuthenticated } = useAuth();
  const { completeStep } = useOnboarding();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<CheckoutTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trialEligible, setTrialEligible] = useState(true);
  const trackedPostExportOpenRef = useRef(false);
  const trackedPostExportDismissRef = useRef(false);
  const trackedPaywallRef = useRef(false);
  const isTrialPrompt = variant === "trial_required";
  const surface = options.surface ?? "other";

  useEffect(() => {
    if (!open) {
      trackedPaywallRef.current = false;
      return;
    }
    if (!isTrialPrompt || trackedPaywallRef.current) return;
    trackedPaywallRef.current = true;
    trackFunnelEvent("paywall_shown", surface);
  }, [open, isTrialPrompt, surface]);

  useEffect(() => {
    if (!open || !isAuthenticated) {
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
  }, [open, isAuthenticated, api]);

  useEffect(() => {
    if (!open) {
      trackedPostExportOpenRef.current = false;
      trackedPostExportDismissRef.current = false;
      return;
    }

    if (variant !== "post_export" || trackedPostExportOpenRef.current) {
      return;
    }

    trackedPostExportOpenRef.current = true;
    trackPostExportPaywallView({
      cv_kind: options.exportedCvKind,
      source: options.firstOnboardingPaywall ? "first_tailored_export_return" : "post_export_return",
      onboarding_completed_before: options.onboardingCompletedBefore ?? false
    });

    if (isAuthenticated && options.firstOnboardingPaywall) {
      completeStep("export");
    }
  }, [
    completeStep,
    api,
    isAuthenticated,
    open,
    options.exportedCvKind,
    options.firstOnboardingPaywall,
    options.onboardingCompletedBefore,
    variant
  ]);

  const copy = getCopy(variant, options, trialEligible);
  const trialPlan = trialPlanCode(regional.prices);
  const isPostExport = variant === "post_export";

  const trackDismissIfNeeded = () => {
    if (!isPostExport || trackedPostExportDismissRef.current) {
      return;
    }

    trackedPostExportDismissRef.current = true;
    trackPostExportPaywallDismissed({
      cv_kind: options.exportedCvKind,
      source: options.firstOnboardingPaywall ? "first_tailored_export_return" : "post_export_return",
      onboarding_completed_before: options.onboardingCompletedBefore ?? false
    });
  };

  const handleClose = (next: boolean) => {
    if (!next) {
      trackDismissIfNeeded();
      setError(null);
      setBusy(null);
      onClose();
    }
  };

  const startCheckout = async (target: CheckoutTarget) => {
    if (!isAuthenticated) {
      onClose();
      navigate("/signin");
      return;
    }

    if (isPostExport) {
      trackPostExportPaywallPlanClick({
        cv_kind: options.exportedCvKind,
        plan_code: target,
        source: options.firstOnboardingPaywall ? "first_tailored_export_return" : "post_export_return",
        onboarding_completed_before: options.onboardingCompletedBefore ?? false
      });
    }

    setBusy(target);
    setError(null);
    try {
      await startStripeCheckout(api, target, { source: `upgrade_prompt_${variant}`, withTrial: target === trialPlan && trialEligible, returnPath: options.returnPath ?? `${window.location.pathname}${window.location.search}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to open checkout."));
      setBusy(null);
    }
  };

  const goToTrialCheckout = () => {
    onClose();
    navigate(paywallCheckoutPath(surface, options.returnPath ?? `${window.location.pathname}${window.location.search}`, trialEligible));
  };

  const goToPricing = () => {
    onClose();
    navigate("/app/pricing");
  };

  const handleNextStep = () => {
    const nextStep = options.nextStep;
    onClose();
    nextStep?.onSelect();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={`${isPostExport ? "sm:max-w-[880px]" : "sm:max-w-[500px]"} p-0 overflow-hidden gap-0`}>
        <div
          className="px-7 pt-7 pb-5"
          style={{
            background: "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-background-primary) 100%)"
          }}
        >
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-4"
            style={{ background: "var(--color-teal-600)", color: "var(--color-teal-50)" }}
          >
            <Sparkles size={12} />
            <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em" }}>
              {t(copy.eyebrow)}
            </span>
          </div>

          <DialogTitle asChild>
            <h2
              className="font-semibold mb-2"
              style={{ fontSize: isPostExport ? "24px" : "22px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
            >
              {t(copy.title)}
            </h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              {t(copy.body)}
            </p>
          </DialogDescription>
        </div>

        <div className="px-7 py-5">
          {isPostExport ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-[0.9fr_1.6fr] gap-5 mb-5">
                <div
                  className="p-4 rounded-lg border"
                  style={{
                    borderColor: "var(--color-border-tertiary)",
                    background: "var(--color-background-primary)"
                  }}
                >
                  <p className="font-medium mb-3" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                    {t("Application checklist")}</p>
                  <ul className="space-y-2.5">
                    {POST_EXPORT_CHECKLIST.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check size={15} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                        <span style={{ fontSize: "12px", color: "var(--color-text-primary)", lineHeight: "1.5" }}>
                          {t(feature)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-3">
                  <PricingAvailability {...regional} />
                  {regional.cards.filter((card): card is PlanCard & { code: CheckoutTarget } => card.code !== "trial").map((card) => {
                    const isBusy = busy === card.code;
                    const badge = postExportPlanBadge(card, trialPlan, trialEligible);
                    const isTrialPlan = card.code === trialPlan;
                    const isEmphasized = isTrialPlan || card.highlighted;

                    return (
                      <button
                        key={card.code}
                        type="button"
                        onClick={() => void startCheckout(card.code)}
                        disabled={busy !== null || !regional.ready}
                        className="w-full p-4 rounded-lg border-2 flex items-center justify-between gap-4 text-left transition-colors"
                        style={{
                          borderColor: isEmphasized ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                          background:
                            isTrialPlan
                              ? "var(--color-teal-50)"
                              : card.highlighted
                                ? "var(--color-background-secondary)"
                                : "var(--color-background-primary)",
                          opacity: busy !== null && !isBusy ? 0.65 : 1,
                          cursor: busy !== null ? "wait" : "pointer"
                        }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <h3
                              className="font-semibold"
                              style={{ fontSize: "15px", color: "var(--color-text-primary)" }}
                            >
                              {card.name}
                            </h3>
                            {isBusy ? (
                              <Loader2 size={13} className="animate-spin" style={{ color: "var(--color-teal-700)" }} />
                            ) : null}
                          </div>
                          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                            {card.totalPrice}
                          </p>
                          {badge ? (
                            <span
                              className="inline-flex mt-2 px-2.5 py-1 rounded-full font-medium"
                              style={{
                                fontSize: "11px",
                                background:
                                  isTrialPlan ? "var(--color-teal-600)" : "var(--color-teal-100)",
                                color:
                                  isTrialPlan ? "var(--color-teal-50)" : "var(--color-teal-800)"
                              }}
                            >
                              {t(badge)}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-right shrink-0">
                          <div>
                            <span
                              className="font-semibold"
                              style={{ fontSize: "25px", color: "var(--color-text-primary)", lineHeight: "1" }}
                            >
                              {card.weeklyPrice}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                              {t("/week")}</span>
                          </div>
                          <p
                            className="font-medium"
                            style={{
                              fontSize: "11px",
                              color: isTrialPlan ? "var(--color-teal-700)" : "var(--color-text-secondary)",
                              marginTop: "5px"
                            }}
                          >
                            {isTrialPlan && trialEligible ? t("Start trial") : t("Choose {{plan}}", { plan: card.name })}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <div
                  className="mb-4 p-3 rounded-lg border"
                  style={{
                    borderColor: "var(--color-red-200)",
                    background: "var(--color-red-50)",
                    color: "var(--color-red-700)",
                    fontSize: "12px"
                  }}
                >
                  {t(error)}
                </div>
              )}
            </>
          ) : (
            <>
              <ul className="space-y-2.5 mb-5">
                {UNLIMITED_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                    <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{t(feature)}</span>
                  </li>
                ))}
              </ul>

              {error && (
                <div
                  className="mb-4 p-3 rounded-lg border"
                  style={{
                    borderColor: "var(--color-red-200)",
                    background: "var(--color-red-50)",
                    color: "var(--color-red-700)",
                    fontSize: "12px"
                  }}
                >
                  {t(error)}
                </div>
              )}

              {options.nextStep && (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={busy !== null}
                  className="w-full mb-3 px-5 py-2.5 rounded-lg font-medium border transition-colors inline-flex justify-center items-center gap-2"
                  style={{
                    fontSize: "13px",
                    borderColor: "var(--color-teal-600)",
                    background: "var(--color-teal-50)",
                    color: "var(--color-teal-800)"
                  }}
                >
                  {t(options.nextStep.label)}
                  <ArrowRight size={14} />
                </button>
              )}

              {isTrialPrompt && options.reason ? (
                <p className="mb-3" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t(options.reason)}</p>
              ) : null}

              <button
                type="button"
                onClick={() => (isTrialPrompt ? goToTrialCheckout() : void startCheckout(trialPlan))}
                disabled={busy !== null || (!isTrialPrompt && !regional.ready)}
                className="w-full px-5 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)",
                  opacity: busy !== null ? 0.7 : 1,
                  cursor: busy !== null ? "wait" : "pointer"
                }}
              >
                {busy === trialPlan ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {t(copy.ctaPrimary)}
              </button>
            </>
          )}

          <div className="flex items-center justify-between mt-4">
            <button
              type="button"
              onClick={goToPricing}
              className="font-medium transition-colors"
              style={{ fontSize: "12px", color: "var(--color-teal-600)" }}
            >
              {t("Compare plans")}</button>
            <button
              type="button"
              onClick={() => {
                trackDismissIfNeeded();
                setError(null);
                setBusy(null);
                onClose();
              }}
              className="font-medium transition-colors"
              style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}
            >
              {t(copy.dismiss)}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
