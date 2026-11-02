import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { animate, motionValue, useMotionValue, type MotionValue } from "motion/react";
import { itemIds, type RevealMode, type RevealTimeline } from "./reveal-timeline";

/** Room kept below a followed item for the floating "Show all" pill. */
const PILL_CLEARANCE = 84;
/** A followed item's top never goes above this (px from the viewport top). */
const TOP_MARGIN = 64;
/** Scroll events this soon after our own smooth scroll are ours, not the user's. */
const AUTO_SCROLL_WINDOW = 1000;
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " ", "Tab"]);

export interface RevealSequence {
  mode: RevealMode;
  /** The clock (ms on the timeline) of one item; items revealed early run ahead of the master clock. */
  clock: (id: string) => MotionValue<number>;
  /** Ref callback that lets the sequence follow and early-reveal an item's element. */
  register: (id: string) => (element: HTMLElement | null) => void;
  /** 0 → 1 over the whole sequence, for the skip pill. */
  progress: MotionValue<number>;
  playing: boolean;
  skip: () => void;
}

/**
 * Drives the guided cascade from one master clock. Content is always in the DOM; items only
 * read their clock to set opacity and transforms. "Gentle follow, instant yield": while the user
 * has not touched anything, a newly started item below the fold is scrolled into view just enough;
 * the first wheel, touch, scroll key or scroll stops that for good, and from then on any item the
 * user scrolls to plays at once. Everything is torn down on unmount (the actions navigate away).
 */
export function useRevealSequence({ mode, timeline, actionsRef }: {
  mode: RevealMode;
  timeline: RevealTimeline;
  actionsRef?: RefObject<HTMLElement | null>;
}): RevealSequence {
  const animated = mode === "sequence";
  const initial = animated ? 0 : timeline.end;
  const time = useMotionValue(initial);
  const progress = useMotionValue(animated ? 0 : 1);
  const clocks = useRef(new Map<string, MotionValue<number>>());
  const elements = useRef(new Map<string, HTMLElement>());
  const refCallbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const skipRef = useRef<() => void>(() => undefined);
  const [playing, setPlaying] = useState(animated);

  const clock = useCallback((id: string) => {
    let value = clocks.current.get(id);
    if (!value) {
      value = motionValue(initial);
      clocks.current.set(id, value);
    }
    return value;
  }, [initial]);

  const register = useCallback((id: string) => {
    let callback = refCallbacks.current.get(id);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      };
      refCallbacks.current.set(id, callback);
    }
    return callback;
  }, []);

  useEffect(() => {
    if (!animated || typeof window === "undefined") return;
    const end = timeline.end;
    const items = timeline.items.map(item => ({ ...item, started: false, shift: 0 }));
    let follow = true;
    let finished = false;
    let skipped = false;
    let autoScrollUntil = 0;
    let observer: IntersectionObserver | null = null;
    const pulses: Animation[] = [];
    const elementOf = (id: string) => id === itemIds.actions ? actionsRef?.current ?? null : elements.current.get(id) ?? null;

    const followTo = (element: HTMLElement | null) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const limit = window.innerHeight - PILL_CLEARANCE;
      if (rect.bottom <= limit) return;
      // Just enough to show the item, never so far that its top leaves the screen.
      const delta = Math.min(rect.bottom - limit + 12, rect.top - TOP_MARGIN);
      if (delta <= 4) return;
      autoScrollUntil = performance.now() + AUTO_SCROLL_WINDOW;
      window.scrollBy({ top: delta, behavior: "smooth" });
    };

    // One soft ring pulse on the primary action and a nudge of its arrow. WAAPI without fill,
    // so nothing lingers on the button afterwards.
    const pulse = () => {
      if (skipped) return;
      const root = actionsRef?.current;
      const primary = root?.querySelector<HTMLElement>("[data-reveal-primary]");
      if (!primary || typeof primary.animate !== "function") return;
      const delay = Math.max(0, timeline.cta[0] - timeline.how[0]);
      pulses.push(primary.animate(
        [{ boxShadow: "0 0 0 0 rgba(15,110,86,.35)" }, { boxShadow: "0 0 0 8px rgba(15,110,86,0)" }],
        { delay, duration: timeline.cta[1], easing: "ease-out" }
      ));
      const arrow = primary.querySelector<SVGElement>("[data-reveal-arrow]");
      if (arrow && typeof arrow.animate === "function") {
        pulses.push(arrow.animate(
          [{ transform: "none" }, { transform: "translateX(4px)" }, { transform: "none" }],
          { delay, duration: Math.round(timeline.cta[1] * 0.75), easing: "ease-in-out" }
        ));
      }
    };

    const start = (item: (typeof items)[number]) => {
      item.started = true;
      if (item.id === itemIds.actions) pulse();
      if (follow) followTo(elementOf(item.id));
    };

    const update = (t: number) => {
      for (const item of items) {
        clock(item.id).set(t + item.shift);
        if (!item.started && t >= item.start) start(item);
      }
      progress.set(end > 0 ? Math.min(1, t / end) : 1);
    };

    // An item the user scrolled to plays now: its clock jumps ahead to the item's start.
    const revealNow = (id: string) => {
      const item = items.find(entry => entry.id === id);
      if (!item || item.started) return;
      const now = time.get();
      item.shift = Math.max(0, item.start - now);
      clock(item.id).set(now + item.shift);
      start(item);
    };

    const takeControl = () => {
      if (!follow || finished) return;
      follow = false;
      if (typeof IntersectionObserver !== "function") return;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.revealItem;
          if (id) revealNow(id);
          observer?.unobserve(entry.target);
        }
      }, { rootMargin: "0px 0px -8% 0px" });
      for (const item of items) {
        const element = elementOf(item.id);
        if (item.started || !element) continue;
        element.dataset.revealItem = item.id;
        observer.observe(element);
      }
    };

    const onWheel = () => takeControl();
    const onTouch = (event: TouchEvent) => {
      if (!(event.target instanceof Element && event.target.closest("[data-reveal-skip]"))) takeControl();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") skipRef.current();
      else if (SCROLL_KEYS.has(event.key)) takeControl();
    };
    // Pressing on the page scrollbar targets the root element.
    const onPointer = (event: PointerEvent) => { if (event.target === document.documentElement) takeControl(); };
    const onScroll = () => { if (performance.now() > autoScrollUntil) takeControl(); };
    const listeners: Array<[EventTarget, string, EventListener]> = [
      [window, "wheel", onWheel as EventListener],
      [window, "touchstart", onTouch as EventListener],
      [window, "keydown", onKey as EventListener],
      [document, "pointerdown", onPointer as EventListener],
      [window, "scroll", onScroll as EventListener]
    ];
    for (const [target, type, listener] of listeners) target.addEventListener(type, listener, { passive: true });
    const removeListeners = () => { for (const [target, type, listener] of listeners) target.removeEventListener(type, listener); };

    const finish = () => {
      if (finished) return;
      finished = true;
      follow = false;
      observer?.disconnect();
      removeListeners();
      setPlaying(false);
    };

    const unsubscribe = time.on("change", update);
    time.jump(0);
    update(0);
    const controls = animate(time, end, { duration: end / 1000, ease: "linear" });
    controls.then(finish, () => undefined);

    skipRef.current = () => {
      if (finished) return;
      skipped = true;
      follow = false;
      for (const animation of pulses) animation.cancel();
      controls.stop();
      time.set(end);
      update(end);
      for (const item of items) clock(item.id).set(Math.max(end, end + item.shift));
      finish();
    };

    return () => {
      skipRef.current = () => undefined;
      finished = true;
      controls.stop();
      unsubscribe();
      observer?.disconnect();
      removeListeners();
      for (const animation of pulses) animation.cancel();
      for (const item of items) delete elementOf(item.id)?.dataset.revealItem;
    };
  }, [animated, timeline, time, progress, clock, actionsRef]);

  const skip = useCallback(() => skipRef.current(), []);
  return { mode, clock, register, progress, playing, skip };
}
