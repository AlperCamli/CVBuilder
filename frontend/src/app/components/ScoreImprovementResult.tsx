import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Odometer } from "./score-animation/Odometer";
import { Sparks } from "./score-animation/Sparks";
import { GhostFlight, centerWithin, type FlightPath } from "./score-animation/GhostFlight";
import {
  arcValue, backOut, buildTimeline, clamp, colorAt, cubicIn, cubicInOut, cubicOut, digitCount, mix, progress, readPalette,
  rollValue, tone, type Timeline
} from "./score-animation/timeline";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const dash = (score: number) => `${(clamp(score, 0, 100) / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
/** 0 → 1 → 0 over a span; exactly 0 outside it so the final frame is clean. */
const bump = (p: number) => p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);
/** Hide a round-capped stroke at zero length, where it would still draw a dot. */
const drawn = (p: number) => p > 0.001 ? 1 : 0;

function useAt<T>(time: MotionValue<number>, fn: (t: number) => T) {
  return useTransform(time, fn);
}

/** Shown after Improve with AI when the CV score went up: the score change and one way forward. */
export function ScoreImprovementResult({ before, after, onContinue }: { before: number; after: number; onContinue: () => void }) {
  useTranslation();
  const reduced = useReducedMotion() === true;
  const animated = !reduced && Number.isFinite(before) && Number.isFinite(after) && after > before;
  return <ScoreResult key={`${before}:${after}:${animated}`} before={before} after={after} onContinue={onContinue} animated={animated} />;
}

/**
 * "Score Carry-Over": the old score's ghost flies into the ring, the ring fills to it,
 * then the number rolls to the new score. Every visual derives from one clock (ms);
 * without animation the clock sits at the end, which is the final state.
 */
function ScoreResult({ before, after, onContinue, animated }: { before: number; after: number; onContinue: () => void; animated: boolean }) {
  const tl = useMemo<Timeline>(() => buildTimeline(before, after), [before, after]);
  const [palette] = useState(readPalette);
  const time = useMotionValue(animated ? 0 : tl.end);
  const rowRef = useRef<HTMLDivElement>(null);
  const oldRef = useRef<HTMLSpanElement>(null);
  const landRef = useRef<HTMLSpanElement>(null);
  const path = useRef<FlightPath | null>(null);

  // One clock for the whole sequence; stopping it on unmount stops everything.
  // When it finishes, the decorative layers are removed so only the static final state stays.
  const [done, setDone] = useState(!animated);
  useEffect(() => {
    if (!animated) return;
    let active = true;
    time.jump(0);
    const controls = animate(time, tl.end, { duration: tl.end / 1000, ease: "linear" });
    controls.then(() => { if (active) setDone(true); }, () => undefined);
    return () => {
      active = false;
      controls.stop();
    };
  }, [animated, time, tl]);
  const effects = animated && !done;

  // Flight path from layout; re-measured on resize and font swap. No path means no flight.
  useIsomorphicLayoutEffect(() => {
    if (!effects) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      try {
        const a = centerWithin(oldRef.current, rowRef.current), b = centerWithin(landRef.current, rowRef.current);
        path.current = a && b ? { ax: a.x, ay: a.y, bx: b.x, by: b.y } : null;
      } catch {
        path.current = null;
      }
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    for (const el of [rowRef.current, oldRef.current, landRef.current]) if (el && observer) observer.observe(el);
    window.addEventListener("resize", measure);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", measure);
    fonts?.ready?.then(measure, () => undefined);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [effects]);

  const oldTone = tone(before, palette);
  const finalTone = tone(after, palette);

  // Badge and headline.
  const badgeOpacity = useAt(time, (v) => clamp(v / 200));
  const badgeScale = useAt(time, (v) => .6 + .4 * progress(v, tl.badge, backOut));
  const trendLine = useAt(time, (v) => clamp(progress(v, tl.badgeIcon, cubicOut) / .7));
  const trendHead = useAt(time, (v) => clamp((progress(v, tl.badgeIcon, cubicOut) - .55) / .45));
  const trendHeadOpacity = useAt(trendHead, drawn);
  const headOpacity = useAt(time, (v) => progress(v, tl.head, cubicOut));
  const headY = useAt(headOpacity, (p) => (1 - p) * 6);

  // Old score: appears, dims and is crossed out as its ghost lifts off.
  const oldOpacity = useAt(time, (v) => progress(v, tl.old, cubicOut));
  const oldY = useAt(oldOpacity, (p) => (1 - p) * 4);
  const oldColor = useAt(time, (v) => mix(palette.primary, palette.secondary, progress(v, tl.oldDim, cubicOut)));
  const strike = useAt(time, (v) => progress(v, tl.strike, cubicOut));

  // Arrow draws itself: shaft, then head.
  const shaft = useAt(time, (v) => progress(v, tl.arrowShaft, cubicInOut));
  const shaftOpacity = useAt(shaft, drawn);
  const arrowHead = useAt(time, (v) => progress(v, tl.arrowHead, cubicOut));
  const arrowHeadOpacity = useAt(arrowHead, drawn);

  // Ring and number.
  const trackOpacity = useAt(time, (v) => clamp((v - 200) / 300));
  const color = useAt(time, (v) => colorAt(tl, v, palette));
  const arcDash = useAt(time, (v) => dash(arcValue(tl, v)));
  const arcOpacity = useAt(time, (v) => (clamp(arcValue(tl, v), 0, 100) / 100) * CIRCUMFERENCE < .5 ? 0 : 1);
  const rolling = useAt(time, (v) => v < tl.roll[0] ? before : rollValue(tl, v));
  // The number takes over from the landing ghost; without a flight it fades in instead.
  const numberOpacity = useAt(time, (v) => path.current ? (v >= tl.land[0] ? 1 : 0) : progress(v, [tl.land[0] - 200, 200]));
  const numberScale = useAt(time, (v) => (1 - .04 * bump(progress(v, tl.land))) * (1 + .09 * bump(progress(v, [tl.peak, 380]))));
  const newSubOpacity = useAt(time, (v) => progress(v, tl.newSub, cubicOut));

  // Peak: pre-blurred glow (opacity only), expanding halo, transient "+N" chip.
  const glowOpacity = useAt(time, (v) => .55 * bump(progress(v, [tl.peak - 60, 720])));
  const haloProgress = useAt(time, (v) => progress(v, [tl.peak, 650], cubicOut));
  const haloScale = useAt(haloProgress, (p) => 1 + (15 / RADIUS) * p);
  const haloOpacity = useAt(time, (v) => {
    const p = progress(v, [tl.peak, 650], cubicOut);
    return v >= tl.peak && p < 1 ? .32 * (1 - p) : 0;
  });
  const haloWidth = useAt(haloProgress, (p) => (10 * (1 - p) + .5) / (1 + (15 / RADIUS) * p));
  const chipOpacity = useAt(time, (v) => clamp(progress(v, [tl.peak + 20, 240], backOut)) * (1 - progress(v, tl.deltaOut, cubicIn)));
  const chipY = useAt(time, (v) => 8 * (1 - progress(v, [tl.peak + 20, 240], backOut)) - 6 * progress(v, tl.deltaOut, cubicIn));

  // Supporting copy and Continue (clickable from the first frame).
  const savedOpacity = useAt(time, (v) => progress(v, tl.saved, cubicOut));
  const savedY = useAt(savedOpacity, (p) => (1 - p) * 6);
  const ctaOpacity = useAt(time, (v) => progress(v, tl.cta, cubicOut));
  const ctaY = useAt(ctaOpacity, (p) => (1 - p) * 6);
  const shineOpacity = useAt(time, (v) => v >= tl.shine[0] && progress(v, tl.shine) < 1 ? 1 : 0);
  const shineX = useAt(time, (v) => `${-120 + 240 * progress(v, tl.shine, cubicInOut)}%`);

  const ring = (
    <svg className="-rotate-90" width="120" height="120" style={{ overflow: "visible" }}>
      <motion.circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--color-border-secondary)" strokeWidth="10" style={{ opacity: trackOpacity }} />
      <motion.circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" strokeLinecap="round"
        style={{ stroke: color, strokeDasharray: arcDash, opacity: arcOpacity }} />
    </svg>
  );

  return (
    <motion.div
      className="text-center"
      role="status"
      initial={animated ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: .2, ease: "easeOut" }}
    >
      <motion.div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center"
        style={{ background: "var(--color-teal-50)", opacity: badgeOpacity, scale: badgeScale }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "var(--color-teal-700)" }} aria-hidden="true">
          <motion.polyline points="22 7 13.5 15.5 8.5 10.5 2 17" style={{ pathLength: trendLine }} />
          <motion.polyline points="16 7 22 7 22 13" style={{ pathLength: trendHead, opacity: trendHeadOpacity }} />
        </svg>
      </motion.div>
      <motion.h1 style={{ fontSize: "24px", color: "var(--color-text-primary)", fontWeight: 600, opacity: headOpacity, y: headY }}>
        {t("Your CV score went up")}
      </motion.h1>
      <div ref={rowRef} className="relative mt-6 flex items-center justify-center gap-5" role="img"
        aria-label={t("CV score went from {{before}} to {{after}} out of 100", { before, after })}>
        <motion.div className="text-center" aria-hidden="true" style={{ opacity: oldOpacity, y: oldY }}>
          <motion.p className="relative inline-block font-medium text-3xl" style={{ color: oldColor, fontVariantNumeric: "tabular-nums" }}>
            <span ref={oldRef} data-score-old="">{before}</span>
            <motion.span className="absolute rounded-[1px]" data-score-strike=""
              style={{ left: -2, right: -2, top: "52%", height: 2, background: "var(--color-text-secondary)", originX: 0, scaleX: strike }} />
          </motion.p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)" }}>{t("out of 100")}</p>
        </motion.div>
        <svg className="flex-none overflow-visible" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-text-secondary)" }} aria-hidden="true">
          <motion.path d="M5 12h14" style={{ pathLength: shaft, opacity: shaftOpacity }} />
          <motion.path d="m12 5 7 7-7 7" style={{ pathLength: arrowHead, opacity: arrowHeadOpacity }} />
        </svg>
        <div className="relative h-[120px] w-[120px] flex-none" aria-hidden="true">
          {effects && (
            <>
              <motion.div className="pointer-events-none absolute inset-0" style={{ opacity: glowOpacity, willChange: "opacity" }} data-score-glow="">
                <div className="absolute inset-0" style={{ filter: "blur(6px)" }}>
                  <svg className="-rotate-90" width="120" height="120" style={{ overflow: "visible" }}>
                    <circle cx="60" cy="60" r={RADIUS} fill="none" stroke={finalTone} strokeWidth="12" strokeLinecap="round" strokeDasharray={dash(after)} />
                  </svg>
                </div>
              </motion.div>
              <motion.div className="pointer-events-none absolute inset-0" style={{ scale: haloScale, opacity: haloOpacity }}>
                <svg width="120" height="120" style={{ overflow: "visible" }}>
                  <motion.circle cx="60" cy="60" r={RADIUS} fill="none" style={{ stroke: color, strokeWidth: haloWidth }} />
                </svg>
              </motion.div>
            </>
          )}
          <div className="absolute inset-0">{ring}</div>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.p className="flex justify-center font-medium text-4xl"
              style={{ height: 40, color, opacity: numberOpacity, scale: numberScale, fontVariantNumeric: "tabular-nums" }}>
              {effects ? <Odometer ref={landRef} value={rolling} final={after} places={digitCount(after)} /> : after}
            </motion.p>
            <motion.p className="text-xs mt-1" style={{ color: "var(--color-text-secondary)", opacity: newSubOpacity }}>{t("out of 100")}</motion.p>
          </div>
          {effects && (
            <>
              <Sparks t={time} peak={tl.peak} score={after} color={finalTone} tint={mix(finalTone, "#ffffff", .45)} />
              <motion.span className="pointer-events-none absolute rounded-full whitespace-nowrap" data-score-chip=""
                style={{ top: -8, right: -20, padding: "2px 7px", fontSize: 12, lineHeight: "16px", fontWeight: 600,
                  background: "var(--color-teal-50)", color: "var(--color-teal-700)", opacity: chipOpacity, y: chipY }}>
                +{after - before}
              </motion.span>
            </>
          )}
        </div>
        {effects && <GhostFlight t={time} tl={tl} path={path} text={before} from={palette.primary} to={oldTone} />}
      </div>
      <motion.p className="mt-5" style={{ fontSize: "14px", color: "var(--color-text-secondary)", opacity: savedOpacity, y: savedY }}>
        {t("Your improvements are saved to your Main CV.")}
      </motion.p>
      <motion.button
        type="button"
        onClick={onContinue}
        className="relative overflow-hidden mt-6 inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg"
        style={{ fontSize: "14px", fontWeight: 600, background: "var(--color-teal-600)", color: "white", opacity: ctaOpacity, y: ctaY }}
      >
        {t("Continue")}
        <ArrowRight size={16} aria-hidden="true" />
        {effects && (
          <motion.span className="pointer-events-none absolute inset-0" aria-hidden="true"
            style={{ background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%)", opacity: shineOpacity, x: shineX }} />
        )}
      </motion.button>
    </motion.div>
  );
}
