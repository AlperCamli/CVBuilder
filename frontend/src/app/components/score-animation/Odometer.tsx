import { forwardRef } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { odometerPosition } from "./timeline";

const CELL = 40; // px, matches the text-4xl line height
const MASK = "linear-gradient(transparent 0, #000 12%, #000 88%, transparent 100%)";

function Strip({ value, place, leading }: { value: MotionValue<number>; place: number; leading: boolean }) {
  const y = useTransform(value, (v) => -odometerPosition(v, place) * CELL);
  return (
    <span className="inline-block overflow-hidden" style={{ height: CELL, WebkitMaskImage: MASK, maskImage: MASK }}>
      <motion.span className="block" data-odometer-strip="" style={{ y, willChange: "transform" }}>
        {Array.from({ length: 11 }, (_, i) => (
          // A leading zero is blank, so 95 → 100 shows " 95" rolling into "100".
          <span key={i} className="block" style={{ height: CELL }}>{leading && i % 10 === 0 ? " " : i % 10}</span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * Rolling score. The final value is laid out invisibly underneath, so the box never
 * changes size and the flight measures a stable landing point.
 */
export const Odometer = forwardRef<HTMLSpanElement, { value: MotionValue<number>; final: number; places: number }>(
  function Odometer({ value, final, places }, ref) {
    return (
      <span className="relative inline-block" style={{ height: CELL }}>
        <span ref={ref} className="inline-block" style={{ visibility: "hidden" }}>{final}</span>
        <span className="absolute inset-0 flex justify-center">
          {Array.from({ length: places }, (_, i) => {
            const place = places - 1 - i;
            return <Strip key={place} value={value} place={place} leading={places > 1 && place === places - 1} />;
          })}
        </span>
      </span>
    );
  }
);
