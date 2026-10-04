import { useEffect, useState } from "react";
import {
  journeyScrollTarget,
  scrollToJourneySection,
} from "./mascot-navigation";
import {
  APPLIED_KEY,
  cloneConfig,
  MESSAGE_IDS,
  parseMascotConfig,
  readMascotConfig,
  STOP_IDS,
  type MascotConfig,
  type MessageId,
  type RailStop,
} from "./mascot-config";
export type StudioTelemetry = {
  progress: number;
  scroll: number;
  context: RailStop;
  mode: string;
  x: number;
  y: number;
  playing: boolean;
  overlap: boolean;
  reduced: boolean;
};
export function useMascotSettings() {
  const [config, setConfig] = useState<MascotConfig>(cloneConfig);
  const [studio, setStudio] = useState(false);
  const [pinned, setPinned] = useState<MessageId | null>(null);
  const [inspect, setInspect] = useState(false);
  useEffect(() => {
    const embedded =
      window.parent !== window &&
      new URLSearchParams(window.location.search).get("mascotStudio") === "1";
    setStudio(embedded);
    if (!embedded) {
      setConfig(readMascotConfig());
      const update = (e: StorageEvent) => {
        if (e.key === APPLIED_KEY || e.key === null)
          setConfig(readMascotConfig());
      };
      window.addEventListener("storage", update);
      return () => window.removeEventListener("storage", update);
    }
    const send = (data: object) =>
      window.parent.postMessage(data, window.location.origin);
    let playing = false,
      frame = 0;
    const stop = () => {
      playing = false;
      cancelAnimationFrame(frame);
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== window.location.origin
      )
        return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "mascot:config") {
        try {
          setConfig(parseMascotConfig(data.config));
        } catch {
          /* Leave the last valid preview intact. */
        }
      }
      if (data.type === "mascot:inspect") setInspect(data.enabled === true);
      if (data.type === "mascot:pin")
        setPinned(MESSAGE_IDS.includes(data.id) ? data.id : null);
      if (data.type === "mascot:jump" && STOP_IDS.includes(data.stop)) {
        stop();
        const id =
          data.stop === "hero" || data.stop === "return"
            ? "gj-hero"
            : data.stop === "signup"
              ? "get-started"
              : data.stop;
        const el = document.getElementById(id);
        if (!el) return;
        if (data.stop === "hero" || data.stop === "return")
          window.dispatchEvent(
            new CustomEvent("mascot:visit", { detail: data.stop === "return" }),
          );
        const y =
          data.stop === "hero" || data.stop === "return"
            ? 0
            : (journeyScrollTarget(id) ?? 0) -
              (data.stop === "signup" ? 150 : 0);
        window.scrollTo({ top: y, behavior: "instant" });
        if (typeof data.step === "number" && data.step >= 0 && data.step <= 2)
          document
            .querySelectorAll<HTMLButtonElement>(".v2-tour-tabs button")
            [data.step]?.click();
      }
      if (
        data.type === "mascot:scroll" &&
        typeof data.progress === "number" &&
        Number.isFinite(data.progress)
      ) {
        stop();
        window.scrollTo({
          top:
            Math.max(0, Math.min(1, data.progress)) *
            (document.documentElement.scrollHeight - innerHeight),
          behavior: "instant",
        });
      }
      if (data.type === "mascot:pause") stop();
      if (data.type === "mascot:play") {
        stop();
        setPinned(null);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
          return;
        playing = true;
        const start = performance.now(),
          max = document.documentElement.scrollHeight - innerHeight,
          to = data.reverse ? 0 : max;
        let from = scrollY;
        if (data.reverse && from < 2) from = max;
        if (!data.reverse && from > max - 2) {
          from = 0;
          window.dispatchEvent(
            new CustomEvent("mascot:visit", { detail: false }),
          );
        }
        window.scrollTo({ top: from, behavior: "instant" });
        const duration = Math.max(1000, (18000 * Math.abs(to - from)) / max);
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          window.scrollTo({ top: from + (to - from) * p, behavior: "instant" });
          if (p < 1 && playing) frame = requestAnimationFrame(tick);
          else playing = false;
        };
        frame = requestAnimationFrame(tick);
      }
    };
    const report = () => {
      const rail = document.querySelector<HTMLElement>(".gj-rail");
      if (!rail) return;
      const char = rail.querySelector<HTMLElement>(".gj-rail-character")!,
        bubble = document.querySelector<HTMLElement>(".gj-rail-bubble")!,
        r = char.getBoundingClientRect();
      const overlap = [char, bubble].some(
        (n) =>
          !n.hidden &&
          getComputedStyle(n).visibility !== "hidden" &&
          [...document.querySelectorAll(".pd-window,.cv-plan")].some(
            (other) => {
              const a = n.getBoundingClientRect(),
                b = other.getBoundingClientRect();
              return (
                a.right > b.left &&
                a.left < b.right &&
                a.bottom > b.top &&
                a.top < b.bottom
              );
            },
          ),
      );
      send({
        type: "mascot:telemetry",
        value: {
          progress:
            scrollY /
            Math.max(1, document.documentElement.scrollHeight - innerHeight),
          scroll: scrollY,
          context: rail.dataset.context,
          mode: rail.dataset.mode,
          x: Math.round(r.x),
          y: Math.round(r.y),
          playing,
          overlap,
          reduced: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches,
        },
      });
    };
    window.addEventListener("message", receive);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    const timer = window.setInterval(report, 150);
    send({ type: "mascot:ready" });
    // Preview navigation stays inside the studio and never creates checkout intent.
    const intercept = (e: MouseEvent) => {
      const target = e.target as Element;
      const paid = target.closest(".cv-plan-pro > button");
      const trial = target
        .closest("button.pd-primary")
        ?.parentElement?.querySelector(".gj-trial-terms");
      if (paid || trial) {
        e.preventDefault();
        e.stopPropagation();
        send({
          type: "mascot:notice",
          text: "This opens the existing plan signup flow on the review page.",
        });
        return;
      }
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      const url = new URL(link.href, location.href),
        path = url.pathname;
      e.preventDefault();
      e.stopPropagation();
      if (url.hash && path === location.pathname) {
        scrollToJourneySection(url.hash.slice(1), "instant");
        return;
      }
      if (path === "/signup" || path === "/signin") {
        send({
          type: "mascot:notice",
          text: `This button opens ${path === "/signup" ? "free account creation" : "sign in"} on the normal page.`,
        });
      } else if (
        path === "/designs/guided-journey" ||
        path === "/designs/guided-journey/pricing"
      ) {
        send({
          type: "mascot:navigate",
          page: path.endsWith("/pricing") ? "pricing" : "landing",
        });
      } else {
        send({
          type: "mascot:notice",
          text: "Open the review page to follow this navigation link.",
        });
      }
    };
    document.addEventListener("click", intercept, true);
    return () => {
      stop();
      clearInterval(timer);
      window.removeEventListener("message", receive);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      document.removeEventListener("click", intercept, true);
    };
  }, []);
  useEffect(() => {
    if (!studio || !inspect) return;
    let drag: {
      x: number;
      y: number;
      stop: RailStop;
      target: "mascot" | "bubble";
      element: Element;
      pointer: number;
    } | null = null;
    let moved = false;
    const send = (data: object) =>
      window.parent.postMessage(data, window.location.origin);
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element,
        character = target.closest(".gj-rail-character"),
        bubble = target.closest(".gj-rail-bubble");
      if (!character && (!bubble || target.closest("a,button"))) return;
      const element = (character ?? bubble)!;
      const rail = document.querySelector<HTMLElement>(".gj-rail")!;
      if (rail.dataset.mode !== "desktop") {
        send({
          type: "mascot:notice",
          text: "Use the Mobile controls to position the compact companion.",
        });
        return;
      }
      e.preventDefault();
      moved = false;
      drag = {
        x: e.clientX,
        y: e.clientY,
        stop: rail.dataset.context as RailStop,
        target: character ? "mascot" : "bubble",
        element,
        pointer: e.pointerId,
      };
      element.setPointerCapture(e.pointerId);
      send({ type: "mascot:drag-start" });
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      e.preventDefault();
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.1) moved = true;
      send({
        type: "mascot:drag",
        stop: drag.stop,
        target: drag.target,
        dx,
        dy,
      });
      drag.x = e.clientX;
      drag.y = e.clientY;
    };
    const up = () => {
      if (!drag) return;
      try {
        drag.element.releasePointerCapture(drag.pointer);
      } catch {}
      drag = null;
      send({ type: "mascot:drag-end" });
    };
    const click = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("click", click, true);
    return () => {
      up();
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("click", click, true);
    };
  }, [studio, inspect]);
  return { config, studio, pinned, inspect };
}
