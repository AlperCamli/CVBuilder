import { AnimatePresence, motion, type MotionValue } from "motion/react";
import { FastForward } from "lucide-react";
import { translate as t } from "../../localization/i18n";

/** Floating "Show all" button with the sequence's progress; shown only while the cascade plays. */
export function SkipRevealPill({ visible, progress, onSkip }: { visible: boolean; progress: MotionValue<number>; onSkip: () => void }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          key="skip"
          type="button"
          className="sp-skip"
          data-reveal-skip=""
          onClick={onSkip}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          <FastForward size={14} strokeWidth={2.2} aria-hidden="true" />
          {t("Show all")}
          <motion.span className="sp-skip-bar" aria-hidden="true" style={{ scaleX: progress }} />
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
