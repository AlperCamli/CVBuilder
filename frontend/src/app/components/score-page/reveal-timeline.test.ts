import { describe, expect, it } from "vitest";
import { MAX_SEQUENCE_MS, buildRevealTimeline, hasSeenReveal, markRevealSeen, revealMode, spanProgress, type RevealTimeline } from "./reveal-timeline";

const ends = (span: readonly [number, number] | null) => span ? span[0] + span[1] : 0;
/** Every beat must start in reading order and finish by the end of the sequence. */
function expectOrdered(tl: RevealTimeline) {
  const starts = tl.items.map(item => item.start);
  expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  const spans = [tl.block, tl.ring, tl.verdict, tl.strengthsHeading, tl.weaknessesHeading, tl.how, tl.cta,
    ...tl.strengths.flatMap(s => [s.card, s.circle, s.tick]),
    ...tl.weaknesses.flatMap(w => [w.card, w.badge, w.quote, w.highlight, w.fix])];
  for (const span of spans) expect(ends(span)).toBeLessThanOrEqual(tl.end + 1e-6);
  expect(tl.end).toBeLessThanOrEqual(MAX_SEQUENCE_MS + 1e-6);
}

describe("buildRevealTimeline", () => {
  it("matches the prototype's beats for the 71-point sample (3 strengths, weaknesses with and without quote)", () => {
    const tl = buildRevealTimeline({ strengths: 3, weaknesses: [{ quote: false, fix: true }, { quote: true, fix: true }, { quote: true, fix: true }] });
    expect(tl.ring).toEqual([150, 1000]);
    expect(tl.verdict[0]).toBe(1050);
    expect(tl.strengthsHeading![0]).toBe(1450);
    expect(tl.strengths.map(s => s.start)).toEqual([1650, 2030, 2410]);
    expect(tl.weaknessesHeading![0]).toBe(2910);
    expect(tl.weaknesses.map(w => w.start)).toEqual([3110, 3580, 4340]);
    expect(tl.weaknesses[0]).toMatchObject({ quote: null, highlight: null, fix: [3440, 360] });
    expect(tl.weaknesses[1]).toMatchObject({ quote: [3760, 250], highlight: [3860, 480], fix: [4200, 360] });
    expect(tl.how[0]).toBe(5160);
    expect(tl.end).toBe(5980);
    expectOrdered(tl);
  });

  it("handles uneven lists: 3 strengths and 1 weakness ends sooner", () => {
    const tl = buildRevealTimeline({ strengths: 3, weaknesses: [{ quote: true, fix: true }] });
    expect(tl.weaknesses).toHaveLength(1);
    expect(tl.end).toBe(4750); // the spec's "~4.7 s" for the 86 example
    expect(tl.items.map(item => item.id)).toEqual(["score", "verdict", "strengths", "strength-0", "strength-1", "strength-2", "weaknesses", "weakness-0", "how", "actions"]);
    expectOrdered(tl);
  });

  it("skips a missing section entirely", () => {
    const noStrengths = buildRevealTimeline({ strengths: 0, weaknesses: [{ quote: false, fix: true }, { quote: false, fix: false }] });
    expect(noStrengths.strengthsHeading).toBeNull();
    expect(noStrengths.strengths).toEqual([]);
    expect(noStrengths.weaknessesHeading![0]).toBe(1450);
    expect(noStrengths.weaknesses[1].fix).toBeNull();
    expectOrdered(noStrengths);
    const neither = buildRevealTimeline({ strengths: 0, weaknesses: [] });
    expect(neither.weaknessesHeading).toBeNull();
    expect(neither.how[0]).toBe(1450);
    expect(neither.items.map(item => item.id)).toEqual(["score", "verdict", "how", "actions"]);
    expectOrdered(neither);
  });

  it("squeezes the longest lists to finish within about 6 s", () => {
    const quoted = { quote: true, fix: true };
    const tl = buildRevealTimeline({ strengths: 3, weaknesses: [quoted, quoted, quoted] });
    expect(tl.end).toBeCloseTo(MAX_SEQUENCE_MS);
    expectOrdered(tl);
  });

  it("reads progress as 0 before a span, 1 after it and done when there is no span", () => {
    expect(spanProgress(0, [100, 200])).toBe(0);
    expect(spanProgress(200, [100, 200])).toBe(0.5);
    expect(spanProgress(400, [100, 200])).toBe(1);
    expect(spanProgress(0, null)).toBe(1);
    expect(spanProgress(0, [0, 0])).toBe(1);
  });
});

describe("revealMode", () => {
  const base = { enabled: true, reduced: false, scorable: true, simple: false, seen: false };
  it("plays the cascade only on the first view of a scorable review", () => {
    expect(revealMode(base)).toBe("sequence");
    expect(revealMode({ ...base, seen: true })).toBe("static");
    expect(revealMode({ ...base, enabled: false })).toBe("static");
  });
  it("fades instead with reduced motion, unscorable or image-based reviews", () => {
    expect(revealMode({ ...base, reduced: true })).toBe("fade");
    expect(revealMode({ ...base, scorable: false })).toBe("fade");
    expect(revealMode({ ...base, simple: true })).toBe("fade");
  });
});

describe("session 'already seen' memory", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };
  it("remembers a review per import id", () => {
    const store = memory();
    expect(hasSeenReveal(store, "import-1")).toBe(false);
    markRevealSeen(store, "import-1");
    expect(hasSeenReveal(store, "import-1")).toBe(true);
    expect(hasSeenReveal(store, "import-2")).toBe(false);
  });
  it("never throws and never remembers without storage or an id", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(() => markRevealSeen(broken, "import-1")).not.toThrow();
    expect(hasSeenReveal(broken, "import-1")).toBe(false);
    expect(hasSeenReveal(null, "import-1")).toBe(false);
    const store = memory();
    markRevealSeen(store, undefined);
    expect(hasSeenReveal(store, undefined)).toBe(false);
  });
});
