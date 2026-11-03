import type { GuestReviewPreview, GuestStatus } from "../integration/guest-import";
import type { QuestionId } from "./pre-signup-questions";

export type ProcessingPhase = "idle" | "parsing" | "ready" | "failed";

/** Delay between choosing an answer and moving on, long enough to see the selection. */
export const AUTO_ADVANCE_MS = 250;
const SECONDS_PER_QUESTION = 5;
/** After this, recovery actions appear while analysis keeps running. */
export const PARSE_SLOW_MS = 90_000;
/** Longer than the server's 240 s processing deadline; past it we stop waiting. */
export const PARSE_GIVE_UP_MS = 300_000;

export const QUESTION_FUNNEL_DETAIL: Record<QuestionId, string> = {
  goal: "goal",
  career: "career_stage",
  education: "education",
  source: "source",
};

export function remainingSeconds(questionIndex: number, total = 4) {
  return Math.max(1, total - questionIndex) * SECONDS_PER_QUESTION;
}

export function phaseFromStatus(status: GuestStatus["status"]): ProcessingPhase {
  return status === "parsed" || status === "claimed" ? "ready" : status === "failed" ? "failed" : "parsing";
}

/** Staged wording only; the backend reports no real percentage. */
export function parsingStage(elapsedMs: number) {
  if (elapsedMs < 10_000) return "Reading your CV…";
  if (elapsedMs < 30_000) return "Checking structure and wording…";
  return "Rating your experience…";
}

/** Funnel detail of the pre-signup preview; an image-based CV is counted apart from other scored CVs. */
export function previewKind(review: GuestReviewPreview | null | undefined): "scored" | "unscored" | "image_based" | null {
  if (!review) return null;
  if (isImageBasedReview(review)) return "image_based";
  return typeof review.score === "number" ? "scored" : "unscored";
}

/** A review of a PDF saved as an image: the UI leads with the ATS warning and the rebuild action. */
export function isImageBasedReview(review: { ats_blocker?: string | null } | null | undefined): boolean {
  return review?.ats_blocker === "image_based";
}

/** Score band shared with the score page: 80+ strong, 60+ fair, below needs work. */
export function scoreTone(score: number) {
  return score >= 80 ? "good" : score >= 60 ? "fair" : "low";
}

/** The score page with ?action=, where checkout returns to resume a free account's next step. */
export function scoreResumePath(options: {
  source: "guest" | "upload";
  action: "editor" | "tailor" | "improve";
  language?: string;
  importId?: string;
}): string {
  const params = new URLSearchParams({ source: options.source, action: options.action });
  if (options.language) params.set("language", options.language);
  if (options.importId) params.set("import", options.importId);
  return `/app/cv-score?${params}`;
}
