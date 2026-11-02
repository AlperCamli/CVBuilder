import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type { CvReviewVerifyAiOutput } from "../ai/flows/flow-contracts";
import {
  analyze, band, buildAiReviewInput, EXPERIENCE, flattenFields, impactCap, LEVEL_POINTS, looseText, normalize, SKILLS, strings, structureDimension,
  type ContentAnalysis, type CvReviewAiInput, type ReviewInput
} from "./cv-review";
import { CV_REVIEW_VERSION, type CvReview, type ReviewDimension, type ReviewDimensionId } from "./cv-review.types";

// Improvement score (cv-scoring.md, "Improvement score"). After "Improve with AI" the score is not
// re-rated from scratch: each assessed dimension of the stored review moves up its remaining gap by
//   new = before + (100 - before) * BETA * ln(1 + ALPHA * r) / ln(1 + ALPHA)
// where r in [0, 1] is the verified share of the dimension's problem that the rewrite fixed. The
// scoring math in cv-review.ts is reused, never changed.

/** Largest share of a dimension's remaining gap one improvement can close (r = 1). */
export const IMPROVEMENT_BETA = 0.6;
/** Curvature of the log shape: the first fixes count more than the last ones. */
export const IMPROVEMENT_ALPHA = 4;
/** Criteria whose r comes from the AI verification (cv_review_verify). */
export const AI_VERIFIED_CRITERIA = ["wording", "depth", "focus"] as const;
export type VerifiedCriterionId = (typeof AI_VERIFIED_CRITERIA)[number];
export const RESOLUTION_R = { none: 0, partial: 0.5, full: 1 } as const;
export const IMPROVEMENT_LIMITATION = "This score was updated after an AI improvement: each dimension keeps its original rating and rises only by the fixes we could verify in the improved CV.";
const MAX_FEEDBACK_CHARS = 400;
const MIN_QUOTE_CHARS = 8;

export const clampR = (r: number): number => Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;

/** The anchored, log-shaped formula. Never below `before`, never above 100. */
export function improvedPoints(before: number, r: number): number {
  const gap = Math.max(0, 100 - before);
  return before + gap * IMPROVEMENT_BETA * Math.log(1 + IMPROVEMENT_ALPHA * clampR(r)) / Math.log(1 + IMPROVEMENT_ALPHA);
}

/** The review total before rounding: sum(score * weight) / sum(assessed weights), as in cv-review.ts. */
export function weightedTotal(dimensions: Array<Pick<ReviewDimension, "weight" | "score">>): number | null {
  const assessed = dimensions.filter(d => d.score !== null);
  const weight = assessed.reduce((sum, d) => sum + d.weight, 0);
  return weight ? assessed.reduce((sum, d) => sum + d.weight * d.score!, 0) / weight : null;
}
export const roundScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

// Impact: share of experience statements with figures, counted with the scoring's own rule (hasMetric).
const figureShare = ({ narratives, measurable }: ContentAnalysis): number => narratives.length ? measurable / narratives.length : 0;
export function impactR(before: ContentAnalysis, after: ContentAnalysis): number {
  const shareBefore = figureShare(before);
  if (shareBefore >= 1) return 0;
  return clampR((figureShare(after) - shareBefore) / (1 - shareBefore));
}

// Skills evidence: listed skills that experience/project text did not mention before.
const listedSkills = (analysis: ContentAnalysis): string[] => [...new Set(analysis.populated
  .filter(section => SKILLS.has(section.type))
  .flatMap(section => section.blocks.flatMap(block => Object.values(block.fields).flatMap(strings)))
  .flatMap(value => value.split(/[,;|•\n]+/))
  .map(value => normalize(value))
  .filter(value => value.length > 0 && value.length <= 60 && value.split(" ").length <= 6))];
const experienceText = (analysis: ContentAnalysis): string => normalize(analysis.populated
  .filter(section => EXPERIENCE.has(section.type))
  .flatMap(section => section.blocks.map(block => flattenFields(block.fields)))
  .join("\n"));
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Case-insensitive match of a whole skill (not inside a longer word). */
export const mentionsSkill = (text: string, skill: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(skill)}(?![\\p{L}\\p{N}])`, "u").test(text);
export function skillsEvidenceR(before: ContentAnalysis, after: ContentAnalysis): number {
  const beforeText = experienceText(before);
  const unbacked = listedSkills(before).filter(skill => !mentionsSkill(beforeText, skill));
  if (!unbacked.length) return 0;
  const afterText = experienceText(after);
  return clampR(unbacked.filter(skill => mentionsSkill(afterText, skill)).length / unbacked.length);
}

/**
 * The text the AI review received, loosened for quote matching. Mirrors scoreAiReview: a quote
 * counts only when it appears there (ignoring case, spacing, bullets and quotation marks) and is
 * at least 8 characters long.
 */
export const quoteCorpus = (input: CvReviewAiInput): string => looseText(input.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => [block.heading, ...block.lines])]).join("\n"));
export const verifyQuote = (corpus: string, quote: string | null | undefined): string | null => {
  const loose = quote ? looseText(quote) : "";
  return loose.length >= MIN_QUOTE_CHARS && corpus.includes(loose) ? quote!.trim() : null;
};

export interface CvReviewVerifyCriterionInput { id: VerifiedCriterionId; issue: string | null; fix: string | null; quote: string | null }
export interface CvReviewVerifyAiInput {
  language: string;
  criteria: CvReviewVerifyCriterionInput[];
  before: { sections: CvReviewAiInput["sections"] };
  after: { sections: CvReviewAiInput["sections"] };
}

const clip = (text: string | null | undefined): string | null => {
  const value = text?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, MAX_FEEDBACK_CHARS) : null;
};

/**
 * The original issue, fix and quote of one criterion, recovered from the stored v2 review.
 * AI reviews keep the fix in the dimension's check `suggestion` and "assessment “quote”" in its
 * `evidence`; the issue only survives in `improvements` ("issue “quote” fix"), which keeps the top
 * six, so the assessment stands in when it was cut. Basic reviews use their failing checks.
 */
export function criterionFeedback(review: CvReview, dimension: ReviewDimension): Omit<CvReviewVerifyCriterionInput, "id"> | null {
  if (review.method === "basic") {
    const failing = dimension.checks.filter(check => check.points < check.max_points);
    const issue = clip(failing.map(check => check.evidence).join(" "));
    const fix = clip(failing.map(check => check.suggestion).join(" "));
    return issue || fix ? { issue, fix, quote: null } : null;
  }
  const check = dimension.checks[0];
  if (!check) return null;
  const fix = check.suggestion?.trim() || null;
  const evidence = check.evidence ?? "";
  const quoted = /^(.*?)\s*“(.+)”$/s.exec(evidence);
  const assessment = (quoted ? quoted[1] : evidence).trim() || null;
  const quote = quoted ? quoted[2] : null;
  let issue: string | null = null;
  const stored = fix ? review.improvements.find(text => text !== fix && text.endsWith(` ${fix}`)) : undefined;
  if (stored && fix) {
    let prefix = stored.slice(0, stored.length - fix.length).trimEnd();
    if (quote && prefix.endsWith(`“${quote}”`)) prefix = prefix.slice(0, prefix.length - quote.length - 2).trimEnd();
    issue = prefix || null;
  }
  issue = clip(issue ?? assessment);
  return issue || fix ? { issue, fix: clip(fix), quote: clip(quote) } : null;
}

/** r per verified criterion: the resolution counts only when its quote is really in the improved text. */
export function verifiedResolutions(output: CvReviewVerifyAiOutput, sent: readonly VerifiedCriterionId[], after: CvReviewAiInput): Partial<Record<VerifiedCriterionId, number>> {
  const corpus = quoteCorpus(after);
  const result: Partial<Record<VerifiedCriterionId, number>> = {};
  for (const id of sent) {
    const entry = output.criteria.find(criterion => criterion.id === id);
    const r = entry ? RESOLUTION_R[entry.resolution] : 0;
    result[id] = r > 0 && verifyQuote(corpus, entry!.evidence_quote) ? r : 0;
  }
  return result;
}

export interface ScoreImprovementInput {
  /** The stored original review (imports.review_context.cv_review), never a client value. */
  review: CvReview;
  /** The content and evidence the original review was computed from. */
  before: ReviewInput;
  /** The content returned by Improve with AI. */
  after_content: CvContent;
  /** Runs cv_review_verify. Absent, failing or invalid: r = 0 for wording, depth and focus. */
  verify?: (input: CvReviewVerifyAiInput) => Promise<CvReviewVerifyAiOutput>;
  onVerifyFailure?: (error: unknown) => void;
}

export interface ScoreImprovementResult {
  before: number;
  after: number;
  /** Unrounded totals, for checks and tests. */
  total_before: number;
  total_after: number;
  r: Partial<Record<ReviewDimensionId, number>>;
  review_after: CvReview;
}

/** Null when the original review cannot anchor an improvement (unscorable, image-based or not v2). */
export async function computeScoreImprovement(input: ScoreImprovementInput): Promise<ScoreImprovementResult | null> {
  const { review } = input;
  if (review.version !== CV_REVIEW_VERSION || review.status === "unscorable" || typeof review.score !== "number" || review.ats_blocker) return null;
  const beforeAnalysis = analyze(input.before);
  if (!beforeAnalysis) return null;
  const afterReviewInput: ReviewInput = { ...input.before, content: input.after_content };
  const afterAnalysis = analyze(afterReviewInput);
  const assessed = new Map(review.dimensions.filter(d => d.score !== null).map(d => [d.id, d]));

  const r: Partial<Record<ReviewDimensionId, number>> = {};
  if (afterAnalysis) {
    if (assessed.has("impact")) r.impact = impactR(beforeAnalysis, afterAnalysis);
    if (assessed.has("skills_evidence")) r.skills_evidence = skillsEvidenceR(beforeAnalysis, afterAnalysis);
  }
  // Only criteria the original review scored, with room to improve, are sent for verification.
  const criteria = AI_VERIFIED_CRITERIA.flatMap(id => {
    const dimension = assessed.get(id);
    if (!dimension || dimension.score! >= 100) return [];
    const feedback = criterionFeedback(review, dimension);
    return feedback ? [{ id, ...feedback }] : [];
  });
  for (const id of AI_VERIFIED_CRITERIA) if (assessed.has(id)) r[id] = 0;
  const beforeAi = afterAnalysis && criteria.length && input.verify ? buildAiReviewInput(input.before) : null;
  const afterAi = beforeAi ? buildAiReviewInput(afterReviewInput) : null;
  if (beforeAi && afterAi && input.verify) {
    try {
      const output = await input.verify({ language: input.after_content.language, criteria, before: { sections: beforeAi.sections }, after: { sections: afterAi.sections } });
      Object.assign(r, verifiedResolutions(output, criteria.map(c => c.id), afterAi));
    } catch (error) {
      input.onVerifyFailure?.(error);
    }
  }

  const exact = new Map<ReviewDimensionId, number>();
  const dimensions = review.dimensions.map((dimension): ReviewDimension => {
    if (dimension.score === null) return dimension;
    const before = dimension.score;
    if (dimension.id === "ats") return dimension;
    if (dimension.id === "structure") {
      const recomputed = afterAnalysis ? structureDimension(afterAnalysis) : null;
      if (recomputed?.score != null && recomputed.score > before) {
        exact.set(dimension.id, recomputed.score);
        return { ...recomputed, weight: dimension.weight };
      }
      return dimension;
    }
    let points = improvedPoints(before, r[dimension.id] ?? 0);
    // Impact can never pass what the improved statements' figures support (the scoring's cap).
    if (dimension.id === "impact" && afterAnalysis) points = Math.min(points, Math.max(before, LEVEL_POINTS[impactCap(afterAnalysis).level]));
    if (points === before) return dimension;
    exact.set(dimension.id, points);
    return { ...dimension, score: Math.round(points * 100) / 100 };
  });

  const totalBefore = weightedTotal(review.dimensions)!;
  const totalAfter = weightedTotal(review.dimensions.map(d => ({ weight: d.weight, score: exact.get(d.id) ?? d.score })))!;
  const after = Math.max(review.score, roundScore(totalAfter));
  const bandPrefix = `${band(review.score)}. `;
  return {
    before: review.score,
    after,
    total_before: totalBefore,
    total_after: totalAfter,
    r,
    review_after: {
      ...review,
      score: after,
      summary: review.summary.startsWith(bandPrefix) ? `${band(after)}. ${review.summary.slice(bandPrefix.length)}` : review.summary,
      dimensions,
      limitations: [...review.limitations, IMPROVEMENT_LIMITATION]
    }
  };
}
