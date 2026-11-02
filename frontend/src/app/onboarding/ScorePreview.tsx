import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { translate as t } from "../localization/i18n";
import { reviewText } from "../localization/review-text";
import type { GuestReviewPreview } from "../integration/guest-import";
import { isImageBasedReview, scoreTone } from "./onboarding-flow";
import { AtsImageWarning } from "../components/AtsImageWarning";

/** Compact pre-signup version of the score page: overall score and the top fixes. */
export function ScorePreview({ review }: { review: GuestReviewPreview }) {
  useTranslation();
  if (typeof review.score !== "number") {
    return (
      <div className="ob-score-preview is-unscored" role="status">
        <AlertCircle size={20} aria-hidden="true" />
        <div>
          <strong>{t("Score unavailable")}</strong>
          {review.summary && <p>{reviewText(review.summary)}</p>}
        </div>
      </div>
    );
  }
  const score = Math.max(0, Math.min(100, Math.round(review.score)));
  const circumference = 2 * Math.PI * 34;
  const imageBased = isImageBasedReview(review);
  // The warning already explains the first (ATS) fix of an image-based CV.
  const fixes = review.improvements.slice(imageBased ? 1 : 0, 3);
  const preview = (
    <div className={`ob-score-preview is-${scoreTone(score)}`}>
      <div className="ob-score-ring" role="img" aria-label={t("CV score: {{score}} out of 100", { score })}>
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="34" fill="none" strokeWidth="8" className="ob-score-ring-track" />
          <circle cx="42" cy="42" r="34" fill="none" strokeWidth="8" strokeLinecap="round" className="ob-score-ring-value"
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`} transform="rotate(-90 42 42)" />
        </svg>
        <span><strong>{score}</strong><small>{"/100"}</small></span>
      </div>
      <div className="ob-score-fixes">
        {fixes.length ? (
          <>
            <h2>{t("Top things to fix")}</h2>
            <ul>
              {fixes.map(fix => <li key={fix}><span aria-hidden="true" />{reviewText(fix)}</li>)}
            </ul>
          </>
        ) : (
          imageBased ? null : <p className="ob-score-solid"><CheckCircle2 size={16} aria-hidden="true" />{t("Your CV is in good shape. Tailor it to a job to stand out.")}</p>
        )}
      </div>
    </div>
  );
  if (!imageBased) return preview;
  return (
    <>
      <AtsImageWarning className="ob-ats-warning" />
      {preview}
    </>
  );
}
