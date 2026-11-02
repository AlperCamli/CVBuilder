import type { ParseCvFileDiagnostics } from "../imports/parsers/cv-parser";

export const CV_REVIEW_VERSION = "cv-review-v2";

/** What the upload's AI review reads: the extracted text, alongside the AI parse, or the parsed sections after it. */
export type CvReviewInputMode = "raw" | "structured";

/** AI-rated content criteria first, then the two deterministic dimensions. */
export type AiReviewCriterionId = "impact" | "wording" | "depth" | "focus" | "skills_evidence";
export type ReviewDimensionId = AiReviewCriterionId | "structure" | "ats";

export interface ImportReviewContext {
  diagnostics: ParseCvFileDiagnostics | null;
  warnings: string[];
  cv_review?: CvReview;
}

export interface ReviewCheck {
  id: string;
  label: string;
  points: number;
  max_points: number;
  evidence: string;
  suggestion: string;
}

export interface ReviewDimension {
  id: ReviewDimensionId;
  label: string;
  weight: number;
  score: number | null;
  reason: string | null;
  checks: ReviewCheck[];
}

/**
 * One weakness split into its parts, for the score page's issue / quoted line / fix layout.
 * `text` is the matching `improvements` entry, unchanged.
 */
export interface ReviewImprovementDetail {
  text: string;
  issue: string;
  /** A line quoted from the CV (verified against its text), without quotation marks. */
  quote: string | null;
  fix: string | null;
}

export interface CvReview {
  version: typeof CV_REVIEW_VERSION;
  /** "ai": content criteria rated by the AI review; "basic": deterministic checks only. */
  method: "ai" | "basic";
  status: "complete" | "partial" | "unscorable";
  score: number | null;
  assessed_weight: number;
  summary: string;
  dimensions: ReviewDimension[];
  strengths: string[];
  improvements: string[];
  /**
   * `improvements` split into issue, quote and fix: same order, same entries, same length.
   * Absent on reviews stored before it was added; the frontend then splits the strings.
   */
  improvement_details?: ReviewImprovementDetail[];
  matched_keywords: string[];
  missing_keywords: string[];
  limitations: string[];
  /**
   * A problem that stops applicant tracking systems from reading the source file.
   * "image_based": the PDF has no usable text layer (see cv-scoring.md). Absent otherwise.
   */
  ats_blocker?: "image_based";
}
