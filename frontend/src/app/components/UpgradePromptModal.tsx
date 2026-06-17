import { ArrowRight, Check, Loader2, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { LIFETIME_PRICE, PRO_MONTHLY_PRICE } from "../../content/pricing";
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
  ctaSecondary: string;
  dismiss: string;
}

const PRO_FEATURES = [
  "Unlimited customized CVs",
  "Unlimited PDF + DOCX exports",
  "Unlimited AI rewrites & suggestions",
  "Unlimited storage"
];

const featureLabel = (feature: string | undefined): string => {
  switch (feature) {
    case "export_pdf":
    case "export_docx":
      return "exports";
    case "tailored_cv_generation":
      return "customized CVs";
    case "ai_action":
      return "AI actions";
    default:
      return "this feature";
  }
};

// Limit-hit copy must explain why the offer is appearing right now: name the
// exact limit the user just hit, then pitch the unlimited alternative with a price.
const limitReachedCopy = (feature: string | undefined): { title: string; pitch: string } => {
  switch (feature) {
    case "ai_action":
      return {
        title: "You've hit your monthly AI limit",
        pitch: `Get unlimited AI improvements, rewrites, and suggestions with Pro — just ${PRO_MONTHLY_PRICE}/month.`
      };
    case "export_pdf":
    case "export_docx":
      return {
        title: "You've hit your monthly export limit",
        pitch: `Get unlimited PDF and DOCX exports with Pro — just ${PRO_MONTHLY_PRICE}/month.`
      };
    case "tailored_cv_generation":
      return {
        title: "You've hit your customized CV limit",
        pitch: `Create unlimited job-specific CVs with Pro — just ${PRO_MONTHLY_PRICE}/month.`
      };
    default:
      return {
        title: "You've hit your Free plan limit",
        pitch: `Go unlimited with Pro — just ${PRO_MONTHLY_PRICE}/month.`
      };
  }
};

const getCopy = (
  variant: UpgradePromptVariant,
  options: UpgradePromptOptions,
  trialEligible: boolean
): VariantCopy => {
  // Once a user has used their one free trial, drop all trial language and CTAs.
  const proCta = trialEligible ? "Start 3-day free trial" : "Start your subscription";

  switch (variant) {
    case "welcome":
      return {
        eyebrow: "Welcome — let's get you a customized CV",
        title: trialEligible ? "Try Pro free for 3 days" : "Go Pro for unlimited access",
        body: trialEligible
          ? "Unlock unlimited customized CVs, exports, and AI rewrites for 3 days. Cancel any time before the trial ends — no charge."
          : "Unlock unlimited customized CVs, exports, and AI rewrites. Subscribe to Pro and cancel any time.",
        ctaPrimary: proCta,
        ctaSecondary: `Get Lifetime — ${LIFETIME_PRICE}`,
        dismiss: "Maybe later"
      };
    case "export_first_in_session":
      return {
        eyebrow: "Heads up",
        title: "Get unlimited exports with Pro",
        body: trialEligible
          ? "You're on the Free plan, which is capped at 5 exports per month. Start a 3-day free trial to export as much as you want."
          : "You're on the Free plan, which is capped at 5 exports per month. Subscribe to Pro to export as much as you want.",
        ctaPrimary: proCta,
        ctaSecondary: `Get Lifetime — ${LIFETIME_PRICE}`,
        dismiss: "Continue with Free"
      };
    case "limit_reached": {
      const { title, pitch } = limitReachedCopy(options.feature);
      const reasonSentence = options.reason
        ? `${options.reason.replace(/\.?\s*$/, ".")} `
        : `You've used all of your free ${featureLabel(options.feature)} for this month. `;
      return {
        eyebrow: "You've hit your Free limit",
        title,
        body: `${reasonSentence}${pitch}${trialEligible ? " Start with a 3-day free trial." : ""}`,
        ctaPrimary: proCta,
        ctaSecondary: `Get Lifetime — ${LIFETIME_PRICE}`,
        dismiss: "Not now"
      };
    }
    case "post_export":
      if (options.exportedCvKind === "tailored") {
        return {
          eyebrow: "Your CV is exported",
          title: "Need a cover letter to go with it?",
          body: `Pair the CV you just exported with a matching, job-specific cover letter — written by AI from your CV and the job description. Pro gives you unlimited AI writing for ${PRO_MONTHLY_PRICE}/month.`,
          ctaPrimary: proCta,
          ctaSecondary: `Get Lifetime — ${LIFETIME_PRICE}`,
          dismiss: "Not now"
        };
      }
      return {
        eyebrow: "Your CV is exported",
        title: "Make your next job application with us",
        body: `Do you need a job-specific CV? Customize the CV you just exported for a specific job posting — customized CVs get up to 3x more interviews. Pro gives you unlimited customized CVs for ${PRO_MONTHLY_PRICE}/month.`,
        ctaPrimary: proCta,
        ctaSecondary: `Get Lifetime — ${LIFETIME_PRICE}`,
        dismiss: "Not now"
      };
  }
};

export function UpgradePromptModal({ open, variant, options, onClose }: UpgradePromptModalProps) {
  const { api, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"pro" | "lifetime" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Assume eligible until we hear otherwise, so the trial CTA never flashes for
  // someone who is actually eligible. Refreshed each time the modal opens.
  const [trialEligible, setTrialEligible] = useState(true);

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

  const copy = getCopy(variant, options, trialEligible);

  const handleClose = (next: boolean) => {
    if (!next) {
      setError(null);
      setBusy(null);
      onClose();
    }
  };

  const startCheckout = async (target: "pro" | "lifetime") => {
    if (!isAuthenticated) {
      onClose();
      navigate("/signin");
      return;
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
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden gap-0">
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
              style={{ fontSize: "22px", lineHeight: "1.3", color: "var(--color-text-primary)" }}
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
          <ul className="space-y-2.5 mb-5">
            {PRO_FEATURES.map((feature) => (
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

          {variant === "post_export" && options.nextStep && (
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

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={() => void startCheckout("pro")}
              disabled={busy !== null}
              className="flex-1 px-5 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
                opacity: busy !== null ? 0.7 : 1,
                cursor: busy !== null ? "wait" : "pointer"
              }}
            >
              {busy === "pro" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              {copy.ctaPrimary}
            </button>
            <button
              type="button"
              onClick={() => void startCheckout("lifetime")}
              disabled={busy !== null}
              className="flex-1 px-5 py-2.5 rounded-lg font-medium transition-colors inline-flex justify-center items-center gap-2"
              style={{
                fontSize: "13px",
                background: "var(--color-slate-800)",
                color: "white",
                opacity: busy !== null ? 0.7 : 1,
                cursor: busy !== null ? "wait" : "pointer"
              }}
            >
              {busy === "lifetime" ? <Loader2 size={14} className="animate-spin" /> : null}
              {copy.ctaSecondary}
            </button>
          </div>

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
              onClick={onClose}
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
