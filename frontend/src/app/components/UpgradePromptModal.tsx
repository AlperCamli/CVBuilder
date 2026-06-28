import { ArrowRight, Check, Loader2, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import {
  PAID_PLAN_CARDS,
  WEEKLY_PRICE,
  type CheckoutTarget
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

const featureLabel = (feature: string | undefined): string => {
  switch (feature) {
    case "export_pdf":
    case "export_docx":
      return "exports";
    case "tailored_cv_generation":
      return "job-specific CVs";
    case "ai_action":
      return "AI actions";
    default:
      return "this feature";
  }
};

const limitReachedCopy = (feature: string | undefined): { title: string; pitch: string } => {
  switch (feature) {
    case "ai_action":
      return {
        title: "You've hit your monthly AI limit",
        pitch: `Unlock unlimited AI improvements and rewrites. Plans start at ${WEEKLY_PRICE}/week.`
      };
    case "export_pdf":
    case "export_docx":
      return {
        title: "You've hit your monthly export limit",
        pitch: `Unlock unlimited PDF and DOCX exports. Plans start at ${WEEKLY_PRICE}/week.`
      };
    case "tailored_cv_generation":
      return {
        title: "You've hit your job-specific CV limit",
        pitch: `Create unlimited tailored CVs for every application. Plans start at ${WEEKLY_PRICE}/week.`
      };
    default:
      return {
        title: "You've hit your Free plan limit",
        pitch: `Go unlimited. Plans start at ${WEEKLY_PRICE}/week.`
      };
  }
};

const getCopy = (
  variant: UpgradePromptVariant,
  options: UpgradePromptOptions,
  trialEligible: boolean
): VariantCopy => {
  const weeklyCta = trialEligible ? "Start 3-day free trial" : "Start weekly plan";

  switch (variant) {
    case "welcome":
      return {
        eyebrow: "Welcome",
        title: "Unlock the full job-specific CV workflow",
        body: trialEligible
          ? "Start Weekly with a 3-day trial, then create unlimited tailored CVs, exports, cover letters, and AI rewrites."
          : "Create unlimited tailored CVs, exports, cover letters, and AI rewrites with a paid plan.",
        ctaPrimary: weeklyCta,
        dismiss: "Maybe later"
      };
    case "export_first_in_session":
      return {
        eyebrow: "Heads up",
        title: "Export without limits",
        body: trialEligible
          ? "Free includes 5 exports per month. Weekly starts with a 3-day trial and unlocks unlimited PDF and DOCX exports."
          : "Free includes 5 exports per month. Upgrade to export as many polished CVs as you need.",
        ctaPrimary: weeklyCta,
        dismiss: "Continue with Free"
      };
    case "limit_reached": {
      const { title, pitch } = limitReachedCopy(options.feature);
      const reasonSentence = options.reason
        ? `${options.reason.replace(/\.?\s*$/, ".")} `
        : `You've used all of your free ${featureLabel(options.feature)} for this month. `;
      return {
        eyebrow: "Free limit reached",
        title,
        body: `${reasonSentence}${pitch}`,
        ctaPrimary: weeklyCta,
        dismiss: "Not now"
      };
    }
    case "post_export":
      return {
        eyebrow: "Your job-specific CV is exported",
        title: "Your customized CV is ready. Keep going with the full application workflow.",
        body:
          "You have seen the core value: one CV tailored for one real job. Choose a plan to create unlimited versions for every application.",
        ctaPrimary: weeklyCta,
        dismiss: "Continue with Free"
      };
  }
};

export function UpgradePromptModal({ open, variant, options, onClose }: UpgradePromptModalProps) {
  const { api, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<CheckoutTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trialEligible, setTrialEligible] = useState(true);
  const trackedPostExportOpenRef = useRef(false);
  const trackedPostExportDismissRef = useRef(false);

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
      void api.patchSettings({
        onboarding_completed: true
      }).catch(() => {
        // Analytics and checkout should not depend on settings persistence.
      });
    }
  }, [
    api,
    isAuthenticated,
    open,
    options.exportedCvKind,
    options.firstOnboardingPaywall,
    options.onboardingCompletedBefore,
    variant
  ]);

  const copy = getCopy(variant, options, trialEligible);
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
      await startStripeCheckout(api, target, { source: `upgrade_prompt_${variant}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open checkout.");
      setBusy(null);
    }
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
              {copy.eyebrow}
            </span>
          </div>

          <DialogTitle asChild>
            <h2
              className="font-semibold mb-2"
              style={{ fontSize: isPostExport ? "24px" : "22px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
            >
              {copy.title}
            </h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p style={{ fontSize: "14px", lineHeight: "1.6", color: "var(--color-text-secondary)" }}>
              {copy.body}
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
                    Application checklist
                  </p>
                  <ul className="space-y-2.5">
                    {POST_EXPORT_CHECKLIST.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check size={15} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                        <span style={{ fontSize: "12px", color: "var(--color-text-primary)", lineHeight: "1.5" }}>
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PAID_PLAN_CARDS.map((card) => {
                    const isBusy = busy === card.code;
                    const badge = card.code === "weekly" && !trialEligible ? null : card.badge;

                    return (
                      <div
                        key={card.code}
                        className="p-4 rounded-lg border-2 flex flex-col"
                        style={{
                          borderColor: card.highlighted ? "var(--color-teal-400)" : "var(--color-border-tertiary)",
                          background: card.highlighted ? "var(--color-teal-50)" : "var(--color-background-primary)"
                        }}
                      >
                        <div className="mb-3 min-h-6">
                          {badge ? (
                            <span
                              className="px-2 py-1 rounded-full font-medium"
                              style={{
                                fontSize: "10px",
                                background: card.highlighted ? "var(--color-teal-600)" : "var(--color-slate-800)",
                                color: "white"
                              }}
                            >
                              {badge}
                            </span>
                          ) : null}
                        </div>
                        <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                          {card.name}
                        </h3>
                        <div className="mb-3">
                          <span className="font-semibold" style={{ fontSize: "27px", color: "var(--color-text-primary)" }}>
                            {card.weeklyPrice}
                          </span>
                          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                            {" "}/{card.billingPeriod}
                          </span>
                          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                            {card.totalPrice}
                          </p>
                          {card.savings ? (
                            <p className="font-medium" style={{ fontSize: "11px", color: "var(--color-teal-700)", marginTop: "2px" }}>
                              {card.savings}
                            </p>
                          ) : null}
                        </div>
                        <p className="mb-4 flex-1" style={{ fontSize: "12px", lineHeight: "1.5", color: "var(--color-text-secondary)" }}>
                          {card.description}
                        </p>
                        <button
                          type="button"
                          onClick={() => void startCheckout(card.code)}
                          disabled={busy !== null}
                          className="w-full px-3 py-2 rounded-lg font-medium inline-flex justify-center items-center gap-2"
                          style={{
                            fontSize: "12px",
                            background: card.highlighted ? "var(--color-teal-600)" : "var(--color-slate-800)",
                            color: "white",
                            opacity: busy !== null ? 0.7 : 1,
                            cursor: busy !== null ? "wait" : "pointer"
                          }}
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                          {card.code === "weekly" && trialEligible ? "Start trial" : `Choose ${card.name}`}
                        </button>
                      </div>
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
                  {error}
                </div>
              )}
            </>
          ) : (
            <>
              <ul className="space-y-2.5 mb-5">
                {UNLIMITED_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--color-teal-600)" }} />
                    <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{feature}</span>
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
                  {error}
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
                  {options.nextStep.label}
                  <ArrowRight size={14} />
                </button>
              )}

              <button
                type="button"
                onClick={() => void startCheckout("weekly")}
                disabled={busy !== null}
                className="w-full px-5 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)",
                  opacity: busy !== null ? 0.7 : 1,
                  cursor: busy !== null ? "wait" : "pointer"
                }}
              >
                {busy === "weekly" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                {copy.ctaPrimary}
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
              Compare plans
            </button>
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
              {copy.dismiss}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
