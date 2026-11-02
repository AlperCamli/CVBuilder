import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { motion, useReducedMotion, useTransform } from "motion/react";
import { reviewText } from "../localization/review-text";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, ChevronDown, TrendingUp } from "lucide-react";
import type { CvReview } from "../integration/api-types";
import { scoreTone } from "../onboarding/onboarding-flow";
import { ScoreRing } from "./score-page/ScoreRing";
import { StrengthCard } from "./score-page/StrengthCard";
import { WeaknessCard } from "./score-page/WeaknessCard";
import { SkipRevealPill } from "./score-page/SkipRevealPill";
import { useRevealSequence } from "./score-page/useRevealSequence";
import { useRise, useSpan } from "./score-page/motion-helpers";
import { weaknessParts } from "./score-page/weakness-parts";
import {
  buildRevealTimeline, hasSeenReveal, itemIds, markRevealSeen, revealMode, sessionStore, type RevealMode, type Span
} from "./score-page/reveal-timeline";
import "./score-page/score-page.css";

const strengthLabels: Record<string, string> = {
  "Measurable results": "Your experience shows measurable results.",
  "Wording and clarity": "Your experience statements are clear and specific.",
  "Experience depth": "Your roles show real scope and ownership.",
  "Role focus": "Your CV clearly targets a role.",
  "Skills backed by experience": "Your skills are backed by your experience.",
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

/** Opt-in reveal for the CV Score page. Without it the panel shows its final state at once. */
export interface CvReviewReveal {
  /** The review's import id: the cascade plays only on its first view in this browser session. */
  key?: string;
  /** Image-based CVs: a simple fade instead of the cascade. */
  simple?: boolean;
  /** The page's action buttons; the primary one ([data-reveal-primary]) gets one pulse at the end. */
  actionsRef?: RefObject<HTMLElement | null>;
}

export function CvReviewPanel({ review, reveal }: { review: CvReview; reveal?: CvReviewReveal }) {
  useTranslation();
  const reduced = useReducedMotion() === true;
  // Read once per mount, so marking the review as seen below never cuts its own sequence short.
  const [seen] = useState(() => hasSeenReveal(sessionStore(), reveal?.key));
  const mode = revealMode({ enabled: Boolean(reveal), reduced, scorable: review.score !== null, simple: Boolean(reveal?.simple), seen });
  const revealKey = reveal?.key;
  useEffect(() => {
    if (mode !== "static") markRevealSeen(sessionStore(), revealKey);
  }, [mode, revealKey]);
  return <ReviewContent key={mode} review={review} mode={mode} actionsRef={reveal?.actionsRef} />;
}

function ReviewContent({ review, mode, actionsRef }: { review: CvReview; mode: RevealMode; actionsRef?: RefObject<HTMLElement | null> }) {
  const unscorable = review.score === null;
  const strengthTitles = review.strengths.map(strength => strength.split(": ")[0]);
  const conciseStrengths = strengthTitles.filter(title => title !== "Readable text layer" || !strengthTitles.includes("Text extraction quality")).slice(0, 3);
  const weaknesses = useMemo(() => weaknessParts(review).slice(0, 3), [review]);
  const timeline = useMemo(() => buildRevealTimeline({
    strengths: conciseStrengths.length,
    weaknesses: weaknesses.map(weakness => ({ quote: Boolean(weakness.quote), fix: Boolean(weakness.fix) }))
  }), [conciseStrengths.length, weaknesses]);
  const sequence = useRevealSequence({ mode, timeline, actionsRef });
  const { clock, register } = sequence;
  const animated = mode === "sequence";

  const scoreClock = clock(itemIds.score);
  const blockOpacity = useSpan(scoreClock, animated ? timeline.block : null);
  const blockScale = useTransform(blockOpacity, p => 0.985 + 0.015 * p);
  const verdict = useRise(clock(itemIds.verdict), animated ? timeline.verdict : null, 6);
  const howOpacity = useSpan(clock(itemIds.how), animated ? timeline.how : null, x => x);
  const tone = unscorable ? "fair" : scoreTone(review.score!);

  return (
    <div className={mode === "fade" ? "sp-root sp-fade" : "sp-root"} data-tone={tone}>
      <motion.section ref={register(itemIds.score)} className="sp-score" aria-label={t("Your CV Score")} style={{ opacity: blockOpacity, scale: blockScale }}>
        {unscorable ? (
          <>
            <AlertCircle size={32} className="mx-auto" style={{ color: "var(--sp-tone)" }} aria-hidden="true" />
            <p className="sp-unscored-title">{t("Score unavailable")}</p>
            <p className="sp-unscored-text">{reviewText(review.summary)}</p>
          </>
        ) : (
          <>
            <ScoreRing score={review.score!} clock={scoreClock} sweep={animated ? timeline.ring : [0, 0]} />
            <motion.p ref={register(itemIds.verdict)} className="sp-verdict" style={verdict}>{reviewText(review.summary.split(". ")[0])}</motion.p>
          </>
        )}
      </motion.section>

      {conciseStrengths.length ? (
        <section className="sp-section" data-kind="strengths" aria-label={t("Strengths")}>
          <SectionHeading id={itemIds.strengths} sequence={sequence} span={animated ? timeline.strengthsHeading : null} icon={<Check size={16} strokeWidth={2.2} />} title={t("Strengths")} note={t("Keep these")} />
          <ul className="sp-list">
            {conciseStrengths.map((strength, index) => (
              <StrengthCard
                key={strength}
                text={t(strengthLabels[strength] ?? strength)}
                clock={clock(itemIds.strength(index))}
                slot={animated ? timeline.strengths[index] ?? null : null}
                itemRef={register(itemIds.strength(index))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {weaknesses.length ? (
        <section className="sp-section" data-kind="weaknesses" aria-label={unscorable ? t("Next steps") : t("Weaknesses")}>
          <SectionHeading id={itemIds.weaknesses} sequence={sequence} span={animated ? timeline.weaknessesHeading : null} icon={<TrendingUp size={16} strokeWidth={2.2} />} title={unscorable ? t("Next steps") : t("Weaknesses")} note={unscorable ? null : t("All fixable")} />
          <ol className="sp-list">
            {weaknesses.map((weakness, index) => (
              <WeaknessCard
                key={weakness.text}
                index={index}
                issue={reviewText(weakness.issue)}
                quote={weakness.quote}
                fix={weakness.fix ? reviewText(weakness.fix) : null}
                clock={clock(itemIds.weakness(index))}
                slot={animated ? timeline.weaknesses[index] ?? null : null}
                itemRef={register(itemIds.weakness(index))}
              />
            ))}
          </ol>
        </section>
      ) : null}

      <motion.details ref={register(itemIds.how)} className="group sp-how" style={{ opacity: howOpacity }}>
        <summary>{t("How we evaluate your CV")}<ChevronDown size={16} className="shrink-0 group-open:rotate-180" aria-hidden="true" /></summary>
        <p className="mt-4">{reviewText(review.summary)}</p>
        <p className="mt-3">{t("Content criteria are rated against a strict rubric, so a high score has to be earned. Structure and parseability are checked automatically.")}</p>
        {!unscorable ? (
        <section aria-label={t("Score breakdown")} className="space-y-3 mt-4">
          <h2 className="font-medium text-base" style={{ color: "var(--sp-text)" }}>{t("Score breakdown")}</h2>
          {review.dimensions.map(dimension => (
            <details key={dimension.id} className="rounded-xl border p-3" style={{ borderColor: "var(--color-border-secondary)" }}>
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{t(dimension.label)}</span>
                <span className="ml-2" style={{ color: "var(--color-text-secondary)" }}>
                  {dimension.score === null ? t("Not assessed") : `${dimension.score}/100`} {" "}{t("· weight")}{" "}{dimension.weight}{"%"}</span>
              </summary>
              {dimension.score !== null ? <progress className="w-full h-2 mt-3" value={dimension.score} max={100} aria-label={`${dimension.label} score`} style={{ accentColor: "var(--color-teal-600)" }} /> : null}
              {dimension.reason ? <p className="text-xs mt-3 leading-5" style={{ color: "var(--color-text-secondary)" }}>{reviewText(dimension.reason)}</p> : null}
              <ul className="space-y-3 mt-3">
                {dimension.checks.map(check => (
                  <li key={check.id} className="text-xs leading-5">
                    <p className="font-medium">{t(check.label)} {"·"}{check.points}{"/"}{check.max_points} {"points"}</p>
                    <p style={{ color: "var(--color-text-secondary)" }}>{reviewText(check.evidence)}</p>
                    {check.points < check.max_points ? <p className="mt-1">{reviewText(check.suggestion)}</p> : null}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
        ) : null}
        {review.strengths.length ? <section className="mt-4"><h3 className="font-medium mb-2">{t("Strength details")}</h3><ul className="list-disc pl-5 space-y-2">{review.strengths.map(strength => <li key={strength}>{strength}</li>)}</ul></section> : null}
        {review.improvements.length > 3 ? <section className="mt-4"><h3 className="font-medium mb-2">{t("All suggested improvements")}</h3><ul className="list-disc pl-5 space-y-2">{review.improvements.map(improvement => <li key={improvement}>{reviewText(improvement)}</li>)}</ul></section> : null}
        {review.matched_keywords.length || review.missing_keywords.length ? (
        <section aria-label={t("Job keywords")} className="text-sm leading-6 mt-4">
          <h2 className="font-medium text-base mb-2">{t("Job keywords")}</h2>
          <p><span className="font-medium">{t("Found:")}{" "}</span>{review.matched_keywords.join(", ") || t("None")}</p>
          <p className="mt-2"><span className="font-medium">{t("Missing:")}{" "}</span>{review.missing_keywords.join(", ") || t("None")}</p>
          <p className="text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>{t("Include a missing term only if it accurately describes your skills or experience.")}</p>
        </section>
        ) : null}
        <p className="mt-4">{t("The total is the weighted average of assessed dimensions: sum of (dimension score × weight) ÷ sum of assessed weights. Unassessed dimensions receive no points or penalty. Scores with different assessed dimensions should not be compared.")}</p>
        <ul className="list-disc pl-5 mt-2 space-y-2">{review.limitations.map(limitation => <li key={limitation}>{reviewText(limitation)}</li>)}</ul>
        <p className="mt-2">{t("Review formula:")}{" "}{review.version}</p>
      </motion.details>

      {animated ? <SkipRevealPill visible={sequence.playing} progress={sequence.progress} onSkip={sequence.skip} /> : null}
    </div>
  );
}

function SectionHeading({ id, sequence, span, icon, title, note }: {
  id: string;
  sequence: ReturnType<typeof useRevealSequence>;
  span: Span | null;
  icon: ReactNode;
  title: string;
  note: string | null;
}) {
  const style = useRise(sequence.clock(id), span, 6);
  return (
    <motion.div ref={sequence.register(id)} className="sp-heading" style={style}>
      <span className="sp-heading-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {note ? <span className="sp-heading-note">{note}</span> : null}
    </motion.div>
  );
}
