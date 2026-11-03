import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { i18n } from "../localization/i18n";
import en from "../localization/en.json";
import tr from "../localization/tr.json";
import { localeForPath } from "../localization/LanguageControls";
import { AiUploadDisclosure } from "../components/AiUploadDisclosure";
import { ScorePreview } from "./ScorePreview";
import { PRE_SIGNUP_QUESTIONS } from "./pre-signup-questions";
import {
  PARSE_GIVE_UP_MS,
  PARSE_SLOW_MS,
  QUESTION_FUNNEL_DETAIL,
  parsingStage,
  phaseFromStatus,
  previewKind,
  remainingSeconds,
  scoreResumePath,
} from "./onboarding-flow";
import type { GuestReviewPreview } from "../integration/guest-import";
import type { PrivacyConfig } from "../integration/privacy";

afterEach(async () => { await i18n.changeLanguage("en"); });

const review: GuestReviewPreview = {
  score: 64, status: "complete", method: "ai", summary: "Solid base.", strengths: [],
  improvements: ["Add measurable results to your experience.", "Name a target role.", "List your tools.", "Fourth"],
};

describe("score page resume path", () => {
  it("returns checkout to the score page with the action to resume", () => {
    expect(scoreResumePath({ source: "upload", action: "improve", language: "tr", importId: "imp-1" }))
      .toBe("/app/cv-score?source=upload&action=improve&language=tr&import=imp-1");
    expect(scoreResumePath({ source: "guest", action: "tailor" })).toBe("/app/cv-score?source=guest&action=tailor");
  });
});

describe("pre-signup questions", () => {
  it("maps every question to its funnel detail and explains why it is asked", () => {
    expect(PRE_SIGNUP_QUESTIONS.map(question => QUESTION_FUNNEL_DETAIL[question.id])).toEqual(["goal", "career_stage", "education", "source"]);
    for (const question of PRE_SIGNUP_QUESTIONS) {
      expect(question.why).toMatch(/^Why we ask: /);
      expect((tr as Record<string, string>)[question.why]).toBeTruthy();
      expect((en as Record<string, string>)[question.why]).toBeTruthy();
    }
  });
  it("estimates the remaining time from the current step", () => {
    expect(remainingSeconds(0)).toBe(20);
    expect(remainingSeconds(1)).toBe(15);
    expect(remainingSeconds(3)).toBe(5);
  });
});

describe("analysis status", () => {
  it("never reports a finished state for an unfinished import", () => {
    expect(phaseFromStatus("uploaded")).toBe("parsing");
    expect(phaseFromStatus("parsing")).toBe("parsing");
    expect(phaseFromStatus("parsed")).toBe("ready");
    expect(phaseFromStatus("failed")).toBe("failed");
  });
  it("uses staged wording instead of a fake percentage and gives up after the server deadline", () => {
    expect(parsingStage(0)).toBe("Reading your CV…");
    expect(parsingStage(15_000)).toBe("Checking structure and wording…");
    expect(parsingStage(60_000)).toBe("Rating your experience…");
    expect(PARSE_SLOW_MS).toBeLessThan(PARSE_GIVE_UP_MS);
    expect(PARSE_GIVE_UP_MS).toBeGreaterThan(240_000);
  });
});

describe("score preview before signup", () => {
  it("classifies previews for the funnel", () => {
    expect(previewKind(null)).toBeNull();
    expect(previewKind(review)).toBe("scored");
    expect(previewKind({ ...review, score: null, status: "unscorable" })).toBe("unscored");
  });
  it("shows the overall score and at most three improvements", () => {
    const html = renderToStaticMarkup(<ScorePreview review={review} />);
    expect(html).toContain("64");
    expect(html).toContain("Top things to fix");
    expect(html).toContain("Name a target role.");
    expect(html).not.toContain("Fourth");
    expect(html).toContain("is-fair");
  });
  it("leads an image-based preview with the ATS warning and counts it apart", async () => {
    const image: GuestReviewPreview = {
      score: 10, status: "partial", method: "basic", ats_blocker: "image_based", strengths: [],
      summary: "ATS systems can't read this CV because it is saved as an image. We couldn't read any text in it, so your content was not assessed.",
      improvements: ["Rebuild your CV with selectable text instead of an image so applicant tracking systems can read it. Our editor creates an ATS-friendly CV in a few minutes.", "Add your experience, education and skills in the editor to get a full content score."],
    };
    expect(previewKind(image)).toBe("image_based");
    expect(previewKind({ ...image, ats_blocker: null })).toBe("scored");
    const html = renderToStaticMarkup(<ScorePreview review={image} />);
    expect(html).toContain("ATS systems can’t read your CV");
    expect(html).toContain("design tools like Canva");
    expect(html).toContain("Rebuild it as an ATS-friendly CV in a few minutes.");
    expect(html).toContain("10");
    expect(html).toContain("is-low");
    // The first fix repeats the warning, so only the next one is listed.
    expect(html).not.toContain("Our editor creates");
    expect(html).toContain("Add your experience, education and skills");
    expect(html).not.toContain("Score unavailable");
    expect(renderToStaticMarkup(<ScorePreview review={review} />)).not.toContain("ATS systems");
    await i18n.changeLanguage("tr");
    const turkish = renderToStaticMarkup(<ScorePreview review={image} />);
    expect(turkish).toContain("ATS sistemleri CV’ni okuyamıyor");
    expect(turkish).toContain("Birkaç dakikada ATS uyumlu bir CV olarak yeniden oluştur.");
    expect(turkish).toContain("deneyimini, eğitimini ve becerilerini");
    for (const key of ["Create account & build an ATS-friendly CV", "Build an ATS-friendly CV"]) {
      expect((tr as Record<string, string>)[key]).toBeTruthy();
      expect((en as Record<string, string>)[key]).toBeTruthy();
    }
  });
  it("keeps the unavailable-score message when the CV could not be scored", () => {
    const html = renderToStaticMarkup(<ScorePreview review={{ ...review, score: null, status: "unscorable", summary: "No readable text." }} />);
    expect(html).toContain("Score unavailable");
    expect(html).not.toContain("Top things to fix");
  });
});

describe("AI disclosure as upload consent", () => {
  const config = { ai_provider: "OpenAI", ai_required: true, ai_enabled: true, collection_enabled: true, processors: [] } as unknown as PrivacyConfig;
  it("shows what is sent, to which provider, and the privacy notice without a checkbox", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AiUploadDisclosure consentOnUpload config={config} /></MemoryRouter>);
    expect(html).toContain("By uploading, you agree");
    expect(html).toContain("OpenAI");
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('type="checkbox"');
  });
  it("is translated for Turkish visitors", async () => {
    await i18n.changeLanguage("tr");
    const html = renderToStaticMarkup(<MemoryRouter><AiUploadDisclosure consentOnUpload config={config} /></MemoryRouter>);
    expect(html).toContain("Yükleyerek");
    expect(html).toContain("OpenAI");
  });
});

describe("language on /tr pages", () => {
  it("implies Turkish for /tr and its public subpages only", () => {
    expect(localeForPath("/tr")).toBe("tr");
    expect(localeForPath("/tr/pricing")).toBe("tr");
    expect(localeForPath("/tr/support")).toBe("tr");
    expect(localeForPath("/tr/templates/modern")).toBe("tr");
    expect(localeForPath("/")).toBeNull();
    expect(localeForPath("/pricing")).toBeNull();
    expect(localeForPath("/trial")).toBeNull();
  });
});
