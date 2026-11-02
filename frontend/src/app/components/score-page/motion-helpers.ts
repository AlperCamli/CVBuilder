import { cubicBezier, useTransform, type MotionValue } from "motion/react";
import { spanProgress, type Span } from "./reveal-timeline";

/** The prototype's single ease-out curve (ring, count-up, rises). */
export const easeOut = cubicBezier(0.22, 1, 0.36, 1);
/** Small overshoot for the number badges. */
export const easeBack = cubicBezier(0.34, 1.4, 0.64, 1);
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1);
export const easeMarker = cubicBezier(0.45, 0, 0.2, 1);

/** Eased progress (0 → 1) of a span on an item's clock. A missing span reads as done. */
export function useSpan(clock: MotionValue<number>, span: Span | null, ease: (x: number) => number = easeOut): MotionValue<number> {
  return useTransform(clock, t => spanProgress(t, span, ease));
}

/** Opacity and a short upward rise, the cascade's basic entrance. */
export function useRise(clock: MotionValue<number>, span: Span | null, distance: number) {
  const opacity = useSpan(clock, span);
  const y = useTransform(opacity, p => (1 - p) * distance);
  return { opacity, y };
}
