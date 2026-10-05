import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLIED_KEY,
  cloneConfig,
  DEFAULT_MASCOT_CONFIG,
  parseMascotConfig,
  readMascotConfig,
} from "./mascot-config";
afterEach(() => vi.unstubAllGlobals());
describe("portable companion configuration", () => {
  it("ships the approved delighted pricing welcome without browser storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(readMascotConfig().messages.plans.pose).toBe("celebrate");
    expect(readMascotConfig().stops.plans.x).toBe(0);
  });
  it("round-trips edited positions, dialogue, actions and timing without losing settings", () => {
    const config = cloneConfig();
    config.stops.demo = {
      x: -24.5,
      y: 65,
      scale: 1.3,
      bubbleX: 35,
      bubbleY: -12,
      bubbleWidth: 260,
      placement: "right",
      facing: "left",
    };
    config.messages.editing.text = "Try your own words.";
    config.messages.editing.action = "trial";
    config.messages.editing.label = "Try Pro";
    config.motion.repeatReactions = true;
    config.motion.cooldownMs = 10000;
    config.mobile.side = "left";
    config.messages.dragging.text = "Up, up and away!";
    expect(parseMascotConfig(JSON.parse(JSON.stringify(config)))).toEqual(
      config,
    );
  });
  it("rejects unrelated or incompatible files", () => {
    for (const value of [
      null,
      [],
      {},
      { version: 2, stops: {}, messages: {} },
      { version: 1, stops: "hello", messages: {} },
      { version: 1, stops: {}, messages: [] },
    ])
      expect(() => parseMascotConfig(value)).toThrow(/Companion Studio/);
  });
  it("bounds imported geometry and timing and disallows arbitrary navigation actions", () => {
    const value = cloneConfig() as any;
    value.stops.hero.x = Infinity;
    value.stops.demo.y = -99999;
    value.stops.demo.scale = 20;
    value.stops.demo.facing = "upside-down";
    value.stops.plans.bubbleWidth = 1;
    value.motion.reactionMs = -1;
    value.motion.bob = 500;
    value.messages.hero.action = "https://example.com";
    value.messages.hero.pose = "unknown";
    value.messages.hero.text = "a".repeat(1000);
    value.mobile.bottom = 9999;
    value.unknown = "discard";
    const parsed = parseMascotConfig(value);
    expect(parsed.stops.hero.x).toBe(0);
    expect(parsed.stops.demo.y).toBe(-900);
    expect(parsed.stops.demo.scale).toBe(1.8);
    expect(parsed.stops.demo.facing).toBe("auto");
    expect(parsed.stops.plans.bubbleWidth).toBe(160);
    expect(parsed.motion.reactionMs).toBe(500);
    expect(parsed.motion.bob).toBe(8);
    expect(parsed.messages.hero.action).toBe("demo");
    expect(parsed.messages.hero.pose).toBe("guide");
    expect(parsed.messages.hero.text).toHaveLength(240);
    expect(parsed.mobile.bottom).toBe(140);
    expect(parsed).not.toHaveProperty("unknown");
  });
  it("fills omitted fields with independent defaults", () => {
    const parsed = parseMascotConfig({
      version: 1,
      stops: { hero: { x: 20 } },
      messages: {},
    });
    expect(parsed.stops.hero.x).toBe(20);
    expect(parsed.stops.demo).toEqual(DEFAULT_MASCOT_CONFIG.stops.demo);
    parsed.messages.hero.text = "Changed";
    expect(DEFAULT_MASCOT_CONFIG.messages.hero.text).not.toBe("Changed");
  });
  it("preserves older Studio exports and adds only the new facing and drag defaults", () => {
    const previous = cloneConfig() as any;
    for (const stop of Object.values(previous.stops) as any[])
      delete stop.facing;
    delete previous.messages.dragging;
    delete previous.messages.dropped;
    previous.stops.plans.x = -360;
    previous.stops.plans.scale = 1.5;
    previous.messages.plans.pose = "celebrate";
    previous.messages.plans.text = "My carefully configured pricing welcome.";
    const original = JSON.stringify(previous);
    const parsed = parseMascotConfig(previous);
    expect(parsed.stops.plans).toEqual({
      ...previous.stops.plans,
      facing: "auto",
    });
    expect(parsed.messages.plans).toEqual(previous.messages.plans);
    expect(parsed.messages.dragging.pose).toBe("celebrate");
    expect(parsed.messages.dropped.action).toBe("none");
    expect(JSON.stringify(previous)).toBe(original);
  });
  it("keeps legacy browser pricing offsets relative to the original rail", () => {
    const previous = cloneConfig();
    delete previous.stops.plans.anchor;
    previous.stops.plans.x = -360;
    previous.messages.plans.pose = "celebrate";
    const parsed = parseMascotConfig(previous);
    expect(parsed.stops.plans.anchor).toBe("outer");
    expect(parsed.stops.plans.x).toBe(-360);
    expect(cloneConfig().stops.plans.anchor).toBe("pro-card");
  });
  it("adds the collection stop to old exports without changing their route or dialogue", () => {
    const previous = cloneConfig() as any;
    delete previous.stops.showcase;
    delete previous.messages.showcase;
    delete previous.motion.showcaseEarly;
    previous.stops.plans.x = -360;
    previous.stops.demo.y = 80;
    previous.messages.hero.text = "My welcome";
    const parsed = parseMascotConfig(previous);
    expect(parsed.stops.showcase).toEqual(DEFAULT_MASCOT_CONFIG.stops.showcase);
    expect(parsed.messages.showcase).toEqual(
      DEFAULT_MASCOT_CONFIG.messages.showcase,
    );
    expect(parsed.motion.showcaseEarly).toBe(0);
    for (const id of Object.keys(previous.stops))
      expect(parsed.stops[id]).toEqual(previous.stops[id]);
    for (const id of Object.keys(previous.messages))
      expect(parsed.messages[id]).toEqual(previous.messages[id]);
  });
  it("reads applied settings and tolerates corrupt or unavailable storage", () => {
    const data = cloneConfig();
    data.mobile.size = 64;
    const getItem = vi.fn().mockReturnValue(JSON.stringify(data));
    vi.stubGlobal("localStorage", { getItem });
    expect(readMascotConfig()).toEqual(data);
    expect(getItem).toHaveBeenCalledWith(APPLIED_KEY);
    getItem.mockReturnValue("{bad");
    expect(readMascotConfig()).toEqual(cloneConfig());
    getItem.mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readMascotConfig()).toEqual(cloneConfig());
  });
});
