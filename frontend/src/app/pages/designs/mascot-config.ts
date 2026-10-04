/** Versioned, portable configuration for the design-review companion. */
export const STOP_IDS = ["hero", "demo", "plans", "signup", "return"] as const;
export type RailStop = (typeof STOP_IDS)[number];
export const STOP_LABELS: Record<RailStop, string> = {
  hero: "Welcome",
  demo: "Demo",
  plans: "Pricing",
  signup: "Closing",
  return: "Return to top",
};
export const POSES = ["guide", "thinking", "celebrate", "point"] as const;
export type MascotPose = (typeof POSES)[number];
export const ACTIONS = [
  "none",
  "demo",
  "plans",
  "signup",
  "signin",
  "trial",
] as const;
export type MascotAction = (typeof ACTIONS)[number];
export const MESSAGE_IDS = [
  "hero",
  "keywords",
  "editing",
  "templates",
  "plans",
  "signup",
  "return",
  "greeting",
  "keywordsSuccess",
  "editSuccess",
  "templateSuccess",
  "exportSuccess",
  "dragging",
  "dropped",
] as const;
export type MessageId = (typeof MESSAGE_IDS)[number];
export const MESSAGE_LABELS: Record<MessageId, string> = {
  hero: "Welcome",
  keywords: "Choosing keywords",
  editing: "Editing a CV",
  templates: "Choosing a template",
  plans: "Free versus Pro",
  signup: "Create an account",
  return: "Back at the top",
  greeting: "When greeted",
  keywordsSuccess: "Keywords applied",
  editSuccess: "Edit completed",
  templateSuccess: "Template selected",
  exportSuccess: "Export opened",
  dragging: "Being picked up",
  dropped: "After being moved",
};
export const MESSAGE_STOP: Record<MessageId, RailStop> = {
  hero: "hero",
  keywords: "demo",
  editing: "demo",
  templates: "demo",
  plans: "plans",
  signup: "signup",
  return: "return",
  greeting: "hero",
  keywordsSuccess: "demo",
  editSuccess: "demo",
  templateSuccess: "demo",
  exportSuccess: "demo",
  dragging: "hero",
  dropped: "hero",
};
export const STOP_MESSAGE: Record<RailStop, MessageId> = {
  hero: "hero",
  demo: "editing",
  plans: "plans",
  signup: "signup",
  return: "return",
};
export type StopConfig = {
  x: number;
  y: number;
  scale: number;
  bubbleX: number;
  bubbleY: number;
  bubbleWidth: number;
  placement: "above" | "left" | "right";
  facing: "auto" | "left" | "right";
};
export type DialogueConfig = {
  text: string;
  pose: MascotPose;
  enabled: boolean;
  action: MascotAction;
  label: string;
  secondaryAction: MascotAction;
  secondaryLabel: string;
};
export type MascotConfig = {
  version: 1;
  stops: Record<RailStop, StopConfig>;
  messages: Record<MessageId, DialogueConfig>;
  motion: {
    smoothing: number;
    bob: number;
    idleSeconds: number;
    lean: number;
    reactionMs: number;
    editDelay: number;
    repeatReactions: boolean;
    cooldownMs: number;
    hideWhileTraveling: boolean;
    demoEarly: number;
    pricingEarly: number;
    closingEarly: number;
    returnDistance: number;
  };
  mobile: {
    side: "left" | "right";
    bottom: number;
    size: number;
    bubbleWidth: number;
  };
};
const message = (
  text: string,
  pose: MascotPose,
  action: MascotAction = "plans",
  label = "Explore plans",
): DialogueConfig => ({
  text,
  pose,
  enabled: true,
  action,
  label,
  secondaryAction: "none",
  secondaryLabel: "",
});
export const DEFAULT_MASCOT_CONFIG: MascotConfig = {
  version: 1,
  stops: Object.fromEntries(
    STOP_IDS.map((id) => [
      id,
      {
        x: 0,
        y: 0,
        scale: 1,
        bubbleX: 0,
        bubbleY: 0,
        bubbleWidth: 0,
        placement: id === "return" ? "left" : "above",
        facing: "auto",
      },
    ]),
  ) as MascotConfig["stops"],
  messages: {
    hero: message(
      "I’ll show you around—let’s try a little edit.",
      "guide",
      "demo",
      "Try the demo",
    ),
    keywords: message(
      "Choose the keywords that match your experience.",
      "guide",
    ),
    editing: message(
      "Try editing a line and watch your CV update.",
      "thinking",
    ),
    templates: message("Try a template for a fresh look.", "guide"),
    plans: {
      ...message(
        "Start Free, or go Pro for unlimited CVs and exports.",
        "thinking",
        "signup",
        "Start free",
      ),
      secondaryAction: "trial",
      secondaryLabel: "About the 3-day trial",
    },
    signup: message(
      "Let’s put your experience to work.",
      "guide",
      "signup",
      "Create free account",
    ),
    return: message("Ready to make it yours?", "point", "signup", "Start free"),
    greeting: message(
      "You’ve got this—I’m right here.",
      "celebrate",
      "none",
      "",
    ),
    dragging: message("Wheee! A change of scenery!", "celebrate", "none", ""),
    dropped: message(
      "Comfy here! See you at the next stop.",
      "guide",
      "none",
      "",
    ),
    keywordsSuccess: message("Your CV now reflects your choices!", "celebrate"),
    editSuccess: message(
      "Look at that—your edit is already in the preview!",
      "celebrate",
    ),
    templateSuccess: message(
      "Looking good—your experience, your style!",
      "celebrate",
    ),
    exportSuccess: message(
      "Ready to make one of your own?",
      "celebrate",
      "signup",
      "Start free",
    ),
  },
  motion: {
    smoothing: 140,
    bob: 2,
    idleSeconds: 4.5,
    lean: 1.5,
    reactionMs: 2600,
    editDelay: 600,
    repeatReactions: false,
    cooldownMs: 6000,
    hideWhileTraveling: true,
    demoEarly: 0,
    pricingEarly: 0,
    closingEarly: 0,
    returnDistance: 240,
  },
  mobile: { side: "right", bottom: 12, size: 50, bubbleWidth: 232 },
};
export const DRAFT_KEY = "jobspecificcv:companion-studio:draft:v1";
export const APPLIED_KEY = "jobspecificcv:companion-studio:applied:v1";
export const cloneConfig = (): MascotConfig =>
  JSON.parse(JSON.stringify(DEFAULT_MASCOT_CONFIG));
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const num = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
const str = (value: unknown, fallback: string, max: number) =>
  typeof value === "string" ? value.slice(0, max) : fallback;
const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const pick = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T => (choices.includes(value as T) ? (value as T) : fallback);
/** Copy only known keys; reject incompatible documents and bound imported values. */
export function parseMascotConfig(value: unknown): MascotConfig {
  const source = record(value);
  if (
    source.version !== 1 ||
    !source.stops ||
    typeof source.stops !== "object" ||
    Array.isArray(source.stops) ||
    !source.messages ||
    typeof source.messages !== "object" ||
    Array.isArray(source.messages)
  )
    throw new Error("Choose a Companion Studio JSON file (version 1).");
  const result = cloneConfig(),
    stops = record(source.stops),
    messages = record(source.messages),
    motion = record(source.motion),
    mobile = record(source.mobile);
  for (const id of STOP_IDS) {
    const s = record(stops[id]),
      d = result.stops[id];
    result.stops[id] = {
      x: num(s.x, d.x, -1600, 1600),
      y: num(s.y, d.y, -900, 900),
      scale: num(s.scale, d.scale, 0.5, 1.8),
      bubbleX: num(s.bubbleX, d.bubbleX, -1600, 1600),
      bubbleY: num(s.bubbleY, d.bubbleY, -900, 900),
      bubbleWidth:
        s.bubbleWidth === 0 || s.bubbleWidth === undefined
          ? d.bubbleWidth
          : num(s.bubbleWidth, d.bubbleWidth, 160, 420),
      placement: pick(s.placement, ["above", "left", "right"], d.placement),
      facing: pick(s.facing, ["auto", "left", "right"], d.facing),
    };
  }
  for (const id of MESSAGE_IDS) {
    const s = record(messages[id]),
      d = result.messages[id];
    result.messages[id] = {
      text: str(s.text, d.text, 240),
      pose: pick(s.pose, POSES, d.pose),
      enabled: bool(s.enabled, d.enabled),
      action: pick(s.action, ACTIONS, d.action),
      label: str(s.label, d.label, 45),
      secondaryAction: pick(s.secondaryAction, ACTIONS, d.secondaryAction),
      secondaryLabel: str(s.secondaryLabel, d.secondaryLabel, 55),
    };
  }
  const ranges = {
    smoothing: [0, 600],
    bob: [0, 8],
    idleSeconds: [2, 12],
    lean: [0, 8],
    reactionMs: [500, 6000],
    editDelay: [200, 2000],
    cooldownMs: [1000, 30000],
    demoEarly: [-400, 400],
    pricingEarly: [-400, 400],
    closingEarly: [-400, 400],
    returnDistance: [120, 600],
  } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[])
    result.motion[key] = num(motion[key], result.motion[key], ...ranges[key]);
  result.motion.repeatReactions = bool(
    motion.repeatReactions,
    result.motion.repeatReactions,
  );
  result.motion.hideWhileTraveling = bool(
    motion.hideWhileTraveling,
    result.motion.hideWhileTraveling,
  );
  result.mobile = {
    side: pick(mobile.side, ["left", "right"], "right"),
    bottom: num(mobile.bottom, 12, 8, 140),
    size: num(mobile.size, 50, 36, 90),
    bubbleWidth: num(mobile.bubbleWidth, 232, 180, 320),
  };
  return result;
}
export function readMascotConfig(key = APPLIED_KEY): MascotConfig {
  try {
    const value = localStorage.getItem(key);
    return value ? parseMascotConfig(JSON.parse(value)) : cloneConfig();
  } catch {
    return cloneConfig();
  }
}
