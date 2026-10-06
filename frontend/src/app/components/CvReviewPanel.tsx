import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import type { CvReview, TailoringReview } from "../integration/api-types";

const strengthLabels: Record<string, string> = {
  "Text extraction quality": "Your CV text is clear and readable.",
  "Readable text layer": "Your document has selectable text.",
  "Name and contact details": "Your name and contact details are included.",
  "Experience or projects": "Work experience or projects are included.",
  "Education or qualifications": "Education or qualifications are included.",
  Skills: "Your skills are listed.",
  "Clear, concise experience statements": "Your experience statements are concise.",
  "Statements beginning with an action": "Your experience uses action verbs.",
  "Wording without generic phrases": "Your wording avoids generic phrases.",
  "Statements with measurable scope or results": "Your experience includes measurable scope or results.",
  "Distinct section headings": "Your sections have clear headings.",
  "No empty content placeholders": "Your sections contain no empty placeholders.",
  "No detected broken text characters": "No broken text characters were found."
};

export function CvReviewPanel({ review }: { review: CvReview }) {
  const unscorable = review.score === null;
  const tone = unscorable ? "var(--color-yellow-700)" : review.score! >= 80 ? "var(--color-teal-600)" : review.score! >= 60 ? "var(--color-yellow-700)" : "var(--color-red-600)";
  const background = unscorable ? "var(--color-yellow-50)" : review.score! >= 80 ? "var(--color-teal-50)" : review.score! >= 60 ? "var(--color-yellow-50)" : "var(--color-red-50)";
  const circumference = 2 * Math.PI * 90;
  const strengthTitles = review.strengths.map(strength => strength.split(": ")[0]);
  const conciseStrengths = strengthTitles.filter(title => title !== "Readable text layer" || !strengthTitles.includes("Text extraction quality")).slice(0, 3);
  return (
    <div className="space-y-6" style={{ color: "var(--color-text-primary)" }}>
      <div className="text-center rounded-2xl p-6" style={{ background }}>
        {unscorable ? (
          <>
            <AlertCircle size={32} className="mx-auto mb-3" style={{ color: tone }} />
            <p className="text-xl font-medium" style={{ color: tone }}>Score unavailable</p>
            <p className="mt-2 text-sm leading-6">{review.summary}</p>
          </>
        ) : (
          <>
            <div className="relative mx-auto h-[200px] w-[200px]">
              <svg className="-rotate-90" width="200" height="200" aria-hidden="true">
                <circle cx="100" cy="100" r="90" fill="none" stroke="var(--color-border-secondary)" strokeWidth="12" />
                <circle cx="100" cy="100" r="90" fill="none" stroke={tone} strokeWidth="12" strokeDasharray={`${(review.score! / 100) * circumference} ${circumference}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center" aria-label={`CV score: ${review.score} out of 100`}>
                <p className="font-medium text-5xl" style={{ color: tone }}>{review.score}</p>
                <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>out of 100</p>
              </div>
            </div>
            <p className="font-medium mt-4" style={{ color: tone }}>{review.summary.split(". ")[0]}</p>
          </>
        )}
      </div>

      {review.strengths.length ? (
        <section aria-label="Strengths" className="rounded-xl p-4" style={{ background: "var(--color-teal-50)", border: "1px solid var(--color-teal-100)" }}>
          <h2 className="font-medium text-base mb-3 flex items-center gap-2" style={{ color: "var(--color-teal-700)" }}><CheckCircle2 size={18} /> Strengths</h2>
          <ul className="space-y-2 text-sm leading-6">
            {conciseStrengths.map(strength => <li key={strength} className="flex items-start gap-2"><CheckCircle2 size={16} className="mt-1 shrink-0" style={{ color: "var(--color-teal-600)" }} /><span>{strengthLabels[strength] ?? strength}</span></li>)}
          </ul>
        </section>
      ) : null}

      {review.improvements.length ? (
        <section aria-label={unscorable ? "Next steps" : "Weaknesses"} className="rounded-xl p-4" style={{ background: "var(--color-yellow-50)", border: "1px solid var(--color-yellow-100)" }}>
          <h2 className="font-medium text-base mb-3 flex items-center gap-2" style={{ color: "var(--color-yellow-700)" }}><AlertCircle size={18} /> {unscorable ? "Next steps" : "Weaknesses"}</h2>
          <ul className="space-y-2 text-sm leading-6">
            {review.improvements.slice(0, 3).map(improvement => <li key={improvement} className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--color-yellow-600)" }} /><span>{improvement}</span></li>)}
          </ul>
        </section>
      ) : null}

      <details className="group rounded-xl border p-4 text-xs leading-5" style={{ borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}>
        <summary className="cursor-pointer font-medium flex items-center justify-between gap-2 text-sm" style={{ color: "var(--color-text-primary)" }}>How we evaluate your CV<ChevronDown size={16} className="shrink-0 group-open:rotate-180" /></summary>
        <p className="mt-4">{review.summary}</p>
        <p className="mt-3">Your score reflects the areas we can assess. Job relevance and keyword coverage require a job description.</p>
        {!unscorable ? (
        <section aria-label="Score breakdown" className="space-y-3 mt-4">
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
        {review.strengths.length ? <section className="mt-4"><h3 className="font-medium mb-2">Strength details</h3><ul className="list-disc pl-5 space-y-2">{review.strengths.map(strength => <li key={strength}>{strength}</li>)}</ul></section> : null}
        {review.improvements.length > 3 ? <section className="mt-4"><h3 className="font-medium mb-2">All suggested improvements</h3><ul className="list-disc pl-5 space-y-2">{review.improvements.map(improvement => <li key={improvement}>{improvement}</li>)}</ul></section> : null}
        {review.matched_keywords.length || review.missing_keywords.length ? (
        <section aria-label="Job keywords" className="text-sm leading-6 mt-4">
          <h2 className="font-medium text-base mb-2">Job keywords</h2>
          <p><span className="font-medium">Found: </span>{review.matched_keywords.join(", ") || "None"}</p>
          <p className="mt-2"><span className="font-medium">Missing: </span>{review.missing_keywords.join(", ") || "None"}</p>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>Include a missing term only if it accurately describes your skills or experience.</p>
        </section>
        ) : null}
        <p className="mt-4">The total is the weighted average of assessed dimensions: sum of (dimension score × weight) ÷ sum of assessed weights. Unassessed dimensions receive no points or penalty. Scores with different assessed dimensions should not be compared.</p>
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
