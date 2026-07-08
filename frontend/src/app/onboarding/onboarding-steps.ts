import type { LucideIcon } from "lucide-react";
import { ClipboardList, Download, LayoutTemplate, SlidersHorizontal, Target, Upload } from "lucide-react";
import type { OnboardingState, OnboardingStepId } from "../integration/api-types";

export interface OnboardingStepDefinition {
  id: OnboardingStepId;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    id: "create_cv",
    label: "Create or upload your CV",
    description: "Upload a PDF or DOCX, or build one from scratch.",
    icon: Upload
  },
  {
    id: "customize",
    label: "Customize it for a job",
    description: "Open “Customize for a job” on your main CV.",
    icon: Target
  },
  {
    id: "job_details",
    label: "Add the role & job description",
    description: "Paste the job posting so the CV matches the application.",
    icon: ClipboardList
  },
  {
    id: "template",
    label: "Choose a template",
    description: "Pick a design from the template gallery.",
    icon: LayoutTemplate
  },
  {
    id: "layout",
    label: "Adjust font & layout",
    description: "Fine-tune font size, spacing, and page density.",
    icon: SlidersHorizontal
  },
  {
    id: "export",
    label: "Export your tailored CV",
    description: "Download the finished PDF or DOCX.",
    icon: Download
  }
];

export const ONBOARDING_STEP_ORDER: OnboardingStepId[] = ONBOARDING_STEPS.map((step) => step.id);

export function isStepComplete(state: OnboardingState | null | undefined, stepId: OnboardingStepId): boolean {
  return Boolean(state?.steps?.[stepId]);
}

export function completedStepCount(state: OnboardingState | null | undefined): number {
  return ONBOARDING_STEP_ORDER.filter((stepId) => isStepComplete(state, stepId)).length;
}

export function deriveCurrentStep(state: OnboardingState | null | undefined): OnboardingStepId | null {
  return ONBOARDING_STEP_ORDER.find((stepId) => !isStepComplete(state, stepId)) ?? null;
}

export function isOnboardingActive(state: OnboardingState | null | undefined): boolean {
  if (!state) {
    return false;
  }

  return !state.completed_at && !state.skipped_at;
}

export function applyStepCompletion(
  state: OnboardingState,
  stepId: OnboardingStepId,
  now: string
): OnboardingState {
  if (isStepComplete(state, stepId)) {
    return state;
  }

  return {
    ...state,
    steps: { ...state.steps, [stepId]: now }
  };
}

export function applyOnboardingCompletion(state: OnboardingState, now: string): OnboardingState {
  return {
    ...state,
    completed_at: state.completed_at ?? now
  };
}

export function applyOnboardingSkip(state: OnboardingState, now: string): OnboardingState {
  return {
    ...state,
    skipped_at: state.skipped_at ?? now
  };
}

// Routes the checklist CTA can resolve synchronously. Editor-bound steps
// (template/layout/export) depend on the latest tailored CV and are resolved
// asynchronously by the widget instead.
export function staticStepRoute(stepId: OnboardingStepId): string | null {
  switch (stepId) {
    case "create_cv":
      return "/app/create";
    case "customize":
    case "job_details":
      return "/app/tailor/master";
    default:
      return null;
  }
}
