import { describe, expect, it } from "vitest";
import {
  applyOnboardingCompletion,
  applyOnboardingSkip,
  applyStepCompletion,
  completedStepCount,
  deriveCurrentStep,
  isOnboardingActive,
  isStepComplete,
  ONBOARDING_STEP_ORDER,
  staticStepRoute
} from "./onboarding-steps";

const NOW = "2026-07-08T10:00:00.000Z";
const LATER = "2026-07-08T11:00:00.000Z";

describe("onboarding steps", () => {
  it("orders the six steps from creation to export", () => {
    expect(ONBOARDING_STEP_ORDER).toEqual([
      "create_cv",
      "customize",
      "job_details",
      "template",
      "layout",
      "export"
    ]);
  });

  it("derives the first incomplete step as current", () => {
    expect(deriveCurrentStep({})).toBe("create_cv");
    expect(deriveCurrentStep({ steps: { create_cv: NOW } })).toBe("customize");
    expect(deriveCurrentStep({ steps: { create_cv: NOW, template: NOW } })).toBe("customize");

    const allDone = ONBOARDING_STEP_ORDER.reduce(
      (state, stepId) => applyStepCompletion(state, stepId, NOW),
      {}
    );
    expect(deriveCurrentStep(allDone)).toBeNull();
    expect(completedStepCount(allDone)).toBe(6);
  });

  it("treats null/skipped/completed states as inactive", () => {
    expect(isOnboardingActive(null)).toBe(false);
    expect(isOnboardingActive(undefined)).toBe(false);
    expect(isOnboardingActive({})).toBe(true);
    expect(isOnboardingActive({ steps: { create_cv: NOW } })).toBe(true);
    expect(isOnboardingActive({ skipped_at: NOW })).toBe(false);
    expect(isOnboardingActive({ completed_at: NOW })).toBe(false);
  });

  it("applies step completion idempotently, keeping the first timestamp", () => {
    const first = applyStepCompletion({}, "create_cv", NOW);
    expect(isStepComplete(first, "create_cv")).toBe(true);
    expect(first.steps?.create_cv).toBe(NOW);

    const again = applyStepCompletion(first, "create_cv", LATER);
    expect(again).toBe(first);
    expect(again.steps?.create_cv).toBe(NOW);
  });

  it("keeps existing completion/skip markers when reapplied", () => {
    const completed = applyOnboardingCompletion({ completed_at: NOW }, LATER);
    expect(completed.completed_at).toBe(NOW);

    const skipped = applyOnboardingSkip({ skipped_at: NOW }, LATER);
    expect(skipped.skipped_at).toBe(NOW);
  });

  it("resolves static routes only for pre-editor steps", () => {
    expect(staticStepRoute("create_cv")).toBe("/app/create");
    expect(staticStepRoute("customize")).toBe("/app/tailor/master");
    expect(staticStepRoute("job_details")).toBe("/app/tailor/master");
    expect(staticStepRoute("template")).toBeNull();
    expect(staticStepRoute("layout")).toBeNull();
    expect(staticStepRoute("export")).toBeNull();
  });
});
