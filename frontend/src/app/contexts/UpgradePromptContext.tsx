import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
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
  showUpgradePrompt: (variant: UpgradePromptVariant, options?: UpgradePromptOptions) => void;
  dismissUpgradePrompt: () => void;
}

const UpgradePromptContext = createContext<UpgradePromptContextValue | undefined>(undefined);

export function UpgradePromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpgradePromptState | null>(null);

  const showUpgradePrompt = useCallback(
    (variant: UpgradePromptVariant, options: UpgradePromptOptions = {}) => {
      setState({ variant, options });
    },
    []
  );

  const dismissUpgradePrompt = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo(
    () => ({ showUpgradePrompt, dismissUpgradePrompt }),
    [showUpgradePrompt, dismissUpgradePrompt]
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
