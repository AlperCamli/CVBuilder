/**
 * Timeline for the score page's "guided cascade": the score lands, then each strength, then each
 * weakness (issue → highlighted quote → fix), then the evaluation note and one CTA pulse.
 * It is built from the data, so uneven lists simply produce a shorter sequence. All times are ms.
 */

export type Span = readonly [start: number, duration: number];

export interface StrengthSlot { start: number; card: Span; circle: Span; tick: Span }
export interface WeaknessSlot { start: number; card: Span; badge: Span; quote: Span | null; highlight: Span | null; fix: Span | null }

/** Things that appear on their own beat, in reading order. Used to follow the reveal on small screens. */
export interface RevealItem { id: string; start: number }

export interface RevealTimeline {
  block: Span;
  ring: Span;
  verdict: Span;
  strengthsHeading: Span | null;
  strengths: StrengthSlot[];
  weaknessesHeading: Span | null;
  weaknesses: WeaknessSlot[];
  how: Span;
  cta: Span;
  end: number;
  items: RevealItem[];
}

export interface RevealInput {
  strengths: number;
  weaknesses: ReadonlyArray<{ quote: boolean; fix: boolean }>;
}

/** The whole sequence (CTA pulse included) is squeezed to fit in this, so it never drags on. */
export const MAX_SEQUENCE_MS = 6000;

export const itemIds = {
  score: "score",
  verdict: "verdict",
  strengths: "strengths",
  strength: (index: number) => `strength-${index}`,
  weaknesses: "weaknesses",
  weakness: (index: number) => `weakness-${index}`,
  how: "how",
  actions: "actions"
} as const;

const scaleSpan = (span: Span, k: number): Span => [span[0] * k, span[1] * k];
const scaleNullable = (span: Span | null, k: number): Span | null => span ? scaleSpan(span, k) : null;

/** Mirrors the prototype's beats (variant 1 SPEC.md); the 71-point sample ends at 5.98 s. */
export function buildRevealTimeline({ strengths, weaknesses }: RevealInput): RevealTimeline {
  const items: RevealItem[] = [{ id: itemIds.score, start: 0 }];
  const block: Span = [0, 350];
  const ring: Span = [150, 1000];
  const verdict: Span = [1050, 350];
  items.push({ id: itemIds.verdict, start: verdict[0] });
  let t = verdict[0] + 400;

  let strengthsHeading: Span | null = null;
  const strengthSlots: StrengthSlot[] = [];
  if (strengths > 0) {
    strengthsHeading = [t, 300];
    items.push({ id: itemIds.strengths, start: t });
    t += 200;
    for (let i = 0; i < strengths; i++) {
      strengthSlots.push({ start: t, card: [t, 420], circle: [t + 60, 300], tick: [t + 180, 320] });
      items.push({ id: itemIds.strength(i), start: t });
      t += 380;
    }
    t += 120;
  }

  let weaknessesHeading: Span | null = null;
  const weaknessSlots: WeaknessSlot[] = [];
  if (weaknesses.length > 0) {
    weaknessesHeading = [t, 300];
    items.push({ id: itemIds.weaknesses, start: t });
    t += 200;
    weaknesses.forEach((weakness, i) => {
      const fixAt = weakness.quote ? t + 620 : t + 330;
      weaknessSlots.push({
        start: t,
        card: [t, 400],
        badge: [t + 60, 360],
        quote: weakness.quote ? [t + 180, 250] : null,
        highlight: weakness.quote ? [t + 280, 480] : null,
        fix: weakness.fix ? [fixAt, 360] : null
      });
      items.push({ id: itemIds.weakness(i), start: t });
      t = fixAt + 140;
    });
    t += 60;
  }

  const how: Span = [t, 300];
  const cta: Span = [t + 120, 700];
  items.push({ id: itemIds.how, start: t }, { id: itemIds.actions, start: t });
  const timeline: RevealTimeline = { block, ring, verdict, strengthsHeading, strengths: strengthSlots, weaknessesHeading, weaknesses: weaknessSlots, how, cta, end: t + 820, items };
  return timeline.end > MAX_SEQUENCE_MS ? scaleTimeline(timeline, MAX_SEQUENCE_MS / timeline.end) : timeline;
}

function scaleTimeline(tl: RevealTimeline, k: number): RevealTimeline {
  return {
    block: scaleSpan(tl.block, k),
    ring: scaleSpan(tl.ring, k),
    verdict: scaleSpan(tl.verdict, k),
    strengthsHeading: scaleNullable(tl.strengthsHeading, k),
    strengths: tl.strengths.map(s => ({ start: s.start * k, card: scaleSpan(s.card, k), circle: scaleSpan(s.circle, k), tick: scaleSpan(s.tick, k) })),
    weaknessesHeading: scaleNullable(tl.weaknessesHeading, k),
    weaknesses: tl.weaknesses.map(w => ({ start: w.start * k, card: scaleSpan(w.card, k), badge: scaleSpan(w.badge, k), quote: scaleNullable(w.quote, k), highlight: scaleNullable(w.highlight, k), fix: scaleNullable(w.fix, k) })),
    how: scaleSpan(tl.how, k),
    cta: scaleSpan(tl.cta, k),
    end: tl.end * k,
    items: tl.items.map(item => ({ ...item, start: item.start * k }))
  };
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Eased 0 → 1 progress through a span; exactly 0 before it and 1 after it. A missing span is done. */
export const spanProgress = (t: number, span: Span | null, ease: (x: number) => number = x => x): number => {
  if (!span) return 1;
  const p = span[1] <= 0 ? (t >= span[0] ? 1 : 0) : clamp01((t - span[0]) / span[1]);
  return p <= 0 ? 0 : p >= 1 ? 1 : ease(p);
};

// ---------- when to play ----------

/**
 * "sequence": the full cascade. "fade": the final state with one short opacity fade (reduced
 * motion, unscorable or image-based reviews). "static": the final state at once (a review already
 * revealed in this browser session, or a panel that does not ask for the reveal).
 */
export type RevealMode = "sequence" | "fade" | "static";

export function revealMode({ enabled, reduced, scorable, simple, seen }: { enabled: boolean; reduced: boolean; scorable: boolean; simple: boolean; seen: boolean }): RevealMode {
  if (!enabled || seen) return "static";
  if (reduced || !scorable || simple) return "fade";
  return "sequence";
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;
const SEEN_PREFIX = "cv-score-revealed:";

/** The session store, or null where it is unavailable (server render, blocked storage). */
export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** True when this review (import id) was already revealed in this browser session. */
export function hasSeenReveal(store: ReadStore | null | undefined, reviewKey: string | null | undefined): boolean {
  if (!store || !reviewKey) return false;
  try {
    return store.getItem(SEEN_PREFIX + reviewKey) === "1";
  } catch {
    return false;
  }
}

export function markRevealSeen(store: WriteStore | null | undefined, reviewKey: string | null | undefined): void {
  if (!store || !reviewKey) return;
  try {
    store.setItem(SEEN_PREFIX + reviewKey, "1");
  } catch {
    /* storage full or blocked: the sequence may simply play again */
  }
}
