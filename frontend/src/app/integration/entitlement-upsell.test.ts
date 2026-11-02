import { afterEach, describe, expect, it } from "vitest";
import { ApiClientError } from "./api-error";
import {
  isTrialRequired,
  paywallCheckoutPath,
  resolvePaywallSurface,
  surfaceForFeature,
  trialPromptCopy,
  withResumeHint,
  type PaywallSurface
} from "./entitlement-upsell";
import { i18n, translateInLocale } from "../localization/i18n";

const SURFACES: PaywallSurface[] = ["export", "ai", "tailoring", "cover_letter", "other"];
const refused = (details: Record<string, unknown>, status = 403) =>
  new ApiClientError({ status, code: "FORBIDDEN", message: "Activate your 3-day free trial or purchase Pro to continue.", details });

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("trial paywall for free accounts", () => {
  it("recognises the backend's trial refusal and its paywall surface", () => {
    const error = refused({ reason: "trial_required", surface: "cover_letter", action: "ai_action" });
    expect(isTrialRequired(error)).toBe(true);
    expect(resolvePaywallSurface(error, "ai")).toBe("cover_letter");
    expect(resolvePaywallSurface(refused({ reason: "trial_required", surface: "unknown" }), "export")).toBe("export");
    expect(isTrialRequired(refused({ reason: "subscription_required" }))).toBe(true);
    expect(isTrialRequired(refused({ reason: "privacy" }))).toBe(false);
    expect(isTrialRequired(new Error("trial_required"))).toBe(false);
    expect(surfaceForFeature("export_docx")).toBe("export");
    expect(surfaceForFeature("tailored_cv_generation")).toBe("tailoring");
    expect(surfaceForFeature("ai_action")).toBe("ai");
  });

  it("opens checkout with the trial, the paywall source and an encoded return with a resume hint", () => {
    const next = withResumeHint("/app/cv/00000000-0000-0000-0000-000000000001?tailor=1", "export");
    expect(next).toBe("/app/cv/00000000-0000-0000-0000-000000000001?tailor=1&resume=export");
    const url = new URL(paywallCheckoutPath("export", next), "https://app.invalid");
    expect(url.pathname).toBe("/app/checkout");
    expect(url.searchParams.get("trial")).toBe("1");
    expect(url.searchParams.get("source")).toBe("export");
    expect(url.searchParams.get("next")).toBe(next);
    expect(new URL(paywallCheckoutPath("tailoring", "/app/resumes", false), "https://app.invalid").searchParams.get("trial")).toBe("0");
    // Only internal destinations are kept.
    expect(new URL(paywallCheckoutPath("ai", "https://evil.invalid/app"), "https://app.invalid").searchParams.get("next")).toBe("/onboarding?step=upload");
  });

  it("words each paywall in English and Turkish", () => {
    expect(trialPromptCopy("export", true).body).toBe("Your CV is ready, start your free 3-day trial to download it as PDF or DOCX.");
    expect(trialPromptCopy("ai", true).body).toBe("Unlock all AI features with a free 3-day trial.");
    for (const surface of SURFACES) {
      for (const eligible of [true, false]) {
        for (const text of Object.values(trialPromptCopy(surface, eligible))) {
          expect(i18n.exists(text, { lng: "en" }), text).toBe(true);
          expect(translateInLocale(text, "tr"), text).not.toBe(text);
        }
      }
      expect(trialPromptCopy(surface, false).body).toContain("Pro plan");
    }
  });
});
