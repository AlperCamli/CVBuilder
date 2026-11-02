import { describe, expect, it, vi } from "vitest";
import type { CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../src/modules/imports/parsers/cv-parser";
import type { CvReviewAiOutput, CvReviewVerifyAiOutput } from "../src/modules/ai/flows/flow-contracts";
import { AI_REVIEW_CRITERIA, LEVEL_POINTS, REVIEW_WEIGHTS, buildAiReviewInput, reviewCv, scoreAiReview } from "../src/modules/cv-review/cv-review";
import {
  IMPROVEMENT_ALPHA, IMPROVEMENT_BETA, IMPROVEMENT_LIMITATION, computeScoreImprovement, criterionFeedback, improvedPoints, quoteCorpus, verifyQuote, weightedTotal,
  type CvReviewVerifyAiInput
} from "../src/modules/cv-review/cv-review-improvement";
import type { CvReview, ReviewDimensionId } from "../src/modules/cv-review/cv-review.types";

const section = (type: string, fields: Record<string, string | string[]>): CvSection => ({ id: type, type, title: type, order: 0, meta: {}, blocks: [{ id: `${type}-block`, type, order: 0, visibility: "visible", fields, meta: {} }] });
const cv = (description: string[], skills = ["Python", "SQL", "Docker", "Kubernetes"], extra: CvSection[] = [section("education", { degree: "Computer Science", institution: "Example University" })]): CvContent => ({ version: "v1", language: "en", metadata: {}, sections: [
  section("header", { full_name: "Alex Smith", email: "alex@example.com" }),
  section("experience", { role: "Software engineer", company: "Example Ltd", start_date: "2020", end_date: "2025", description }),
  ...extra,
  section("skills", { skills })
] });
const BEFORE_LINES = ["Built Python services for 200 users and reduced costs by 30%.", "Was responsible for SQL reporting for the operations department."];
const AFTER_LINES = ["Built Python services for 200 users and reduced costs by 30%.", "Delivered SQL reporting and Docker-based release scripts for the operations department."];
const diagnostics = (): ParseCvFileDiagnostics => ({ mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text", quality: { score: 100, confidence: "high", low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 } });
const imported = (content: CvContent) => ({ content, import_status: "parsed", raw_text: "Alex Smith Software engineer at Example Ltd built Python services for 200 users and reduced costs by 30%.", diagnostics: diagnostics() });
const ratings = (levels: Partial<Record<(typeof AI_REVIEW_CRITERIA)[number], number>> = {}): CvReviewAiOutput => ({
  criteria: AI_REVIEW_CRITERIA.map(id => ({ id, level: levels[id] ?? 2, assessment: `The ${id} assessment.`, strength: null, issue: `The ${id} issue.`, quote: id === "wording" ? "Was responsible for SQL reporting" : null, fix: `The ${id} fix.` }))
});
const verifyOutput = (criteria: CvReviewVerifyAiOutput["criteria"]): CvReviewVerifyAiOutput => ({ criteria });
const score = (review: CvReview, id: ReviewDimensionId) => review.dimensions.find(d => d.id === id)!.score;

// Deterministic pseudo-random numbers so a failing case can be reproduced.
const random = (() => { let seed = 20261109; return () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32; })();

describe("improvement formula", () => {
  it("uses the exported constants and the anchored log shape", () => {
    expect(IMPROVEMENT_BETA).toBe(0.6);
    expect(IMPROVEMENT_ALPHA).toBe(4);
    expect(improvedPoints(60, 0)).toBe(60);
    expect(improvedPoints(60, 1)).toBeCloseTo(84, 10);
    expect(improvedPoints(60, 0.5)).toBeCloseTo(60 + 40 * 0.6 * Math.log(3) / Math.log(5), 10);
    expect(improvedPoints(100, 1)).toBe(100);
    expect(improvedPoints(35, -0.4)).toBe(35);
    expect(improvedPoints(35, 7)).toBe(improvedPoints(35, 1));
    expect(improvedPoints(35, Number.NaN)).toBe(35);
  });

  it("never lowers a dimension or the total, stays within 100 and rises strictly for any r > 0", () => {
    const ids = Object.keys(REVIEW_WEIGHTS) as ReviewDimensionId[];
    for (let run = 0; run < 2000; run++) {
      const dims = ids.map(id => ({ id, weight: REVIEW_WEIGHTS[id], score: random() < 0.2 ? null : Math.floor(random() * 100) }));
      if (dims.every(d => d.score === null)) dims[0].score = 50;
      const r = dims.map(() => random() < 0.4 ? 0 : random());
      const after = dims.map((d, index) => ({ weight: d.weight, score: d.score === null ? null : improvedPoints(d.score, r[index]) }));
      after.forEach((d, index) => {
        if (dims[index].score === null) return expect(d.score).toBeNull();
        expect(d.score!).toBeGreaterThanOrEqual(dims[index].score!);
        expect(d.score!).toBeLessThanOrEqual(100);
        if (r[index] === 0) expect(d.score).toBe(dims[index].score);
      });
      const totalBefore = weightedTotal(dims)!; const totalAfter = weightedTotal(after)!;
      expect(totalAfter).toBeGreaterThanOrEqual(totalBefore);
      expect(totalAfter).toBeLessThanOrEqual(100);
      const anyUp = dims.some((d, index) => d.score !== null && d.score < 100 && r[index] > 0);
      if (anyUp) expect(totalAfter).toBeGreaterThan(totalBefore);
      else expect(totalAfter).toBe(totalBefore);
    }
  });
});

describe("improvement score on a stored review", () => {
  const before = imported(cv(BEFORE_LINES));
  const original = () => scoreAiReview(before, ratings());

  it("recovers each criterion's issue, fix and quote from the stored review", () => {
    const review = original();
    const wording = review.dimensions.find(d => d.id === "wording")!;
    expect(criterionFeedback(review, wording)).toEqual({ issue: "The wording issue.", fix: "The wording fix.", quote: "Was responsible for SQL reporting" });
    // When the improvement was cut from the top six, the assessment stands in for the issue.
    expect(criterionFeedback({ ...review, improvements: [] }, wording)).toEqual({ issue: "The wording assessment.", fix: "The wording fix.", quote: "Was responsible for SQL reporting" });
    const basic = reviewCv(before);
    const basicWording = basic.dimensions.find(d => d.id === "wording")!;
    expect(criterionFeedback(basic, basicWording)?.fix).toContain("Begin experience statements with concrete verbs");
  });

  it("verifies quotes with the scoring's own rule", () => {
    const corpus = quoteCorpus(buildAiReviewInput(before)!);
    for (const quote of ["was  RESPONSIBLE for “SQL reporting”", "Led a team of 40 engineers", "SQL", "alex@example.com", "Built Python services for 200 users"]) {
      const shown = JSON.stringify(scoreAiReview(before, { criteria: ratings().criteria.map(c => ({ ...c, quote })) })).includes(`“${quote.trim()}”`);
      expect(verifyQuote(corpus, quote) !== null, quote).toBe(shown);
    }
  });

  it("worked example: verified fixes raise the score from 66 to 75", async () => {
    const review = original();
    expect(review.score).toBe(66);
    const verify = vi.fn(async (_input: CvReviewVerifyAiInput) => verifyOutput([
      { id: "wording", resolution: "full", evidence_quote: "Delivered SQL reporting and Docker-based release scripts" },
      { id: "depth", resolution: "partial", evidence_quote: "docker-based release scripts for the operations department" },
      // Copied from the original text, not the improved one: counts as none.
      { id: "focus", resolution: "full", evidence_quote: "Was responsible for SQL reporting" }
    ]));
    const result = (await computeScoreImprovement({ review, before, after_content: cv(AFTER_LINES), verify }))!;
    const sent = verify.mock.calls[0][0];
    expect(sent.criteria.map(c => c.id)).toEqual(["wording", "depth", "focus"]);
    expect(sent.criteria[0]).toEqual({ id: "wording", issue: "The wording issue.", fix: "The wording fix.", quote: "Was responsible for SQL reporting" });
    expect(JSON.stringify(sent)).not.toMatch(/alex@example\.com|Alex Smith/);
    // impact: 1/2 statements with figures before and after; skills: Docker of the unbacked Docker and Kubernetes.
    expect(result.r).toEqual({ impact: 0, skills_evidence: 0.5, wording: 1, depth: 0.5, focus: 0 });
    expect(score(result.review_after, "impact")).toBe(60);
    expect(score(result.review_after, "wording")).toBe(84);
    expect(score(result.review_after, "depth")).toBe(76.38);
    expect(score(result.review_after, "focus")).toBe(60);
    expect(score(result.review_after, "skills_evidence")).toBe(76.38);
    expect(score(result.review_after, "structure")).toBe(100);
    expect(score(result.review_after, "ats")).toBe(100);
    expect(result.total_before).toBe(66);
    expect(result.total_after).toBeCloseTo(74.896, 3);
    expect(result).toMatchObject({ before: 66, after: 75 });
    expect(result.review_after).toMatchObject({ version: "cv-review-v2", method: "ai", score: 75, status: "complete", assessed_weight: 100 });
    expect(result.review_after.summary).toMatch(/^Good foundation, not yet competitive\./);
    expect(result.review_after.limitations).toEqual([...review.limitations, IMPROVEMENT_LIMITATION]);
  });

  it("falls back to r = 0 for the AI-verified criteria when verification fails", async () => {
    const onVerifyFailure = vi.fn();
    const result = (await computeScoreImprovement({ review: original(), before, after_content: cv(AFTER_LINES), verify: async () => { throw new Error("provider down"); }, onVerifyFailure }))!;
    expect(onVerifyFailure).toHaveBeenCalledOnce();
    expect(result.r).toEqual({ impact: 0, skills_evidence: 0.5, wording: 0, depth: 0, focus: 0 });
    expect(result.after).toBe(68);
    const unchanged = (await computeScoreImprovement({ review: original(), before, after_content: cv(BEFORE_LINES) }))!;
    expect(unchanged).toMatchObject({ before: 66, after: 66, total_after: 66 });
  });

  it("raises impact for new figures, but never past the cap the improved figures support", async () => {
    const noFigures = imported(cv(["Built Python services for internal users.", "Delivered SQL reporting for the operations department."]));
    const withFigures = cv(["Built Python services for 200 internal users.", "Delivered SQL reporting for the operations department."]);
    const result = (await computeScoreImprovement({ review: scoreAiReview(noFigures, ratings()), before: noFigures, after_content: withFigures }))!;
    expect(result.r.impact).toBe(0.5);
    expect(score(result.review_after, "impact")).toBeCloseTo(improvedPoints(60, 0.5), 2);
    // Rated level 3 with 1/6 statements quantified (capped at 3). Dropping a line makes it 1/5: r > 0,
    // but under a quarter the cap stays at level 3, so impact stays at 80.
    const lines = ["Built Python services for 200 users.", "Delivered SQL reporting tools.", "Maintained internal dashboards.", "Reviewed pull requests weekly.", "Supported the release process.", "Documented the deployment steps."];
    const capped = imported(cv(lines));
    const review = scoreAiReview(capped, ratings({ impact: 3 }));
    expect(score(review, "impact")).toBe(LEVEL_POINTS[3]);
    const improved = (await computeScoreImprovement({ review, before: capped, after_content: cv(lines.slice(0, 5)) }))!;
    expect(improved.r.impact).toBeGreaterThan(0);
    expect(score(improved.review_after, "impact")).toBe(80);
  });

  it("recomputes structure on the improved content and keeps the better result", async () => {
    const missingEducation = imported(cv(BEFORE_LINES, undefined, []));
    const review = scoreAiReview(missingEducation, ratings());
    expect(score(review, "structure")).toBe(85);
    const result = (await computeScoreImprovement({ review, before: missingEducation, after_content: cv(BEFORE_LINES) }))!;
    expect(score(result.review_after, "structure")).toBe(100);
    expect(result.after).toBeGreaterThan(result.before);
    const worse = (await computeScoreImprovement({ review: original(), before, after_content: cv(BEFORE_LINES, undefined, []) }))!;
    expect(score(worse.review_after, "structure")).toBe(100);
  });

  it("sends only criteria the original review scored, and keeps unassessed ones null (basic review)", async () => {
    const review = reviewCv(before);
    expect(review.method).toBe("basic");
    const verify = vi.fn(async (input: CvReviewVerifyAiInput) => verifyOutput(input.criteria.map(c => ({ id: c.id, resolution: "full" as const, evidence_quote: "Delivered SQL reporting and Docker-based" }))));
    const result = (await computeScoreImprovement({ review, before, after_content: cv(AFTER_LINES), verify }))!;
    expect(verify.mock.calls[0][0].criteria.map(c => c.id)).toEqual(["wording"]);
    for (const id of ["depth", "focus", "skills_evidence"] as const) expect(score(result.review_after, id)).toBeNull();
    expect(result.review_after.method).toBe("basic");
    expect(result.after).toBeGreaterThan(result.before);
  });

  it("returns no improvement score for unscorable or image-based reviews", async () => {
    const unscorable = reviewCv({ content: null, import_status: "parsed", raw_text: "", diagnostics: null });
    expect(await computeScoreImprovement({ review: unscorable, before, after_content: cv(AFTER_LINES) })).toBeNull();
    expect(await computeScoreImprovement({ review: { ...original(), ats_blocker: "image_based" }, before, after_content: cv(AFTER_LINES) })).toBeNull();
  });

  it("keeps the score monotone for random ratings and verifier answers", async () => {
    const resolutions = ["none", "partial", "full"] as const;
    const pool = [...AFTER_LINES, "Led code reviews for four engineers.", "Automated Kubernetes deployments for 12 services."];
    for (let run = 0; run < 40; run++) {
      const level = () => Math.floor(random() * 5);
      const review = scoreAiReview(before, ratings({ impact: level(), wording: level(), depth: level(), focus: level(), skills_evidence: level() }));
      const after = cv(pool.filter(() => random() < 0.7).concat(BEFORE_LINES[0]));
      const result = (await computeScoreImprovement({
        review, before, after_content: after,
        verify: async input => verifyOutput(input.criteria.map(c => ({ id: c.id, resolution: resolutions[Math.floor(random() * 3)], evidence_quote: random() < 0.8 ? BEFORE_LINES[0] : "Made-up evidence quote" })))
      }))!;
      expect(result.after).toBeGreaterThanOrEqual(result.before);
      expect(result.after).toBeLessThanOrEqual(100);
      review.dimensions.forEach(d => {
        const next = score(result.review_after, d.id);
        if (d.score === null) return expect(next).toBeNull();
        expect(next!).toBeGreaterThanOrEqual(d.score);
        expect(next!).toBeLessThanOrEqual(100);
      });
    }
  });
});
