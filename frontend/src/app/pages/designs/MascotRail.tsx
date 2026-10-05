import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Link } from "react-router";
import { StartLink } from "./DesignShared";
import type { DemoAction } from "./ProductDemo";
import { scrollToJourneySection } from "./mascot-navigation";
import { useMascotDrag } from "./useMascotDrag";

import {
  POSES,
  type RailStop as Context,
  type MascotConfig,
  type MessageId,
  type StopConfig,
  type MascotAction,
} from "./mascot-config";
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;

const blendStop = (a: StopConfig, b: StopConfig, p: number): StopConfig => ({
  x: mix(a.x, b.x, p),
  y: mix(a.y, b.y, p),
  scale: mix(a.scale, b.scale, p),
  bubbleX: mix(a.bubbleX, b.bubbleX, p),
  bubbleY: mix(a.bubbleY, b.bubbleY, p),
  bubbleWidth: p < 0.5 ? a.bubbleWidth : b.bubbleWidth,
  placement: p < 0.5 ? a.placement : b.placement,
  facing: p < 0.5 ? a.facing : b.facing,
});

export function MascotRail({
  config,
  pinned,
  inspect,
  pricing,
  demoStep,
  reaction,
  suspended,
  openRequest,
  onTrial,
}: {
  config: MascotConfig;
  pinned: MessageId | null;
  inspect: boolean;
  pricing: boolean;
  demoStep: number;
  reaction: DemoAction | null;
  suspended: boolean;
  openRequest: number;
  onTrial: () => void;
}) {
  const configRef = useRef(config);
  const inspectRef = useRef(inspect);
  useEffect(() => {
    configRef.current = config;
    inspectRef.current = inspect;
    window.dispatchEvent(new Event("mascot:configure"));
  }, [config, inspect]);
  const rail = useRef<HTMLElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<Context>(pricing ? "plans" : "hero");
  const [desktop, setDesktop] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [typing, setTyping] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const { manual, reaction: dragReaction } = useMascotDrag(
    rail,
    inspect || suspended,
    config.motion.reactionMs,
    context,
  );
  const bubbleId = useId();

  useEffect(() => {
    if (dragReaction) {
      setDismissed(false);
      setExpanded(true);
    }
  }, [dragReaction]);

  useEffect(() => {
    if (pinned) {
      setDismissed(false);
      setExpanded(true);
    }
  }, [pinned]);

  useEffect(() => {
    if (openRequest) {
      setDismissed(false);
      setExpanded(true);
    }
  }, [openRequest]);
  useEffect(() => {
    if (suspended) setExpanded(false);
  }, [suspended]);
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(
      () => setGreeting(false),
      config.motion.reactionMs,
    );
    return () => window.clearTimeout(timer);
  }, [greeting, config.motion.reactionMs]);
  useEffect(() => {
    let frame = 0;
    const readFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        const editing = !!active?.matches(
          "textarea, input:not([type=range]):not([type=checkbox]):not([type=radio]), [contenteditable=true]",
        );
        setTyping(editing);
        if (editing) setExpanded(false);
      });
    };
    document.addEventListener("focusin", readFocus);
    document.addEventListener("focusout", readFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", readFocus);
      document.removeEventListener("focusout", readFocus);
    };
  }, []);

  useEffect(() => {
    const node = rail.current;
    const bubbleNode = bubble.current;
    if (!node || !bubbleNode) return;
    const root = node.closest<HTMLElement>(".cv-guided-journey")!;
    const hero = document.getElementById("gj-hero")!;
    const demo = document.getElementById("demo");
    const showcase = document.getElementById("templates");
    const plans = document.getElementById("plans")!;
    const cards = plans.querySelector<HTMLElement>(".cv-plan-grid")!;
    const paidCard = cards.querySelector<HTMLElement>(".cv-plan-pro")!;
    const signup = document.getElementById("get-started")!;
    const footer = root.querySelector<HTMLElement>(".cv-footer")!;
    const headerCTA = root.querySelector<HTMLElement>(
      "#gj-header-actions > a:last-child",
    )!;
    const media = window.matchMedia(
      "(min-width: 1360px) and (min-height: 560px)",
    );
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const character = node.querySelector<HTMLElement>(".gj-rail-character")!;
    let frame = 0;
    let needsMeasure = true;
    let visitedDemo = false;
    let position: { x: number; y: number } | null = null;
    let heldStop: StopConfig | null = null;
    let previousTime = 0;
    let currentContext: Context = pricing ? "plans" : "hero";
    let currentDesktop = media.matches;
    let geometry: ReturnType<typeof measure>;
    const face = (
      facing: StopConfig["facing"],
      center: number,
      returning: boolean,
    ) => {
      const direction =
        facing === "auto"
          ? returning && !manual.current
            ? "right"
            : center < innerWidth / 2
              ? "right"
              : "left"
          : facing;
      node.dataset.facing = direction;
      node.style.setProperty(
        "--mascot-facing",
        direction === "left" ? "-1" : "1",
      );
    };
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return {
        top: r.top + window.scrollY,
        bottom: r.bottom + window.scrollY,
        left: r.left,
        right: r.right,
        height: r.height,
      };
    };
    function measure() {
      return {
        hero: rect(hero),
        demo: demo ? rect(demo) : null,
        demoContent: demo ? rect(demo.querySelector(".cv-wrap")!) : null,
        showcase: showcase ? rect(showcase) : null,
        showcaseContent: showcase
          ? rect(showcase.querySelector(".cv-wrap")!)
          : null,
        plans: rect(plans),
        cards: rect(cards),
        paidCard: rect(paidCard),
        signup: rect(signup),
        footer: rect(footer),
        heading: rect(hero.querySelector("h1")!),
      };
    }
    const update = (time = performance.now()) => {
      const cfg = configRef.current;
      frame = 0;
      if (needsMeasure) {
        geometry = measure();
        needsMeasure = false;
      }
      const g = geometry;
      const scroll = window.scrollY;
      const height = window.innerHeight;
      const wide = media.matches;
      if (wide !== currentDesktop) {
        currentDesktop = wide;
        setDesktop(wide);
      }
      if (
        g.demo &&
        scroll > cfg.motion.returnDistance &&
        g.demo.top - scroll < height * 0.6
      )
        visitedDemo = true;
      const cta = headerCTA.getBoundingClientRect();
      const returning = visitedDemo && scroll < cfg.motion.returnDistance;
      const next: Context = returning
        ? "return"
        : g.signup.top - scroll < height * 0.56
          ? "signup"
          : pricing || g.plans.top - scroll < height * 0.6
            ? "plans"
            : g.showcase && g.showcase.top - scroll < height * 0.6
              ? "showcase"
              : g.demo && scroll > 140 && g.demo.top - scroll < height * 0.65
                ? "demo"
                : "hero";
      if (next !== currentContext) {
        currentContext = next;
        setContext(next);
      }
      headerCTA.classList.toggle("gj-header-cue", returning && scroll < 20);
      node.dataset.mode = wide ? "desktop" : "compact";
      if (!wide) {
        const m = cfg.mobile;
        const side = next === "showcase" ? "left" : m.side;
        node.style.setProperty("--compact-size", `${m.size}px`);
        node.style.setProperty("--compact-bottom", `${m.bottom}px`);
        bubbleNode.style.setProperty("--compact-size", `${m.size}px`);
        bubbleNode.style.setProperty("--compact-bottom", `${m.bottom}px`);
        bubbleNode.style.width = `${Math.min(m.bubbleWidth, innerWidth - 24)}px`;
        node.dataset.compactSide = side;
        bubbleNode.dataset.compactSide = side;
        node.style.setProperty("--mascot-scale", "1");
        node.style.setProperty("--mascot-lean", "0deg");
        position = null;
        node.style.removeProperty("transform");
        bubbleNode.style.removeProperty("transform");
        bubbleNode.style.removeProperty("visibility");
        node.style.removeProperty("--rail-width");
        node.style.removeProperty("visibility");
        node.dataset.traveling = "false";
        bubbleNode.dataset.traveling = "false";
        bubbleNode.inert = false;
        node.dataset.side = side;
        node.inert = false;
        if (manual.current) {
          // Both layers start at their normal compact anchors. Clamp the visible
          // character, then keep its bubble readable independently at the edges.
          const r = character.getBoundingClientRect();
          const x = clamp(
            manual.current.x,
            r.width / 2 + 8,
            innerWidth - r.width / 2 - 8,
          );
          const y = clamp(
            manual.current.y,
            r.height / 2 + 8,
            height - r.height / 2 - 8,
          );
          const dx = x - r.left - r.width / 2,
            dy = y - r.top - r.height / 2;
          node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          const b = bubbleNode.getBoundingClientRect();
          bubbleNode.style.transform = `translate3d(${clamp(b.left + dx, 12, innerWidth - b.width - 12) - b.left}px, ${clamp(b.top + dy, 12, height - b.height - 12) - b.top}px, 0)`;
          face(cfg.stops[next].facing, x, false);
        } else {
          face(cfg.stops[next].facing, side === "left" ? 0 : innerWidth, false);
        }
        return;
      }
      const width = clamp(window.innerWidth - g.cards.right - 32, 168, 192);
      node.style.setProperty("--rail-width", `${width}px`);
      bubbleNode.style.setProperty("--rail-width", `${width}px`);
      const railHeight = node.offsetHeight;
      const rightX = Math.min(
        g.cards.right + 16,
        window.innerWidth - width - 16,
      );
      const heroX = Math.max(20, (g.heading.left - width) / 2);
      const demoX = (g.demoContent?.left ?? heroX) + 8;
      // Anchor to the real Pro card, so the published pricing welcome does not
      // depend on a browser-local pixel offset or a particular screen width.
      const plansX =
        cfg.stops.plans.anchor === "pro-card"
          ? g.paidCard.left - width / 2 - 66
          : rightX;
      let x = plansX;
      let y = clamp(g.cards.top - scroll + 36, 116, height - railHeight - 24);
      const plansY = y;
      let stop = cfg.stops.plans;
      let traveling = false;
      if (!pricing && g.demo) {
        const approachStart = Math.max(
          0,
          g.hero.bottom - height * 0.55 - cfg.motion.demoEarly,
        );
        const approachEnd = Math.max(
          approachStart + 1,
          g.demo.top - 140 - cfg.motion.demoEarly,
        );
        const approach = clamp(
          (scroll - approachStart) / (approachEnd - approachStart),
          0,
          1,
        );
        const collectionStart = Math.max(
          approachEnd + 60,
          g.demo.bottom - height * 0.65 - cfg.motion.showcaseEarly,
        );
        const collectionEnd = Math.max(
          collectionStart + 1,
          (g.showcase?.top ?? g.plans.top) -
            height * 0.25 -
            cfg.motion.showcaseEarly,
        );
        const collection = g.showcase
          ? clamp(
              (scroll - collectionStart) / (collectionEnd - collectionStart),
              0,
              1,
            )
          : 0;
        const departureSection = g.showcase ?? g.demo;
        const departureStop = g.showcase ? cfg.stops.showcase : cfg.stops.demo;
        const departureX = g.showcaseContent
          ? Math.max(16, (g.showcaseContent.left - width) / 2)
          : demoX;
        const crossingStart = Math.max(
          (g.showcase ? collectionEnd : approachEnd) + 60,
          departureSection.bottom - height * 0.65 - cfg.motion.pricingEarly,
        );
        const crossingEnd = Math.max(
          crossingStart + 1,
          g.plans.top - height * 0.25 - cfg.motion.pricingEarly,
        );
        const crossing = clamp(
          (scroll - crossingStart) / (crossingEnd - crossingStart),
          0,
          1,
        );
        if (crossing === 0) {
          stop = blendStop(cfg.stops.hero, cfg.stops.demo, approach);
          x = reduced.matches
            ? next === "hero"
              ? heroX
              : demoX
            : mix(heroX, demoX, approach);
          y = clamp(
            mix(
              g.hero.top + g.hero.height * 0.44 - scroll,
              g.demo.top + 105 - scroll,
              approach,
            ),
            108,
            height - railHeight - 24,
          );
          if (g.showcase && collection > 0) {
            stop = blendStop(cfg.stops.demo, cfg.stops.showcase, collection);
            x = mix(demoX, departureX, collection);
            y = mix(
              y,
              clamp(
                g.showcase.top - scroll + 105,
                108,
                height - railHeight - 24,
              ),
              collection,
            );
          }
          if (!reduced.matches) {
            // Descend beside the editor before crossing underneath it.
            const departureStart = crossingStart - height * 0.25;
            const departure = clamp(
              (scroll - departureStart) / (crossingStart - departureStart),
              0,
              1,
            );
            const character =
              node.querySelector<HTMLElement>(".gj-rail-character")!;
            const crossingY = clamp(
              departureSection.bottom - scroll + 16 - character.offsetTop,
              24,
              height - railHeight - 20,
            );
            y = mix(y, crossingY, departure);
          }
        } else if (crossing < 1 && !reduced.matches) {
          stop = blendStop(departureStop, cfg.stops.plans, crossing);
          x = mix(departureX, plansX, crossing);
          // Cross in the space below the demo, with the bubble tucked away.
          const character =
            node.querySelector<HTMLElement>(".gj-rail-character")!;
          y = mix(
            clamp(
              departureSection.bottom - scroll + 16 - character.offsetTop,
              24,
              height - railHeight - 20,
            ),
            plansY,
            crossing,
          );
          traveling = true;
        } else if (
          reduced.matches &&
          crossing < 1 &&
          (next === "demo" || next === "showcase")
        ) {
          x = next === "showcase" ? departureX : demoX;
          y = 116;
          stop = cfg.stops[next];
        }
      }
      const closingArrival = reduced.matches
        ? next === "signup"
          ? 1
          : 0
        : clamp(
            (height * 0.85 -
              (g.signup.top - scroll - cfg.motion.closingEarly)) /
              (height * 0.45),
            0,
            1,
          );
      x = mix(x, rightX, closingArrival);
      y = mix(
        y,
        clamp(g.signup.top - scroll + 25, 116, height - railHeight - 24),
        closingArrival,
      );
      stop = blendStop(stop, cfg.stops.signup, closingArrival);
      if (returning) {
        const arrival = reduced.matches
          ? 1
          : 1 - scroll / cfg.motion.returnDistance;
        stop = blendStop(stop, cfg.stops.return, arrival);
        const character =
          node.querySelector<HTMLElement>(".gj-rail-character")!;
        x = mix(
          x,
          clamp(cta.left - width + 32, 16, window.innerWidth - width - 16),
          arrival,
        );
        y = mix(y, cta.bottom + 16 - character.offsetTop, arrival);
        traveling = arrival < 0.98;
      } else {
        y = Math.min(y, g.footer.top - scroll - railHeight - 24);
      }
      // Keep the dropped character and its bubble independent of interpolated
      // rail geometry until another section destination releases the hold.
      if (manual.current) {
        heldStop ??= { ...stop };
        stop = heldStop;
      } else heldStop = null;
      x = clamp(x + stop.x, 8, window.innerWidth - width - 8);
      y = Math.min(y + stop.y, height - railHeight - 8);
      if (manual.current) {
        const halfWidth = (character.offsetWidth * stop.scale) / 2;
        const halfHeight = (character.offsetHeight * stop.scale) / 2;
        x =
          clamp(manual.current.x, halfWidth + 8, innerWidth - halfWidth - 8) -
          width / 2;
        y =
          clamp(manual.current.y, halfHeight + 8, height - halfHeight - 8) -
          railHeight +
          character.offsetHeight / 2;
        traveling = false;
      }
      const target = { x, y };
      const alpha =
        manual.current ||
        reduced.matches ||
        inspectRef.current ||
        !cfg.motion.smoothing
          ? 1
          : 1 -
            Math.exp(
              -Math.min(32, Math.max(1, time - previousTime)) /
                cfg.motion.smoothing,
            );
      if (position) {
        x = mix(position.x, x, alpha);
        y = mix(position.y, y, alpha);
      }
      position = { x, y };
      previousTime = time;
      node.style.setProperty("--mascot-scale", String(stop.scale));
      node.style.setProperty(
        "--mascot-lean",
        `${reduced.matches ? 0 : clamp((target.x - x) * 0.15, -cfg.motion.lean, cfg.motion.lean)}deg`,
      );
      const parked = y + railHeight < 0;
      node.style.visibility = parked ? "hidden" : "visible";
      node.inert = parked;
      bubbleNode.inert = parked;
      if (parked) bubbleNode.style.visibility = "hidden";
      else bubbleNode.style.removeProperty("visibility");
      node.dataset.traveling = String(traveling);
      bubbleNode.dataset.traveling = String(
        traveling && cfg.motion.hideWhileTraveling && !inspectRef.current,
      );
      node.dataset.side = x < window.innerWidth / 2 ? "left" : "right";
      face(stop.facing, x + width / 2, returning);
      node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      const bubbleWidth =
        stop.bubbleWidth || (stop.placement === "above" ? width : 192);
      bubbleNode.style.width = `${bubbleWidth}px`;
      bubbleNode.dataset.placement = stop.placement;
      let bx = x + stop.bubbleX;
      let by =
        y +
        (stop.placement === "above" ? 114 - bubbleNode.offsetHeight : 116) +
        stop.bubbleY;
      if (stop.placement === "left") bx -= bubbleWidth + 12;
      if (stop.placement === "right") bx += width + 12;
      bx = clamp(bx, 12, innerWidth - bubbleWidth - 12);
      by = clamp(by, 12, height - bubbleNode.offsetHeight - 12);
      bubbleNode.style.transform = `translate3d(${bx.toFixed(2)}px, ${by.toFixed(2)}px, 0)`;
      if (Math.abs(target.x - x) + Math.abs(target.y - y) > 0.25) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const remeasure = () => {
      needsMeasure = true;
      schedule();
    };
    const visit = (event: Event) => {
      visitedDemo = (event as CustomEvent<boolean>).detail;
      remeasure();
    };
    window.addEventListener("mascot:visit", visit);
    window.addEventListener("mascot:configure", remeasure);
    window.addEventListener("mascot:drag-update", schedule);
    setDesktop(media.matches);
    const resize = new ResizeObserver(remeasure);
    for (const element of [
      root,
      node,
      bubbleNode,
      hero,
      ...(demo ? [demo] : []),
      ...(showcase ? [showcase] : []),
      plans,
      signup,
    ])
      resize.observe(element);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    window.visualViewport?.addEventListener("resize", remeasure);
    media.addEventListener("change", remeasure);
    reduced.addEventListener("change", remeasure);
    document.fonts.ready.then(() => {
      if (node.isConnected) remeasure();
    });
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("mascot:visit", visit);
      window.removeEventListener("mascot:configure", remeasure);
      window.removeEventListener("mascot:drag-update", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      window.visualViewport?.removeEventListener("resize", remeasure);
      media.removeEventListener("change", remeasure);
      reduced.removeEventListener("change", remeasure);
      headerCTA.classList.remove("gj-header-cue");
    };
  }, [pricing, manual]);

  const demoReaction = context === "demo" && reaction && reaction !== "reset";
  const messageId: MessageId =
    pinned ??
    dragReaction ??
    (greeting
      ? "greeting"
      : context !== "demo"
        ? context
        : demoReaction
          ? (
              {
                keywords: "keywordsSuccess",
                edit: "editSuccess",
                template: "templateSuccess",
                export: "exportSuccess",
              } as const
            )[reaction]
          : (["keywords", "editing", "templates"] as const)[demoStep]);
  const dialogue = config.messages[messageId];
  const pose = dialogue.pose;
  const visible =
    dialogue.enabled &&
    !suspended &&
    !(typing && !desktop) &&
    (desktop ? !dismissed : expanded);
  const action = (kind: MascotAction, label: string, secondary = false) => {
    if (kind === "none" || !label.trim()) return null;
    const className = secondary ? "gj-rail-secondary" : "gj-rail-action";
    if (kind === "signup")
      return (
        <StartLink className={className}>
          {label}
          {!secondary && <ArrowRight size={13} />}
        </StartLink>
      );
    if (kind === "signin")
      return (
        <Link className={className} to="/signin">
          {label}
        </Link>
      );
    return (
      <button
        className={className}
        onClick={() =>
          kind === "trial" ? onTrial() : scrollToJourneySection(kind)
        }
      >
        {label}
        {!secondary && <ArrowRight size={13} />}
      </button>
    );
  };
  return (
    <>
      <aside
        ref={rail}
        className="gj-rail"
        data-context={context}
        data-typing={typing && !desktop}
        data-suspended={suspended}
        data-dragging={dragReaction === "dragging"}
        aria-label="Your CV companion"
        data-idle={config.motion.bob > 0}
        style={
          {
            "--idle-bob": `${config.motion.bob}px`,
            "--idle-seconds": `${config.motion.idleSeconds}s`,
          } as import("react").CSSProperties
        }
      >
        <button
          className={`gj-rail-character gj-pose-${pose}`}
          aria-label={
            visible ? "Say hello to your mascot" : "Open mascot guidance"
          }
          aria-controls={bubbleId}
          aria-expanded={visible}
          aria-describedby={`${bubbleId}-move-help`}
          title="Drag me out of the way"
          onClick={() => {
            if (visible) setGreeting(true);
            setDismissed(false);
            setExpanded(true);
          }}
        >
          <span className="gj-rail-art">
            {POSES.map((item) => (
              <img
                key={item}
                src={`/images/designs/mascot/${item}.webp`}
                className={item === pose ? "is-active" : ""}
                width="1024"
                height="1536"
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            ))}
          </span>
        </button>
        <span id={`${bubbleId}-move-help`} className="gj-move-help">
          Drag to move me, or use arrow keys while focused. I’ll stay here until
          you scroll to another section. Press Escape to return me to the tour.
        </span>
      </aside>
      <div
        ref={bubble}
        className="gj-rail-bubble"
        id={bubbleId}
        hidden={!visible}
        data-context={context}
        data-typing={typing && !desktop}
        data-suspended={suspended}
      >
        <button
          className="gj-rail-close"
          onClick={() => {
            setDismissed(true);
            setExpanded(false);
          }}
          aria-label="Dismiss mascot message"
        >
          <X size={13} />
        </button>
        <p aria-live="polite">{dialogue.text}</p>
        {action(dialogue.action, dialogue.label)}
        {action(dialogue.secondaryAction, dialogue.secondaryLabel, true)}
      </div>
    </>
  );
}
