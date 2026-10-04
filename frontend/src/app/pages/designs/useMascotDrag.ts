import { useEffect, useRef, useState, type RefObject } from "react";
import type { RailStop } from "./mascot-config";

export type MascotPosition = { x: number; y: number };

/** Visitor moves are transient viewport centers; Studio remains the only config writer. */
export function useMascotDrag(
  rail: RefObject<HTMLElement>,
  disabled: boolean,
  reactionMs: number,
  destination: RailStop,
) {
  const manual = useRef<MascotPosition | null>(null);
  // The welcome and return-to-top poses belong to the same page destination.
  const landmark = destination === "return" ? "hero" : destination;
  const previousLandmark = useRef(landmark);
  const releaseAtDestination = useRef<(() => void) | null>(null);
  const [reaction, setReaction] = useState<"dragging" | "dropped" | null>(null);
  useEffect(() => {
    if (reaction !== "dropped") return;
    const timer = window.setTimeout(() => setReaction(null), reactionMs);
    return () => window.clearTimeout(timer);
  }, [reaction, reactionMs]);

  useEffect(() => {
    const character =
      rail.current?.querySelector<HTMLElement>(".gj-rail-character");
    const notify = () => window.dispatchEvent(new Event("mascot:drag-update"));
    manual.current = null;
    setReaction(null);
    notify();
    if (disabled || !character) return;
    let drag: {
      pointer: number;
      start: MascotPosition;
      center: MascotPosition;
      moved: boolean;
    } | null = null;
    let suppressClick = false;
    const center = (): MascotPosition => {
      const r = character.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const release = () => {
      const pointer = drag?.pointer;
      drag = null;
      if (pointer !== undefined && character.hasPointerCapture(pointer))
        character.releasePointerCapture(pointer);
    };
    const reset = () => {
      if (!drag && !manual.current) return;
      suppressClick = !!drag?.moved;
      release();
      manual.current = null;
      setReaction(null);
      notify();
    };
    releaseAtDestination.current = () => {
      // Never pull the character out of the visitor's hand. If a destination is
      // reached while dragging, the eventual drop belongs to that new section.
      if (!drag) reset();
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      suppressClick = false;
      drag = {
        pointer: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        center: center(),
        moved: false,
      };
      character.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const dx = e.clientX - drag.start.x,
        dy = e.clientY - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      e.preventDefault();
      if (!drag.moved) {
        drag.moved = true;
        setReaction("dragging");
      }
      manual.current = { x: drag.center.x + dx, y: drag.center.y + dy };
      notify();
    };
    const up = (e: PointerEvent) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const moved = drag.moved;
      release();
      if (!moved) return;
      suppressClick = true;
      setReaction("dropped");
      notify();
    };
    const cancel = (e: PointerEvent) => {
      if (drag?.pointer === e.pointerId) reset();
    };
    const blur = () => {
      if (drag) reset();
    };
    const click = (e: MouseEvent) => {
      if (!suppressClick || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && manual.current) {
        e.preventDefault();
        reset();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const delta: Record<string, MascotPosition> = {
        ArrowLeft: { x: -24, y: 0 },
        ArrowRight: { x: 24, y: 0 },
        ArrowUp: { x: 0, y: -24 },
        ArrowDown: { x: 0, y: 24 },
      };
      if (!delta[e.key]) return;
      e.preventDefault();
      const from = center();
      manual.current = {
        x: from.x + delta[e.key].x,
        y: from.y + delta[e.key].y,
      };
      setReaction("dropped");
      notify();
    };
    character.addEventListener("pointerdown", down);
    character.addEventListener("pointermove", move);
    character.addEventListener("pointerup", up);
    character.addEventListener("pointercancel", cancel);
    character.addEventListener("lostpointercapture", cancel);
    character.addEventListener("click", click, true);
    character.addEventListener("keydown", key);
    window.addEventListener("blur", blur);
    return () => {
      release();
      manual.current = null;
      releaseAtDestination.current = null;
      character.removeEventListener("pointerdown", down);
      character.removeEventListener("pointermove", move);
      character.removeEventListener("pointerup", up);
      character.removeEventListener("pointercancel", cancel);
      character.removeEventListener("lostpointercapture", cancel);
      character.removeEventListener("click", click, true);
      character.removeEventListener("keydown", key);
      window.removeEventListener("blur", blur);
    };
  }, [rail, disabled]);
  useEffect(() => {
    if (previousLandmark.current === landmark) return;
    previousLandmark.current = landmark;
    releaseAtDestination.current?.();
  }, [landmark]);
  return { manual, reaction };
}
