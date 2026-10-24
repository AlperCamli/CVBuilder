import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../integration/auth-context";
import { hasAppAccess } from "../integration/subscription-flow";
import type { EntitlementFeature } from "../integration/entitlement-upsell";
import { UpgradePromptModal } from "../components/UpgradePromptModal";

export type UpgradePromptVariant =
  | "welcome"
  | "export_first_in_session"
  | "limit_reached"
  | "post_export";

export interface UpgradePromptNextStep {
  label: string;
  onSelect: () => void;
}

export interface UpgradePromptOptions {
  feature?: string;
  requiresPro?: boolean;
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
  ensureProAccess: (feature: EntitlementFeature, returnPath?: string) => Promise<boolean>;
  showUpgradePrompt: (variant: UpgradePromptVariant, options?: UpgradePromptOptions) => void;
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

  const ensureProAccess = useCallback(async (feature: EntitlementFeature, returnPath?: string) => {
    try {
      if (hasAppAccess(await api.getBillingPlan())) return true;
      showUpgradePrompt("limit_reached", { feature, returnPath, requiresPro: true });
    } catch {
      showUpgradePrompt("limit_reached", { feature, returnPath, requiresPro: true, reason: t("Could not verify your subscription.") });
    }
    return false;
  }, [api, showUpgradePrompt]);

  const dismissUpgradePrompt = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo(
    () => ({ showUpgradePrompt, dismissUpgradePrompt, ensureProAccess }),
    [showUpgradePrompt, dismissUpgradePrompt, ensureProAccess]
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
