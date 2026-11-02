import { describe, expect, it } from "vitest";
import type { CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../src/modules/imports/parsers/cv-parser";
import type { CvReviewAiOutput } from "../src/modules/ai/flows/flow-contracts";
import { AI_REVIEW_CRITERIA, IMAGE_BASED_IMPROVEMENT, reviewCv, scoreAiReview } from "../src/modules/cv-review/cv-review";
import { computeScoreImprovement } from "../src/modules/cv-review/cv-review-improvement";
import type { CvReview } from "../src/modules/cv-review/cv-review.types";

const section = (type: string, fields: Record<string, string | string[]>): CvSection => ({ id: type, type, title: type, order: 0, meta: {}, blocks: [{ id: `${type}-block`, type, order: 0, visibility: "visible", fields, meta: {} }] });
const cv = (): CvContent => ({ version: "v1", language: "en", metadata: {}, sections: [
  section("header", { full_name: "Alex Smith", email: "alex@example.com" }),
  section("experience", { role: "Software engineer", company: "Example Ltd", start_date: "2020", end_date: "2025", description: ["Built Python services for 200 users and reduced costs by 30%.", "Delivered reliable SQL reporting tools for the operations department."] }),
  section("education", { degree: "Computer Science", institution: "Example University" }),
  section("skills", { skills: ["Python", "SQL"] })
] });
const quality = { score: 100, confidence: "high" as const, low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 };
const diagnostics = (): ParseCvFileDiagnostics => ({ mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text", quality });
const ocrDiagnostics = (): ParseCvFileDiagnostics => ({
  mime_type: "application/pdf", attempted_stages: ["pdfjs_text", "pdf_token_heuristic", "pdf_ocr_tesseract"], final_stage: "pdf_ocr_tesseract",
  page_count: 1, text_layer: "missing", image_based: true, ocr: "recovered", quality
});
const rawText = "Alex Smith Software engineer at Example Ltd built Python services for 200 users and reduced costs by 30%.";
const imported = (content = cv(), diag = diagnostics()) => ({ content, import_status: "parsed", raw_text: rawText, diagnostics: diag });
type Criterion = CvReviewAiOutput["criteria"][number];
const ratings = (levels: Partial<Record<(typeof AI_REVIEW_CRITERIA)[number], number>> = {}, overrides: Partial<Record<(typeof AI_REVIEW_CRITERIA)[number], Partial<Criterion>>> = {}): CvReviewAiOutput => ({
  criteria: AI_REVIEW_CRITERIA.map(id => ({ id, level: levels[id] ?? 2, assessment: `${id} assessment.`, strength: `${id} strength.`, issue: `${id} issue.`, quote: null, fix: `${id} fix.`, ...overrides[id] }))
});

/** improvement_details must mirror improvements exactly, and each part must rebuild the text. */
function expectAligned(review: CvReview) {
  const details = review.improvement_details!;
  expect(details).toBeDefined();
  expect(details.map(detail => detail.text)).toEqual(review.improvements);
  for (const detail of details) {
    expect(detail.issue.trim()).not.toBe("");
    expect([detail.issue, detail.quote ? `“${detail.quote}”` : null, detail.fix].filter(Boolean).join(" ")).toBe(detail.text);
  }
}

describe("CV review improvement_details", () => {
  it("splits AI weaknesses into issue, verified quote and fix, in the improvements' order", () => {
    const review = scoreAiReview(imported(), ratings({ impact: 1, wording: 2, depth: 3, focus: 1, skills_evidence: 2 }, {
      wording: { quote: "delivered  reliable SQL reporting tools" },
      focus: { quote: "Led a team of 40 engineers at Google" }
    }));
    expectAligned(review);
    const wording = review.improvement_details!.find(detail => detail.issue === "wording issue.")!;
    expect(wording).toEqual({ text: "wording issue. “delivered  reliable SQL reporting tools” wording fix.", issue: "wording issue.", quote: "delivered  reliable SQL reporting tools", fix: "wording fix." });
    // A quote that is not in the CV is dropped from the parts too.
    expect(review.improvement_details!.find(detail => detail.issue === "focus issue.")).toMatchObject({ quote: null, fix: "focus fix." });
  });

  it("uses the fix as the lead line when the AI gave no issue", () => {
    const review = scoreAiReview(imported(), ratings({}, { depth: { issue: null } }));
    expectAligned(review);
    expect(review.improvement_details!.find(detail => detail.text === "depth fix.")).toEqual({ text: "depth fix.", issue: "depth fix.", quote: null, fix: null });
  });

  it("keeps the same dedupe and six-item cap as improvements", () => {
    const shared = { issue: "Same issue.", fix: "Same fix.", quote: null };
    const review = scoreAiReview(imported(), ratings({ impact: 0, wording: 0, depth: 0, focus: 0, skills_evidence: 0 }, { wording: shared, focus: shared }));
    expectAligned(review);
    expect(review.improvements.filter(text => text === "Same issue. Same fix.")).toHaveLength(1);
    const many = cv();
    many.sections = many.sections.filter(s => s.type === "experience");
    const basic = reviewCv({ content: many });
    expect(basic.improvements.length).toBeLessThanOrEqual(6);
    expectAligned(basic);
  });

  it("treats deterministic suggestions as plain issues without a quote or fix", () => {
    const content = cv();
    content.sections = content.sections.filter(s => s.type !== "skills" && s.type !== "education");
    const review = reviewCv(imported(content));
    expect(review.improvements.length).toBeGreaterThan(0);
    expectAligned(review);
    expect(review.improvement_details!.every(detail => detail.issue === detail.text && detail.quote === null && detail.fix === null)).toBe(true);
  });

  it("is filled for unscorable and image-based reviews, with the ATS fix first", () => {
    expectAligned(reviewCv({ content: null, import_status: "failed" }));
    expectAligned(reviewCv({ content: null }));
    const noText = reviewCv({ content: null, import_status: "parsed", raw_text: "", diagnostics: { ...ocrDiagnostics(), ocr: "failed" } });
    expectAligned(noText);
    const ocr = scoreAiReview(imported(cv(), ocrDiagnostics()), ratings({}, { wording: { quote: "delivered reliable SQL reporting tools" } }));
    expectAligned(ocr);
    expect(ocr.improvement_details![0]).toEqual({ text: IMAGE_BASED_IMPROVEMENT, issue: IMAGE_BASED_IMPROVEMENT, quote: null, fix: null });
    expect(ocr.improvement_details!.some(detail => detail.quote === "delivered reliable SQL reporting tools")).toBe(true);
  });

  it("carries over unchanged to the review after an improvement score", async () => {
    const before = imported();
    const review = scoreAiReview(before, ratings({}, { wording: { quote: "delivered reliable SQL reporting tools" } }));
    const result = await computeScoreImprovement({ review, before, after_content: cv() });
    expect(result).not.toBeNull();
    expect(result!.review_after.improvement_details).toEqual(review.improvement_details);
    expectAligned(result!.review_after);
  });
});
