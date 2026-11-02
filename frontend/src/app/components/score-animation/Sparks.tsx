import { motion, useTransform, type MotionValue } from "motion/react";
import { backOut, clamp, cubicIn, cubicOut, progress } from "./timeline";

const RADIUS = 52;
const CENTER = 60; // the ring is 120 × 120

// Angle relative to the outward normal at the arc tip (deg), distance (px), size, star?, delay (ms).
const SPARKS = [
  { a: -72, d: 30, s: 9, star: true, dl: 0 }, { a: -42, d: 22, s: 4, star: false, dl: 30 }, { a: -14, d: 38, s: 11, star: true, dl: 10 },
  { a: 12, d: 26, s: 4, star: false, dl: 50 }, { a: 32, d: 34, s: 8, star: true, dl: 20 }, { a: 56, d: 23, s: 5, star: false, dl: 40 },
  { a: 78, d: 30, s: 7, star: true, dl: 60 }, { a: -56, d: 15, s: 3, star: false, dl: 70 }, { a: 44, d: 14, s: 3, star: false, dl: 85 }
] as const;
// Small stars that glint around the ring: absolute angle (deg), radius, size, delay (ms).
const GLINTS = [{ ang: 20, r: 74, s: 8, dl: 60 }, { ang: 150, r: 76, s: 7, dl: 160 }, { ang: 255, r: 73, s: 6, dl: 250 }] as const;

const Star = () => (
  <svg viewBox="0 0 10 10" width="100%" height="100%"><path d="M5 0 L6.1 3.9 L10 5 L6.1 6.1 L5 10 L3.9 6.1 L0 5 L3.9 3.9 Z" fill="currentColor" /></svg>
);
const Dot = () => (
  <svg viewBox="0 0 10 10" width="100%" height="100%"><circle cx="5" cy="5" r="5" fill="currentColor" /></svg>
);

type Frame = { transform: string; opacity: number };
const HIDDEN: Frame = { transform: "translate(0px, 0px) scale(0)", opacity: 0 };

function Particle({ t, size, color, star, frameAt }: {
  t: MotionValue<number>; size: number; color: string; star: boolean; frameAt: (t: number) => Frame;
}) {
  const transform = useTransform(t, (v) => frameAt(v).transform);
  const opacity = useTransform(t, (v) => frameAt(v).opacity);
  return (
    <motion.span
      className="absolute left-0 top-0"
      style={{ width: size, height: size, color, transform, opacity, willChange: "transform, opacity" }}
    >
      {star ? <Star /> : <Dot />}
    </motion.span>
  );
}

/** Burst from the arc's leading tip plus three glints, all at the peak. Purely decorative. */
export function Sparks({ t, peak, score, color, tint }: {
  t: MotionValue<number>; peak: number; score: number; color: string; tint: string;
}) {
  const tip = 2 * Math.PI * clamp(score, 0, 100) / 100 - Math.PI / 2;
  const ox = CENTER + (RADIUS + 3) * Math.cos(tip), oy = CENTER + (RADIUS + 3) * Math.sin(tip);
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true" data-score-sparks="">
      {SPARKS.map((p, i) => (
        <Particle key={`s${i}`} t={t} size={p.s} star={p.star} color={i % 2 ? tint : color} frameAt={(v) => {
          const pp = progress(v, [peak + p.dl, 620]);
          if (v < peak + p.dl || pp >= 1) return HIDDEN;
          const angle = tip + p.a * Math.PI / 180, distance = 1.25 * p.d * cubicOut(pp);
          const scale = pp < .22 ? backOut(pp / .22) : 1 - cubicIn((pp - .22) / .78);
          const x = ox + Math.cos(angle) * distance - p.s / 2, y = oy + Math.sin(angle) * distance - p.s / 2;
          return { transform: `translate(${x}px, ${y}px) rotate(${pp * 90}deg) scale(${scale})`, opacity: 1 };
        }} />
      ))}
      {GLINTS.map((p, i) => (
        <Particle key={`g${i}`} t={t} size={p.s} star color={i === 1 ? tint : color} frameAt={(v) => {
          const pp = progress(v, [peak + p.dl, 520]);
          if (v < peak + p.dl || pp >= 1) return HIDDEN;
          const angle = p.ang * Math.PI / 180;
          const x = CENTER + Math.cos(angle) * p.r - p.s / 2, y = CENTER + Math.sin(angle) * p.r - p.s / 2;
          return { transform: `translate(${x}px, ${y}px) rotate(${pp * 45}deg) scale(${Math.sin(Math.PI * pp)})`, opacity: 1 };
        }} />
      ))}
    </span>
  );
}
