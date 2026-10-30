import { describe, expect, it } from "vitest";
import type { MeResponseData } from "./api-types";
import { entryOnboardingRedirect, needsEntryOnboarding, signupOnboardingRedirect } from "./entry-onboarding";

const me = (entry_onboarding_completed_at?: string | null) => ({ user: { entry_onboarding_completed_at } }) as MeResponseData;

describe("entry onboarding gate", () => {
  it("gates only an explicit null marker, so a missing field (before the migration) fails open", () => {
    expect(needsEntryOnboarding(me(null))).toBe(true);
    expect(needsEntryOnboarding(me("2026-10-30T10:00:00Z"))).toBe(false);
    expect(needsEntryOnboarding(me(undefined))).toBe(false);
    expect(needsEntryOnboarding(null)).toBe(false);
  });

  it("sends a pending account from any app page to the onboarding", () => {
    for (const path of ["/app", "/app/create", "/app/resumes", "/app/cv/123", "/app/job-tracker"])
      expect(entryOnboardingRedirect(path, me(null))).toBe("/onboarding");
  });

  it("keeps the handoff, its result, billing and account pages reachable", () => {
    for (const path of ["/app/onboarding", "/app/cv-score", "/app/checkout", "/app/pricing", "/app/profile"])
      expect(entryOnboardingRedirect(path, me(null))).toBeNull();
    expect(entryOnboardingRedirect("/app/cv-scores", me(null))).toBe("/onboarding");
  });

  it("never redirects an account that finished the onboarding", () => {
    expect(entryOnboardingRedirect("/app", me("2026-10-30T10:00:00Z"))).toBeNull();
  });
});

describe("standalone sign-up", () => {
  it("sends a fresh visitor to the onboarding", () => {
    expect(signupOnboardingRedirect(null, "")).toBe("/onboarding");
    expect(signupOnboardingRedirect({ from: "/pricing" }, "")).toBe("/onboarding");
  });

  it("keeps the form for a protected deep link or the pricing purchase flow", () => {
    expect(signupOnboardingRedirect({ from: "/app/cv/123" }, "")).toBeNull();
    expect(signupOnboardingRedirect({ from: "/app/checkout?plan_code=monthly" }, "?purchase=1")).toBeNull();
    expect(signupOnboardingRedirect(null, "?purchase=1")).toBeNull();
  });
});
