import type { RefObject } from "react";
import { motion, useTransform, type MotionValue } from "motion/react";
import { cubicInOut, mix, progress, type Timeline } from "./timeline";

/** Centres of the old score and the ring number, relative to the score row. */
export interface FlightPath { ax: number; ay: number; bx: number; by: number }

/** Centre of `el` inside `root`, from layout offsets (ignores in-flight transforms). */
export function centerWithin(el: HTMLElement | null, root: HTMLElement | null): { x: number; y: number } | null {
  if (!el || !root || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
  let x = 0, y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== root) return null;
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

const ECHO_LAG = 45; // ms between the ghost and each faint echo
const ECHO_OPACITY = [1, .22, .1];
const HIDDEN = { transform: "translate(0px, 0px)", opacity: 0, color: "transparent" };

function Ghost({ t, index, tl, path, text, from, to }: {
  t: MotionValue<number>; index: number; tl: Timeline; path: RefObject<FlightPath | null>; text: number; from: string; to: string;
}) {
  const frameAt = (v: number) => {
    const geo = path.current, lag = index * ECHO_LAG, tt = v - lag;
    if (!geo || tt < tl.flight[0] || v >= tl.land[0] + lag || tt >= tl.flight[0] + tl.flight[1]) return HIDDEN;
    const p = progress(tt, tl.flight, cubicInOut);
    // Quadratic bezier that arcs over the arrow.
    const mx = (geo.ax + geo.bx) / 2, my = Math.min(geo.ay, geo.by) - 34;
    const x = (1 - p) * (1 - p) * geo.ax + 2 * (1 - p) * p * mx + p * p * geo.bx;
    const y = (1 - p) * (1 - p) * geo.ay + 2 * (1 - p) * p * my + p * p * geo.by;
    return {
      transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + .2 * p})`,
      opacity: index === 0 ? 1 : ECHO_OPACITY[index] * Math.sin(Math.PI * p),
      color: mix(from, to, p)
    };
  };
  const transform = useTransform(t, (v) => frameAt(v).transform);
  const opacity = useTransform(t, (v) => frameAt(v).opacity);
  const color = useTransform(t, (v) => frameAt(v).color);
  return (
    <motion.span
      className="pointer-events-none absolute left-0 top-0 whitespace-nowrap font-medium text-3xl"
      style={{ fontVariantNumeric: "tabular-nums", transform, opacity, color, willChange: "transform, opacity" }}
    >
      {text}
    </motion.span>
  );
}

/** A copy of the old score lifting off and arcing into the ring, with two trailing echoes. */
export function GhostFlight(props: { t: MotionValue<number>; tl: Timeline; path: RefObject<FlightPath | null>; text: number; from: string; to: string }) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true" data-score-ghost="">
      {[2, 1, 0].map((index) => <Ghost key={index} index={index} {...props} />)}
    </span>
  );
}
