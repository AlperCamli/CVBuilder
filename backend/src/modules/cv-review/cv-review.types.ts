import type { ParseCvFileDiagnostics } from "../imports/parsers/cv-parser";

export type ReviewDimensionId = "ats" | "sections" | "relevance" | "keywords" | "quality" | "impact" | "formatting";

export interface ImportReviewContext {
  diagnostics: ParseCvFileDiagnostics | null;
  warnings: string[];
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

export interface CvReview {
  version: "cv-review-v1";
  status: "complete" | "partial" | "unscorable";
  score: number | null;
  assessed_weight: number;
  summary: string;
  dimensions: ReviewDimension[];
  strengths: string[];
  improvements: string[];
  matched_keywords: string[];
  missing_keywords: string[];
  limitations: string[];
}

export interface TailoringReview {
  version: "cv-review-v1";
  before: CvReview;
  after: CvReview;
  score_change: number | null;
  changes: Array<{ dimension: ReviewDimensionId; label: string; before: number; after: number; reason: string }>;
  added_keywords: string[];
  removed_keywords: string[];
  changed_sections: string[];
  summary: string;
}
