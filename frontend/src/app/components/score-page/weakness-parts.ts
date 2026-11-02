import type { CvReview } from "../../integration/api-types";

/** One weakness as the score page shows it: the issue, an optional quoted CV line and an optional fix. */
export interface WeaknessParts {
  text: string;
  issue: string;
  quote: string | null;
  fix: string | null;
}

// The first “…” pair: what comes before is the issue, what comes after is the fix.
const QUOTED = /^([\s\S]*?)\s*“([^”]+)”\s*([\s\S]*)$/;

/**
 * Splits a stored weakness string ("issue “quote” fix", as the AI review joins it) into its parts.
 * Used for reviews saved before `improvement_details` existed. Without a quote the whole string
 * is the issue and there is no fix box.
 */
export function splitWeakness(text: string): WeaknessParts {
  const whole = text.trim();
  const match = QUOTED.exec(whole);
  const quote = match?.[2].trim();
  if (!match || !quote) return { text, issue: whole, quote: null, fix: null };
  const before = match[1].trim();
  const after = match[3].trim();
  if (!before && !after) return { text, issue: whole, quote: null, fix: null };
  // No issue before the quote: the fix leads, as the backend does when the AI gave no issue.
  if (!before) return { text, issue: after, quote, fix: null };
  return { text, issue: before, quote, fix: after || null };
}

/**
 * The weaknesses of a review, split into parts. Structured details are used only when they
 * line up with `improvements` entry for entry; anything else falls back to splitting the strings.
 */
export function weaknessParts(review: Pick<CvReview, "improvements" | "improvement_details">): WeaknessParts[] {
  const details = review.improvement_details;
  const aligned = Array.isArray(details)
    && details.length === review.improvements.length
    && details.every((detail, index) => detail?.text === review.improvements[index] && typeof detail.issue === "string" && detail.issue.trim() !== "");
  if (aligned) return details!.map(detail => ({ text: detail.text, issue: detail.issue, quote: detail.quote || null, fix: detail.fix || null }));
  return review.improvements.map(splitWeakness);
}
