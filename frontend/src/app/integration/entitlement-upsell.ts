import { ApiClientError } from "./api-error";
import { checkoutPath } from "./subscription-flow";

// Gated actions as reported by the backend in EntitlementExceededError.details.action.
export type EntitlementFeature =
  | "tailored_cv_generation"
  | "export_pdf"
  | "export_docx"
  | "ai_action";

// Which trial paywall to show; the backend reports it as details.surface with reason trial_required.
export type PaywallSurface = "export" | "ai" | "tailoring" | "cover_letter" | "other";

const SURFACES: readonly PaywallSurface[] = ["export", "ai", "tailoring", "cover_letter", "other"];

export const isEntitlementExceeded = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError && error.code === "ENTITLEMENT_EXCEEDED";

// A gated action refused because the account has no trial or Pro.
export const isTrialRequired = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError &&
  error.status === 403 &&
  (error.details?.reason === "trial_required" || error.details?.reason === "subscription_required");

export const resolveEntitlementFeature = (
  error: ApiClientError,
  fallback: EntitlementFeature
): EntitlementFeature => {
  const action = error.details?.action;
  if (
    action === "tailored_cv_generation" ||
    action === "export_pdf" ||
    action === "export_docx" ||
    action === "ai_action"
  ) {
    return action;
  }
  return fallback;
};

export const surfaceForFeature = (feature: string | undefined): PaywallSurface => {
  if (feature === "export_pdf" || feature === "export_docx") return "export";
  if (feature === "tailored_cv_generation") return "tailoring";
  if (feature === "ai_action") return "ai";
  return "other";
};

export const resolvePaywallSurface = (error: ApiClientError, fallback: PaywallSurface): PaywallSurface => {
  const surface = error.details?.surface;
  return SURFACES.includes(surface as PaywallSurface) ? (surface as PaywallSurface) : fallback;
};

// Adds a resume hint (e.g. resume=export) so the page can continue the action after activation.
export function withResumeHint(path: string, resume: string): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("resume", resume);
  return `${pathname}?${params}`;
}

export function paywallCheckoutPath(surface: PaywallSurface, returnPath: string, withTrial = true): string {
  const params = new URLSearchParams(checkoutPath({ with_trial: withTrial, return_path: returnPath }).split("?")[1]);
  params.set("source", surface);
  return `/app/checkout?${params}`;
}

// Trial prompt for gated actions of free accounts, worded by what the user tried to do.
export const trialPromptCopy = (surface: PaywallSurface, trialEligible: boolean): { eyebrow: string; title: string; body: string } => {
  switch (surface) {
    case "export":
      return {
        eyebrow: "Your CV is ready",
        title: trialEligible ? "Start your free 3-day trial to download your CV" : "Choose a Pro plan to download your CV",
        body: trialEligible
          ? "Your CV is ready, start your free 3-day trial to download it as PDF or DOCX."
          : "Your CV is ready. Choose a Pro plan to download it as PDF or DOCX."
      };
    case "tailoring":
      return {
        eyebrow: "Free tailoring used",
        title: "You've used your free tailored CV",
        body: trialEligible
          ? "Start your free 3-day trial to tailor your CV for every job you apply to."
          : "Choose a Pro plan to tailor your CV for every job you apply to."
      };
    case "cover_letter":
      return {
        eyebrow: "AI cover letters",
        title: "Write cover letters with AI",
        body: trialEligible
          ? "Start your free 3-day trial to generate a cover letter for every application."
          : "Choose a Pro plan to generate a cover letter for every application."
      };
    case "ai":
      return {
        eyebrow: "AI features",
        title: "Unlock all AI features",
        body: trialEligible
          ? "Unlock all AI features with a free 3-day trial."
          : "Choose a Pro plan to unlock all AI features."
      };
    default:
      return {
        eyebrow: "Pro required",
        title: "Unlock every Pro feature",
        body: trialEligible ? "Start your free 3-day trial to continue." : "Choose a Pro plan to continue."
      };
  }
};
