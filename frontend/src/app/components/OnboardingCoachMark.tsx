import { useCallback, useEffect, useRef, useState } from "react";
import { trackOnboardingStepView } from "../integration/analytics";
import type { OnboardingStepId } from "../integration/api-types";
import { useOnboarding } from "../contexts/OnboardingContext";
import { TutorialGuide } from "./TutorialGuide";
import { nextCoachMarkStep } from "../onboarding/onboarding-steps";

interface OnboardingCoachMarkProps {
  step: OnboardingStepId;
  targetSelector: string;
  message: string;
  position?: "top" | "bottom" | "left" | "right";
  /** Extra page-level gating, e.g. suppress while a dialog is open. */
  enabled?: boolean;
  /** A page's walkthrough can advance without requiring every task to be done. */
  sequence?: readonly OnboardingStepId[];
}

const APPEAR_DELAY_MS = 600;
const RETRY_INTERVAL_MS = 500;
const MAX_RETRIES = 10;

export function OnboardingCoachMark({
  step,
  targetSelector,
  message,
  position = "bottom",
  enabled = true,
  sequence,
}: OnboardingCoachMarkProps) {
  const { active, currentStep, isStepComplete, isCoachMarkDismissed, dismissCoachMark } = useOnboarding();
  const [show, setShow] = useState(false);
  const viewTracked = useRef(false);

  const coachStep = sequence ? nextCoachMarkStep(sequence, isStepComplete, isCoachMarkDismissed) : currentStep;
  const shouldShow = active && coachStep === step && enabled && !isCoachMarkDismissed(step);
  const close = useCallback(() => {
    setShow(false);
    dismissCoachMark(step);
  }, [dismissCoachMark, step]);

  useEffect(() => {
    if (!show || !shouldShow) return;
    const target = document.querySelector(targetSelector);
    target?.addEventListener("click", close);
    return () => target?.removeEventListener("click", close);
  }, [show, shouldShow, targetSelector, close]);

  // Wait for the page layout to settle, then poll briefly for the target in
  // case it renders after data loads.
  useEffect(() => {
    if (!shouldShow) {
      setShow(false);
      return;
    }

    let attempts = 0;
    let intervalId: number | undefined;

    const tryShow = () => {
      if (document.querySelector(targetSelector)) {
        setShow(true);
        if (!viewTracked.current) {
          viewTracked.current = true;
          trackOnboardingStepView({ step, flow: "checklist_v1", surface: "coach_mark" });
        }
        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
        return true;
      }
      return false;
    };

    const timeoutId = window.setTimeout(() => {
      if (tryShow()) {
        return;
      }
      intervalId = window.setInterval(() => {
        attempts += 1;
        if (tryShow() || attempts >= MAX_RETRIES) {
          if (intervalId !== undefined) {
            window.clearInterval(intervalId);
            intervalId = undefined;
          }
        }
      }, RETRY_INTERVAL_MS);
    }, APPEAR_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [shouldShow, targetSelector, step]);

  return (
    <TutorialGuide
      show={show && shouldShow}
      onClose={close}
      targetElement={targetSelector}
      message={message}
      position={position}
    />
  );
}
