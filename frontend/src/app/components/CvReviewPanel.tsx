import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { CvReview, TailoringReview } from "../integration/api-types";

export function CvReviewPanel({ review }: { review: CvReview }) {
  const unscorable = review.score === null;
  const tone = unscorable ? "var(--color-yellow-700)" : review.score! >= 80 ? "var(--color-teal-600)" : review.score! >= 60 ? "var(--color-yellow-700)" : "var(--color-red-600)";
  return (
    <div className="space-y-6" style={{ color: "var(--color-text-primary)" }}>
      <div className="text-center rounded-xl p-6" style={{ background: "var(--color-background-secondary)" }}>
        {unscorable ? <AlertCircle size={32} className="mx-auto mb-3" style={{ color: tone }} /> : null}
        <p className="font-medium" style={{ fontSize: unscorable ? "20px" : "48px", color: tone }}>
          {unscorable ? "Score unavailable" : <>{review.score}<span style={{ fontSize: "18px", color: "var(--color-text-secondary)" }}> / 100</span></>}
        </p>
        <p className="mt-2 text-sm leading-6">{review.summary}</p>
        {review.status === "partial" ? <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>Partial review · {review.assessed_weight}% of the rubric assessed</p> : null}
      </div>

      {!unscorable ? (
        <section aria-label="Score breakdown" className="space-y-3">
          <h2 className="font-medium text-base">Score breakdown</h2>
          {review.dimensions.map(dimension => (
            <details key={dimension.id} className="rounded-xl border p-3" style={{ borderColor: "var(--color-border-secondary)" }}>
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{dimension.label}</span>
                <span className="ml-2" style={{ color: "var(--color-text-secondary)" }}>
                  {dimension.score === null ? "Not assessed" : `${dimension.score}/100`} · weight {dimension.weight}%
                </span>
              </summary>
              {dimension.score !== null ? <progress className="w-full h-2 mt-3" value={dimension.score} max={100} aria-label={`${dimension.label} score`} style={{ accentColor: "var(--color-teal-600)" }} /> : null}
              {dimension.reason ? <p className="text-xs mt-3 leading-5" style={{ color: "var(--color-text-secondary)" }}>{dimension.reason}</p> : null}
              <ul className="space-y-3 mt-3">
                {dimension.checks.map(check => (
                  <li key={check.id} className="text-xs leading-5">
                    <p className="font-medium">{check.label} · {check.points}/{check.max_points} points</p>
                    <p style={{ color: "var(--color-text-secondary)" }}>{check.evidence}</p>
                    {check.points < check.max_points ? <p className="mt-1">{check.suggestion}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ) : null}

      {review.strengths.length ? (
        <section aria-label="What works well">
          <h2 className="font-medium text-base mb-3 flex items-center gap-2"><CheckCircle2 size={18} style={{ color: "var(--color-teal-600)" }} /> What works well</h2>
          <ul className="list-disc pl-5 space-y-2 text-sm leading-6" style={{ color: "var(--color-text-secondary)" }}>
            {review.strengths.map(strength => <li key={strength}>{strength}</li>)}
          </ul>
        </section>
      ) : null}

      {review.improvements.length ? (
        <section aria-label="Priority improvements">
          <h2 className="font-medium text-base mb-3 flex items-center gap-2"><AlertCircle size={18} /> {unscorable ? "Next steps" : "Priority improvements"}</h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm leading-6" style={{ color: "var(--color-text-secondary)" }}>
            {review.improvements.map(improvement => <li key={improvement}>{improvement}</li>)}
          </ol>
        </section>
      ) : null}

      {review.matched_keywords.length || review.missing_keywords.length ? (
        <section aria-label="Job keywords" className="text-sm leading-6">
          <h2 className="font-medium text-base mb-2">Job keywords</h2>
          <p><span className="font-medium">Found: </span>{review.matched_keywords.join(", ") || "None"}</p>
          <p className="mt-2"><span className="font-medium">Missing: </span>{review.missing_keywords.join(", ") || "None"}</p>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>Include a missing term only if it accurately describes your skills or experience.</p>
        </section>
      ) : null}

      <details className="text-xs leading-5" style={{ color: "var(--color-text-secondary)" }}>
        <summary className="cursor-pointer font-medium">How we evaluate your CV</summary>
        <p className="mt-3">Each dimension uses the checks shown above. The total is the weighted average of assessed dimensions: sum of (dimension score × weight) ÷ sum of assessed weights. Unassessed dimensions receive no points or penalty. Scores with different assessed dimensions should not be compared.</p>
        <ul className="list-disc pl-5 mt-2 space-y-2">{review.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>
        <p className="mt-2">Review formula: {review.version}</p>
      </details>
    </div>
  );
}

export function TailoringReviewPanel({ review }: { review: TailoringReview }) {
  return (
    <div className="space-y-5 text-sm leading-6" style={{ color: "var(--color-text-primary)" }}>
      <p>{review.summary}</p>
      <div className="grid grid-cols-2 gap-3 text-center">
        {[{ label: "Before tailoring", score: review.before.score }, { label: "After tailoring", score: review.after.score }].map(item => (
          <div key={item.label} className="rounded-xl p-4" style={{ background: "var(--color-background-secondary)" }}>
            <p style={{ color: "var(--color-text-secondary)" }}>{item.label}</p>
            <p className="text-3xl font-medium mt-1">{item.score === null ? "Unavailable" : `${item.score}/100`}</p>
          </div>
        ))}
      </div>
      <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>This comparison was captured when the draft was generated. Both CVs use the same job criteria. Later edits are not included.</p>
      {review.changed_sections.length ? <p><span className="font-medium">Content changed in: </span>{review.changed_sections.map(type => type.replace(/_/g, " ")).join(", ")}.</p> : null}
      {review.changes.length ? <section aria-label="Why the score changed">
        <h3 className="font-medium mb-2">Why the score changed</h3>
        <ul className="space-y-3">{review.changes.map(change => <li key={change.dimension} className="rounded-lg border p-3" style={{ borderColor: "var(--color-border-secondary)" }}>
          <p className="font-medium">{change.label}: {change.before} → {change.after}</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>{change.reason}</p>
        </li>)}</ul>
      </section> : null}
      {review.added_keywords.length ? <p><span className="font-medium">New job terms covered: </span>{review.added_keywords.join(", ")}.</p> : null}
      {review.removed_keywords.length ? <p><span className="font-medium">Job terms no longer covered: </span>{review.removed_keywords.join(", ")}.</p> : null}
      <CvReviewPanel review={review.after} />
    </div>
  );
}
