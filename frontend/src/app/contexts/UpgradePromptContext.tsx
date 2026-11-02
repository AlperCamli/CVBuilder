import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../integration/auth-context";
import { hasAppAccess } from "../integration/subscription-flow";
import { surfaceForFeature, type EntitlementFeature, type PaywallSurface } from "../integration/entitlement-upsell";
import type { BillingPlanResponseData } from "../integration/api-types";
import { UpgradePromptModal } from "../components/UpgradePromptModal";

export type UpgradePromptVariant =
  | "welcome"
  | "trial_required"
  | "limit_reached"
  | "post_export";

export interface UpgradePromptNextStep {
  label: string;
  onSelect: () => void;
}

export interface UpgradePromptOptions {
  feature?: string;
  // trial_required: which paywall copy to show and the checkout source.
  surface?: PaywallSurface;
  returnPath?: string;
  reason?: string | null;
  exportedCvKind?: "master" | "tailored";
  firstOnboardingPaywall?: boolean;
  onboardingCompletedBefore?: boolean;
  nextStep?: UpgradePromptNextStep;
}

interface UpgradePromptState {
  variant: UpgradePromptVariant;
  options: UpgradePromptOptions;
}

interface UpgradePromptContextValue {
  // True with a trial or Pro, or when allowFree accepts the plan (a free use); otherwise opens the trial prompt.
  ensureProAccess: (
    feature: EntitlementFeature,
    returnPath?: string,
    allowFree?: (plan: BillingPlanResponseData) => boolean | Promise<boolean>
  ) => Promise<boolean>;
  showUpgradePrompt: (variant: UpgradePromptVariant, options?: UpgradePromptOptions) => void;
  showTrialPrompt: (surface: PaywallSurface, options?: Omit<UpgradePromptOptions, "surface">) => void;
  dismissUpgradePrompt: () => void;
}

const UpgradePromptContext = createContext<UpgradePromptContextValue | undefined>(undefined);

export function UpgradePromptProvider({ children }: { children: ReactNode }) {
  useTranslation();
  const { api } = useAuth();
  const [state, setState] = useState<UpgradePromptState | null>(null);

  const showUpgradePrompt = useCallback(
    (variant: UpgradePromptVariant, options: UpgradePromptOptions = {}) => {
      setState({ variant, options });
    },
    []
  );

  const showTrialPrompt = useCallback(
    (surface: PaywallSurface, options: Omit<UpgradePromptOptions, "surface"> = {}) => {
      setState({ variant: "trial_required", options: { ...options, surface } });
    },
    []
  );

  const ensureProAccess = useCallback(async (
    feature: EntitlementFeature,
    returnPath?: string,
    allowFree?: (plan: BillingPlanResponseData) => boolean | Promise<boolean>
  ) => {
    try {
      const plan = await api.getBillingPlan();
      if (hasAppAccess(plan) || (allowFree && (await allowFree(plan)))) return true;
      showTrialPrompt(surfaceForFeature(feature), { feature, returnPath });
    } catch {
      showTrialPrompt(surfaceForFeature(feature), { feature, returnPath, reason: t("Could not verify your subscription.") });
    }
    return false;
  }, [api, showTrialPrompt]);

  const dismissUpgradePrompt = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo(
    () => ({ showUpgradePrompt, showTrialPrompt, dismissUpgradePrompt, ensureProAccess }),
    [showUpgradePrompt, showTrialPrompt, dismissUpgradePrompt, ensureProAccess]
  );

  return (
    <UpgradePromptContext.Provider value={value}>
      {children}
      <UpgradePromptModal
        open={state !== null}
        variant={state?.variant ?? "welcome"}
        options={state?.options ?? {}}
        onClose={dismissUpgradePrompt}
      />
    </UpgradePromptContext.Provider>
  );
}

export function useUpgradePrompt(): UpgradePromptContextValue {
  const context = useContext(UpgradePromptContext);
  if (!context) {
    throw new Error("useUpgradePrompt must be used within UpgradePromptProvider");
  }
  return context;
}
