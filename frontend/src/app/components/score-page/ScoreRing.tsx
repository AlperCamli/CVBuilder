import { motion, useTransform, type MotionValue } from "motion/react";
import { translate as t } from "../../localization/i18n";
import { spanProgress, type Span } from "./reveal-timeline";
import { easeOut } from "./motion-helpers";

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The score ring: the arc sweeps to the score while the number counts up on the same curve.
 * The visible digits are decorative (aria-hidden); the score itself is in screen-reader text.
 */
export function ScoreRing({ score, clock, sweep }: { score: number; clock: MotionValue<number>; sweep: Span }) {
  const reached = useTransform(clock, v => score * spanProgress(v, sweep, easeOut));
  const offset = useTransform(reached, value => CIRCUMFERENCE * (1 - value / 100));
  // A round cap on a zero-length arc would still draw a dot.
  const arcOpacity = useTransform(reached, value => value < 0.5 ? 0 : 1);
  const digits = useTransform(reached, value => String(Math.round(value)));
  return (
    <div className="sp-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="sp-ring-track" cx="100" cy="100" r={RADIUS} fill="none" strokeWidth="12" />
        <motion.circle
          className="sp-ring-arc" cx="100" cy="100" r={RADIUS} fill="none" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE} style={{ strokeDashoffset: offset, opacity: arcOpacity }}
        />
      </svg>
      <div className="sp-ring-center">
        <motion.span className="sp-ring-number" aria-hidden="true">{digits}</motion.span>
        <span className="sr-only">{t("Your CV score: {{score}}", { score })}</span>
        <span className="sp-ring-of">{t("out of 100")}</span>
      </div>
    </div>
  );
}
