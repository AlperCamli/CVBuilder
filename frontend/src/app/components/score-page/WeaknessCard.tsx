import { motion, useTransform, type MotionValue } from "motion/react";
import { CornerDownRight } from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { WeaknessSlot } from "./reveal-timeline";
import { easeBack, easeMarker, useRise, useSpan } from "./motion-helpers";

/**
 * One weakness as a numbered to-do: the issue, then the quoted CV line with a marker highlight
 * sweeping over it, then a "How to fix" box. Quote and fix are optional.
 */
export function WeaknessCard({ index, issue, quote, fix, clock, slot, itemRef }: {
  index: number;
  issue: string;
  quote: string | null;
  fix: string | null;
  clock: MotionValue<number>;
  slot: WeaknessSlot | null;
  itemRef?: (element: HTMLElement | null) => void;
}) {
  const { opacity, y } = useRise(clock, slot?.card ?? null, 10);
  const badge = useSpan(clock, slot?.badge ?? null, easeBack);
  const badgeScale = useTransform(badge, p => 0.5 + 0.5 * p);
  const quoteOpacity = useSpan(clock, slot?.quote ?? null, x => x);
  const marker = useSpan(clock, slot?.highlight ?? null, easeMarker);
  const markerSize = useTransform(marker, p => `${(p * 100).toFixed(2)}% 100%`);
  const fixRise = useRise(clock, slot?.fix ?? null, 6);
  return (
    <motion.li ref={itemRef} className="sp-weakness" style={{ opacity, y }}>
      <motion.span className="sp-badge" aria-hidden="true" style={{ scale: badgeScale }}>{index + 1}</motion.span>
      <div className="sp-weakness-body">
        <p className="sp-issue">{issue}</p>
        {quote ? (
          <motion.blockquote className="sp-quote" style={{ opacity: quoteOpacity }}>
            <span className="sr-only">{t("Quote from your CV:")}{" "}</span>
            <motion.mark className="sp-mark" style={{ backgroundSize: markerSize }}>“{quote}”</motion.mark>
          </motion.blockquote>
        ) : null}
        {fix ? (
          <motion.div className="sp-fix" style={fixRise}>
            <p className="sp-fix-label"><CornerDownRight size={13} strokeWidth={2.4} aria-hidden="true" />{t("How to fix")}</p>
            <p className="sp-fix-text">{fix}</p>
          </motion.div>
        ) : null}
      </div>
    </motion.li>
  );
}
