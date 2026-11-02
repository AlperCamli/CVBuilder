/**
 * Timeline and maths for the "Score Carry-Over" result animation.
 * Every visual is a pure function of the elapsed time `t` (ms), so one
 * MotionValue drives the whole sequence and reduced motion simply jumps to `end`.
 */

export type Span = readonly [start: number, duration: number];

export interface Palette {
  teal: string;
  amber: string;
  red: string;
  primary: string;
  secondary: string;
}

/** Fallbacks match src/styles/theme.css; the live tokens are read when available. */
const FALLBACK: Palette = { teal: "#0F6E56", amber: "#8A5907", red: "#B73332", primary: "#111827", secondary: "#6B7280" };
const TOKENS: Record<keyof Palette, string> = {
  teal: "--color-teal-600",
  amber: "--color-yellow-700",
  red: "--color-red-600",
  primary: "--color-text-primary",
  secondary: "--color-text-secondary"
};
const HEX = /^#[0-9a-f]{6}$/i;

/** Colours are mixed per frame, so they are resolved to hex once instead of using var(). */
export function readPalette(from?: Element | null): Palette {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return FALLBACK;
  try {
    const style = getComputedStyle(from ?? document.documentElement);
    const palette = { ...FALLBACK };
    for (const key of Object.keys(TOKENS) as (keyof Palette)[]) {
      const value = style.getPropertyValue(TOKENS[key]).trim();
      if (HEX.test(value)) palette[key] = value;
    }
    return palette;
  } catch {
    return FALLBACK;
  }
}

export const tone = (score: number, p: Palette) => score >= 80 ? p.teal : score >= 60 ? p.amber : p.red;

// ---------- easing ----------
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const linear = (x: number) => x;
export const cubicOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const cubicIn = (x: number) => x * x * x;
export const cubicInOut = (x: number) => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const backOut = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
export const progress = (t: number, [start, duration]: Span, ease: (x: number) => number = linear) =>
  ease(clamp((t - start) / duration));

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mix(a: string, b: string, k: number): string {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const A = channels(a), B = channels(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("");
}

/** Colour crossfade at a band crossing; kept short so it never reads as a muddy blend. */
export const CROSSFADE_MS = 200;

export interface Timeline {
  before: number;
  after: number;
  badge: Span; badgeIcon: Span; head: Span; old: Span; cta: Span;
  arrowShaft: Span; arrowHead: Span;
  flight: Span; oldDim: Span; strike: Span;
  land: Span; newSub: Span;
  roll: Span;
  peak: number;
  saved: Span; shine: Span; deltaOut: Span;
  end: number;
  crossings: { t: number; color: keyof Palette }[];
}

/**
 * Prototype timeline (ms). Small gains get a shorter roll (a 620 ms roll over one
 * digit feels stuck); everything after the roll moves up by the same amount.
 */
export function buildTimeline(before: number, after: number): Timeline {
  const gain = after - before;
  const rollDuration = gain >= 4 ? 620 : 320 + 80 * Math.max(1, gain);
  const shift = 620 - rollDuration;
  const timeline: Timeline = {
    before, after,
    badge: [0, 380], badgeIcon: [120, 420], head: [60, 380], old: [120, 300], cta: [200, 360],
    arrowShaft: [320, 220], arrowHead: [460, 200],
    flight: [620, 440], oldDim: [620, 300], strike: [680, 300],
    land: [1060, 200], newSub: [1000, 260],
    roll: [1120, rollDuration],
    peak: 1740 - shift,
    saved: [1800 - shift, 320], shine: [2000 - shift, 600], deltaOut: [2200 - shift, 260],
    end: 2500 - shift,
    crossings: []
  };
  timeline.crossings = ([[60, "amber"], [80, "teal"]] as const)
    .filter(([threshold]) => before < threshold && after >= threshold)
    .map(([threshold, color]) => {
      let lo = timeline.roll[0], hi = timeline.roll[0] + timeline.roll[1];
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (rollValue(timeline, mid) >= threshold) hi = mid; else lo = mid;
      }
      return { t: hi, color };
    });
  return timeline;
}

/** Score shown on the odometer and ring once the roll starts. */
export const rollValue = (tl: Timeline, t: number) => tl.before + (tl.after - tl.before) * progress(t, tl.roll, cubicOut);

/** Ring value: 0 → before while the ghost flies, then before → after. */
export function arcValue(tl: Timeline, t: number): number {
  if (t < tl.flight[0]) return 0;
  if (t < tl.roll[0]) return tl.before * progress(t, tl.flight, cubicInOut);
  return rollValue(tl, t);
}

export function colorAt(tl: Timeline, t: number, p: Palette): string {
  let color = tone(tl.before, p);
  for (const crossing of tl.crossings) color = mix(color, p[crossing.color], cubicOut(clamp((t - crossing.t) / CROSSFADE_MS)));
  return color;
}

/**
 * Odometer strip position (in cells) for decimal place `place` (0 = ones).
 * Higher places roll continuously while the lower places pass from 9 to 10.
 */
export function odometerPosition(value: number, place: number): number {
  if (place === 0) return value % 10;
  const base = Math.pow(10, place);
  let position = Math.floor(value / base) % 10;
  const rest = value % base;
  if (rest > base - 1) position += rest - (base - 1);
  return position;
}

export const digitCount = (n: number) => String(Math.max(0, Math.round(n))).length;
