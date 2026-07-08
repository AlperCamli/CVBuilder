import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { trackOnboardingSkipped, trackOnboardingStepCompleted } from "../integration/analytics";
import type { OnboardingState, OnboardingStepId } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import {
  applyOnboardingCompletion,
  applyOnboardingSkip,
  applyStepCompletion,
  completedStepCount,
  deriveCurrentStep,
  isOnboardingActive,
  isStepComplete
} from "../onboarding/onboarding-steps";

interface OnboardingContextValue {
  loaded: boolean;
  active: boolean;
  currentStep: OnboardingStepId | null;
  completedCount: number;
  justCompleted: boolean;
  isStepComplete: (stepId: OnboardingStepId) => boolean;
  completeStep: (stepId: OnboardingStepId) => void;
  skipOnboarding: () => void;
  clearJustCompleted: () => void;
  isCoachMarkDismissed: (stepId: OnboardingStepId) => boolean;
  dismissCoachMark: (stepId: OnboardingStepId) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { me, api } = useAuth();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [dismissedCoachMarks, setDismissedCoachMarks] = useState<ReadonlySet<OnboardingStepId>>(
    () => new Set()
  );

  const stateRef = useRef<OnboardingState | null>(null);
  const inFlightSteps = useRef<Set<OnboardingStepId>>(new Set());
  const bootstrapped = useRef(false);

  // Bootstrap once from /me; after that the context owns the state locally so
  // optimistic updates are not clobbered by later refreshMe() calls.
  useEffect(() => {
    if (bootstrapped.current || !me) {
      return;
    }
    bootstrapped.current = true;
    stateRef.current = me.user.onboarding_state ?? {};
    setState(stateRef.current);
  }, [me]);

  const completeStep = useCallback(
    (stepId: OnboardingStepId) => {
      const current = stateRef.current;
      if (!current || !isOnboardingActive(current)) {
        return;
      }
      if (isStepComplete(current, stepId) || inFlightSteps.current.has(stepId)) {
        return;
      }
      inFlightSteps.current.add(stepId);

      const now = new Date().toISOString();
      let next = applyStepCompletion(current, stepId, now);
      const finishesOnboarding = stepId === "export";
      if (finishesOnboarding) {
        next = applyOnboardingCompletion(next, now);
        setJustCompleted(true);
      }
      stateRef.current = next;
      setState(next);

      trackOnboardingStepCompleted({ step: stepId, flow: "checklist_v1" });

      const payload = finishesOnboarding
        ? {
            onboarding_state: { steps: { [stepId]: now }, completed_at: now },
            onboarding_completed: true
          }
        : { onboarding_state: { steps: { [stepId]: now } } };

      // Keep the optimistic state on failure; worst case the step re-appears
      // unchecked next session.
      void api.patchSettings(payload).catch(() => {});
    },
    [api]
  );

  const skipOnboarding = useCallback(() => {
    const current = stateRef.current;
    if (!current || !isOnboardingActive(current)) {
      return;
    }

    const now = new Date().toISOString();
    const next = applyOnboardingSkip(current, now);
    stateRef.current = next;
    setState(next);

    trackOnboardingSkipped({ flow: "checklist_v1", completed_steps: completedStepCount(next) });

    void api
      .patchSettings({ onboarding_state: { skipped_at: now }, onboarding_completed: true })
      .catch(() => {});
  }, [api]);

  const clearJustCompleted = useCallback(() => {
    setJustCompleted(false);
  }, []);

  const dismissCoachMark = useCallback((stepId: OnboardingStepId) => {
    setDismissedCoachMarks((prev) => {
      const next = new Set(prev);
      next.add(stepId);
      return next;
    });
  }, []);

  const value = useMemo<OnboardingContextValue>(() => {
    const loaded = state !== null;
    const active = loaded && isOnboardingActive(state);

    return {
      loaded,
      active,
      currentStep: active ? deriveCurrentStep(state) : null,
      completedCount: completedStepCount(state),
      justCompleted,
      isStepComplete: (stepId) => isStepComplete(state, stepId),
      completeStep,
      skipOnboarding,
      clearJustCompleted,
      isCoachMarkDismissed: (stepId) => dismissedCoachMarks.has(stepId),
      dismissCoachMark
    };
  }, [
    state,
    justCompleted,
    dismissedCoachMarks,
    completeStep,
    skipOnboarding,
    clearJustCompleted,
    dismissCoachMark
  ]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}
