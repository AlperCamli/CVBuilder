import { describe, expect, it } from "vitest";
import type { CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../src/modules/imports/parsers/cv-parser";
import { extractJobKeywords, reviewCv, reviewTailoring } from "../src/modules/cv-review/cv-review";

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
const job = { job_title: "Software Engineer", job_description: "Build Python SQL services. Python SQL reporting and testing." };

describe("evidence-based CV review", () => {
  it("uses the exact weighted formula and leaves job dimensions unassessed on upload", () => {
    const review = reviewCv(imported());
    expect(review.status).toBe("partial");
    expect(review.assessed_weight).toBe(65);
    expect(dimension(review, "relevance").score).toBeNull();
    expect(dimension(review, "keywords").score).toBeNull();
    const sum = review.dimensions.reduce((n, d) => n + (d.score ?? 0) * (d.score === null ? 0 : d.weight), 0);
    expect(review.score).toBe(Math.round(sum / 65));
    expect(reviewCv(imported())).toEqual(review);
  });

  it("assesses all seven dimensions when file evidence and a job are present", () => {
    const review = reviewCv({ ...imported(), job });
    expect(review.status).toBe("complete");
    expect(review.assessed_weight).toBe(100);
    expect(review.matched_keywords).toContain("python");
    expect(review.missing_keywords).toContain("testing");
    expect(review.score).toBeGreaterThanOrEqual(0);
    expect(review.score).toBeLessThanOrEqual(100);
  });

  it.each(["failed", "uploaded", "parsing"])("withholds scores for %s imports even if stale content exists", status => {
    const review = reviewCv({ ...imported(), import_status: status });
    expect(review.score).toBeNull();
    expect(review.status).toBe("unscorable");
    expect(review.summary).toContain("ATS compatibility issue");
    expect(review.strengths).toEqual([]);
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

  it("excludes unavailable diagnostics rather than pretending to test the source file", () => {
    const review = reviewCv({ ...imported(), diagnostics: null });
    expect(review.status).toBe("partial");
    expect(review.assessed_weight).toBe(45);
    expect(dimension(review, "ats").score).toBeNull();
  });

  it("does not reward empty section types or hidden skills", () => {
    const content = cv(); content.sections.find(s => s.type === "skills")!.blocks[0].fields = {};
    expect(dimension(reviewCv(imported(content)), "sections").score).toBe(80);
    content.sections.find(s => s.type === "skills")!.blocks[0].visibility = "hidden";
    expect(dimension(reviewCv(imported(content)), "sections").score).toBe(80);
  });

  it("does not increase content or achievement scores by repeating the same statement", () => {
    const content = cv();
    const baseline = reviewCv(imported(content));
    const description = content.sections[1].blocks[0].fields.description as string[];
    description.push(...Array(30).fill(description[0]));
    const padded = reviewCv(imported(content));
    expect(dimension(padded, "quality")).toEqual(dimension(baseline, "quality"));
    expect(dimension(padded, "impact")).toEqual(dimension(baseline, "impact"));
  });

  it("ignores employment dates and numerical credentials for measurable impact", () => {
    const content = cv(); content.sections[1].blocks[0].fields.description = "Responsible for internal reporting and maintenance of existing tools.";
    content.sections[2].blocks[0].fields.degree = "Class of 2025, grade 95%";
    const review = reviewCv(imported(content));
    expect(dimension(review, "impact").score).toBe(0);
    expect(dimension(review, "quality").score).toBe(40);
    expect(dimension(review, "quality").checks.find(c => c.id === "specific")?.evidence).toContain("Responsible for internal reporting");
  });

  it("rewards specific actions and factual measures over generic duties", () => {
    const content = cv(); content.sections[1].blocks[0].fields.description = "Responsible for internal reporting and maintenance of existing tools.";
    expect(reviewCv(imported()).score).toBeGreaterThan(reviewCv(imported(content)).score!);
    expect(dimension(reviewCv(imported()), "impact").checks[0].evidence).toContain("200 users");
  });

  it("requires contextual job terms for relevance instead of rewarding skills stuffing equally", () => {
    const content = cv(); content.sections[1].blocks[0].fields.description = "Delivered reliable reporting tools for the operations department.";
    const review = reviewCv({ content, job });
    expect(dimension(review, "keywords").score).toBeGreaterThan(dimension(review, "relevance").score!);
  });

  it("matches punctuation-sensitive technical terms and avoids substring matches", () => {
    const content = cv(); content.sections[3].blocks[0].fields.skills = ["C++", "C#", ".NET", "Node.js", "JavaScript", "RSpec"];
    const review = reviewCv({ content, job: { job_title: "Engineer", job_description: "C++ C# .NET Node.js Java R" }, keywords: ["Java", "R", "C++", "C#", ".NET", "Node.js"] });
    expect(review.matched_keywords).toEqual(expect.arrayContaining(["c++", "c#", ".net", "node.js"]));
    expect(review.missing_keywords).toEqual(expect.arrayContaining(["java", "r"]));
  });

  it("deduplicates target terms and rejects AI terms absent from the job description", () => {
    const review = reviewCv({ content: cv(), job, keywords: ["Python", "PYTHON", "unrelated"] });
    expect(review.matched_keywords.filter(k => k === "python")).toHaveLength(1);
    expect([...review.matched_keywords, ...review.missing_keywords]).not.toContain("unrelated");
    expect(extractJobKeywords("the and you your role skills experience")).toEqual([]);
  });

  it("supports medical and project content without requiring paid employment", () => {
    const content = cv(); content.sections[1].type = "clinical_experience"; content.sections[1].blocks[0].fields = { duties: ["Treated 40 patients each week in the outpatient clinic."] };
    content.sections[2].type = "medical_qualifications"; content.sections[3].type = "clinical_skills";
    const review = reviewCv({ content });
    expect(dimension(review, "sections").score).toBe(100);
    expect(dimension(review, "impact").score).toBe(100);
    content.sections[1].type = "projects";
    expect(dimension(reviewCv({ content }), "sections").score).toBe(100);
  });

  it("does not apply English wording rules to another language", () => {
    expect(dimension(reviewCv({ content: { ...cv(), language: "tr" } }), "quality").score).toBeNull();
  });

  it("reports a real before/after comparison, including decreased and unchanged scores", () => {
    const before = cv(); before.sections[1].blocks[0].fields.description = "Responsible for internal reporting and maintenance of existing tools.";
    const positive = reviewTailoring(before, cv(), job);
    expect(positive.score_change).toBeGreaterThan(0);
    expect(positive.before.assessed_weight).toBe(positive.after.assessed_weight);
    expect(positive.changed_sections).toEqual(["experience"]);
    expect(positive.changes.some(c => c.dimension === "quality")).toBe(true);
    expect(reviewTailoring(cv(), before, job).score_change).toBeLessThan(0);
    expect(reviewTailoring(cv(), cv(), job).score_change).toBe(0);
    expect(reviewTailoring(cv(), cv(), job).changes).toEqual([]);
  });
});
