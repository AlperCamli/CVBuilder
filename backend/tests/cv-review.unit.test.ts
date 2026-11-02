import { describe, expect, it } from "vitest";
import type { CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../src/modules/imports/parsers/cv-parser";
import type { CvReviewAiOutput } from "../src/modules/ai/flows/flow-contracts";
import { AI_REVIEW_CRITERIA, LEVEL_POINTS, REVIEW_WEIGHTS, buildAiReviewInput, reviewCv, scoreAiReview } from "../src/modules/cv-review/cv-review";

const section = (type: string, fields: Record<string, string | string[]>): CvSection => ({ id: type, type, title: type, order: 0, meta: {}, blocks: [{ id: `${type}-block`, type, order: 0, visibility: "visible", fields, meta: {} }] });
const cv = (): CvContent => ({ version: "v1", language: "en", metadata: {}, sections: [
  section("header", { full_name: "Alex Smith", email: "alex@example.com" }),
  section("experience", { role: "Software engineer", company: "Example Ltd", start_date: "2020", end_date: "2025", description: ["Built Python services for 200 users and reduced costs by 30%.", "Delivered reliable SQL reporting tools for the operations department."] }),
  section("education", { degree: "Computer Science", institution: "Example University" }),
  section("skills", { skills: ["Python", "SQL"] })
] });
const diagnostics = (): ParseCvFileDiagnostics => ({ mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text", quality: { score: 100, confidence: "high", low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 } });
const imported = (content = cv()) => ({ content, import_status: "parsed", raw_text: "Alex Smith Software engineer at Example Ltd built Python services for 200 users and reduced costs by 30%.", diagnostics: diagnostics() });
const dimension = (review: ReturnType<typeof reviewCv>, id: string) => review.dimensions.find(d => d.id === id)!;
const ratings = (levels: Partial<Record<(typeof AI_REVIEW_CRITERIA)[number], number>> = {}, overrides: Partial<CvReviewAiOutput["criteria"][number]> = {}): CvReviewAiOutput => ({
  criteria: AI_REVIEW_CRITERIA.map(id => ({ id, level: levels[id] ?? 2, assessment: `${id} assessment.`, strength: `${id} strength.`, issue: `${id} issue.`, quote: null, fix: `${id} fix.`, ...overrides }))
});
const weighted = (review: ReturnType<typeof reviewCv>) => {
  const assessed = review.dimensions.filter(d => d.score !== null);
  return Math.round(assessed.reduce((n, d) => n + d.score! * d.weight, 0) / assessed.reduce((n, d) => n + d.weight, 0));
};

describe("CV review v2: AI-rated content", () => {
  it("maps rating levels onto the strict curve and the fixed weights", () => {
    const review = scoreAiReview(imported(), ratings({ impact: 3, wording: 2, depth: 2, focus: 1, skills_evidence: 4 }));
    expect(review).toMatchObject({ version: "cv-review-v2", method: "ai", status: "complete", assessed_weight: 100 });
    expect(dimension(review, "impact").score).toBe(LEVEL_POINTS[3]);
    expect(dimension(review, "focus").score).toBe(LEVEL_POINTS[1]);
    expect(review.score).toBe(weighted(review));
    expect(Object.values(REVIEW_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("puts an average CV in the middle of the scale rather than near the top", () => {
    const average = scoreAiReview(imported(), ratings());
    expect(average.score).toBe(66);
    expect(average.summary).toMatch(/^Several areas need attention\./);
    const excellent = scoreAiReview(imported(), ratings({ impact: 4, wording: 4, depth: 4, focus: 4, skills_evidence: 4 }));
    expect(excellent.score).toBe(100);
    expect(excellent.improvements).toEqual([]);
  });

  it("caps impact at what the experience statements' figures support", () => {
    const content = cv(); content.sections[1].blocks[0].fields.description = ["Built Python services for the operations department.", "Delivered reliable SQL reporting tools for managers."];
    const review = scoreAiReview(imported(content), ratings({ impact: 4 }));
    expect(dimension(review, "impact").score).toBe(LEVEL_POINTS[2]);
    expect(dimension(review, "impact").reason).toContain("Capped at level 2");
    expect(dimension(scoreAiReview(imported(), ratings({ impact: 4 })), "impact")).toMatchObject({ score: 100, reason: null });
  });

  it("shows only quotes that really appear in the CV", () => {
    const real = scoreAiReview(imported(), ratings({}, { quote: "delivered  reliable SQL reporting tools" }));
    expect(dimension(real, "wording").checks[0].evidence).toContain("“delivered  reliable SQL reporting tools”");
    expect(real.improvements[0]).toContain("“delivered  reliable SQL reporting tools”");
    for (const quote of ["Led a team of 40 engineers at Google", "SQL", "alex@example.com"]) {
      const review = scoreAiReview(imported(), ratings({}, { quote }));
      expect(JSON.stringify(review)).not.toContain(quote === "SQL" ? "“SQL”" : quote);
    }
  });

  it("orders improvements by weighted shortfall and lists strengths from level 3", () => {
    const review = scoreAiReview(imported(), ratings({ impact: 3, wording: 1, depth: 3, focus: 2, skills_evidence: 2 }));
    expect(review.improvements[0]).toBe("wording issue. wording fix.");
    expect(review.improvements.slice(1, 3)).toEqual(["focus issue. focus fix.", "impact issue. impact fix."]);
    expect(review.strengths.slice(0, 2)).toEqual(["Measurable results: impact strength.", "Experience depth: depth strength."]);
  });

  it("rejects incomplete ratings so the caller falls back to the basic review", () => {
    expect(() => scoreAiReview(imported(), { criteria: ratings().criteria.slice(0, 4) })).toThrow();
  });

  it("keeps the deterministic parseability dimension out when diagnostics are unavailable", () => {
    const review = scoreAiReview({ ...imported(), diagnostics: null }, ratings());
    expect(review).toMatchObject({ status: "partial", assessed_weight: 95 });
    expect(dimension(review, "ats").score).toBeNull();
  });
});

describe("CV review v2: AI input", () => {
  it("sends content without contact details while keeping dates and skills", () => {
    const content = cv();
    content.sections[1].blocks[0].fields.start_date = "2019 - 2021";
    (content.sections[1].blocks[0].fields.description as string[]).push("Reach me at alex@example.com or +44 20 7946 0958 and https://alex.dev/cv.");
    const input = buildAiReviewInput(imported(content))!;
    const json = JSON.stringify(input);
    expect(json).not.toMatch(/Alex Smith|alex@example\.com|7946|alex\.dev/);
    expect(input.sections.map(s => s.type)).toEqual(["experience", "education", "skills"]);
    expect(input.sections[0].blocks[0].heading).toContain("2019 - 2021");
    expect(input.sections[2].blocks[0]).toMatchObject({ heading: "", lines: ["Python", "SQL"] });
    expect(input.stats).toEqual({ experience_statements: 3, statements_with_numbers: 2 });
  });

  it("requests no AI review for content that cannot be scored", () => {
    expect(buildAiReviewInput({ ...imported(), import_status: "failed" })).toBeNull();
    expect(buildAiReviewInput({ ...imported(), diagnostics: { ...diagnostics(), final_stage: "pdf_ocr_tesseract" } })).toBeNull();
    expect(scoreAiReview({ ...imported(), import_status: "failed" }, ratings()).status).toBe("unscorable");
  });
});

describe("CV review v2: basic fallback", () => {
  it("assesses only deterministic criteria and says so", () => {
    const review = reviewCv(imported());
    expect(review).toMatchObject({ method: "basic", status: "partial", assessed_weight: 60 });
    for (const id of ["depth", "focus", "skills_evidence"]) expect(dimension(review, id)).toMatchObject({ score: null, checks: [] });
    expect(review.summary).toContain("basic review");
    expect(review.score).toBe(weighted(review));
    expect(reviewCv(imported())).toEqual(review);
  });

  it.each(["failed", "uploaded", "parsing"])("withholds scores for %s imports even if stale content exists", status => {
    const review = reviewCv({ ...imported(), import_status: status });
    expect(review).toMatchObject({ score: null, status: "unscorable", strengths: [] });
    expect(review.summary).toContain("ATS compatibility issue");
    expect(review.dimensions.every(d => d.score === null)).toBe(true);
  });

  it.each(["pdf_ocr_tesseract", "pdf_token_heuristic", "utf8_decode"] as const)("withholds scores after %s extraction", final_stage => {
    expect(reviewCv({ ...imported(), diagnostics: { ...diagnostics(), final_stage } }).score).toBeNull();
  });

  it("does not allow manual edits or AI parsing to hide poor extraction evidence", () => {
    const poor = diagnostics(); poor.quality.low_confidence = true;
    expect(reviewCv({ ...imported(), import_status: "reviewed", diagnostics: poor }).score).toBeNull();
    expect(reviewCv({ ...imported(), diagnostics: { ...diagnostics(), quality: { ...diagnostics().quality, confidence: "low", low_confidence: false } } }).score).toBeNull();
  });

  it("withholds scores for missing, empty or unreadable content", () => {
    expect(reviewCv({ ...imported(), content: null }).score).toBeNull();
    expect(reviewCv({ ...imported(), content: { ...cv(), sections: [] } }).score).toBeNull();
    expect(reviewCv({ ...imported(), raw_text: "" }).score).toBeNull();
  });

  it("does not reward empty section types or hidden skills", () => {
    const content = cv(); content.sections.find(s => s.type === "skills")!.blocks[0].fields = {};
    expect(dimension(reviewCv(imported(content)), "structure").score).toBe(80);
    content.sections.find(s => s.type === "skills")!.blocks[0] = { ...cv().sections[3].blocks[0], visibility: "hidden" };
    expect(dimension(reviewCv(imported(content)), "structure").score).toBe(85);
  });

  it("does not increase wording or achievement scores by repeating the same statement", () => {
    const content = cv();
    const baseline = reviewCv(imported(content));
    const description = content.sections[1].blocks[0].fields.description as string[];
    description.push(...Array(30).fill(description[0]));
    const padded = reviewCv(imported(content));
    expect(dimension(padded, "wording")).toEqual(dimension(baseline, "wording"));
    expect(dimension(padded, "impact")).toEqual(dimension(baseline, "impact"));
  });

  it("counts real figures as measurable results but not dates, years or grades outside experience", () => {
    const measured = (line: string) => {
      const content = cv(); content.sections[1].blocks[0].fields.description = [line];
      content.sections[2].blocks[0].fields.degree = "Class of 2025, grade 95%";
      return dimension(reviewCv(imported(content)), "impact").score === 100;
    };
    for (const line of ["Led a team of 8 engineers", "Grew the newsletter to 15k subscribers", "Reduced costs by 2M TL", "Handled 200+ tickets per week", "Ranked top 5 of 120 applicants", "Satışları %30 artırdım"]) expect(measured(line), line).toBe(true);
    for (const line of ["Worked on reporting from 2019 - 2021", "Joined the team in 03/2021", "Owned the Q3 planning cycle", "Responsible for internal reporting"]) expect(measured(line), line).toBe(false);
  });

  it("checks statement length for other languages without English wording rules", () => {
    const content = { ...cv(), language: "tr" };
    const wording = dimension(reviewCv(imported(content)), "wording");
    expect(wording.score).not.toBeNull();
    expect(wording.checks.map(c => c.id)).toEqual(["concise"]);
    expect(wording.reason).toContain("Only statement length is checked");
  });

  it("supports medical and project content without requiring paid employment", () => {
    const content = cv(); content.sections[1].type = "clinical_experience"; content.sections[1].blocks[0].fields = { duties: ["Treated 40 patients each week in the outpatient clinic."] };
    content.sections[2].type = "medical_qualifications"; content.sections[3].type = "clinical_skills";
    const review = reviewCv({ content });
    expect(dimension(review, "structure").score).toBe(100);
    expect(dimension(review, "impact").score).toBe(100);
    content.sections[1].type = "projects";
    expect(dimension(reviewCv({ content }), "structure").score).toBe(100);
  });
});
