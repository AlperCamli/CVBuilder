import { motion, useTransform, type MotionValue } from "motion/react";
import type { StrengthSlot } from "./reveal-timeline";
import { easeInOut, useRise, useSpan } from "./motion-helpers";

/** One strength: the card rises in, its check circle pops, then the tick draws itself. */
export function StrengthCard({ text, clock, slot, itemRef }: {
  text: string;
  clock: MotionValue<number>;
  slot: StrengthSlot | null;
  itemRef?: (element: HTMLElement | null) => void;
}) {
  const { opacity, y } = useRise(clock, slot?.card ?? null, 10);
  const circle = useSpan(clock, slot?.circle ?? null);
  const circleScale = useTransform(circle, p => 0.4 + 0.6 * p);
  const tick = useSpan(clock, slot?.tick ?? null, easeInOut);
  const tickOpacity = useTransform(tick, p => p > 0.001 ? 1 : 0);
  return (
    <motion.li ref={itemRef} className="sp-strength" style={{ opacity, y }}>
      <svg className="sp-check" viewBox="0 0 22 22" aria-hidden="true">
        <motion.circle cx="11" cy="11" r="11" style={{ opacity: circle, scale: circleScale }} />
        <motion.path d="M6.6 11.4l2.9 2.9 5.9-6" style={{ pathLength: tick, opacity: tickOpacity }} />
      </svg>
      <span>{text}</span>
    </motion.li>
  );
}
