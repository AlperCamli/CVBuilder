import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n } from "../localization/i18n";
import { scoreGain } from "../integration/import-improve";
import { ScoreImprovementResult } from "./ScoreImprovementResult";
import { CROSSFADE_MS, buildTimeline, colorAt, odometerPosition, readPalette, rollValue } from "./score-animation/timeline";

const motionPreference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => motionPreference.reduced };
});

afterEach(async () => {
  motionPreference.reduced = false;
  await i18n.changeLanguage("en");
});

const render = (before: number, after: number) =>
  renderToStaticMarkup(<ScoreImprovementResult before={before} after={after} onContinue={() => undefined} />);

/** Markup of the score row (role="img"), which must expose only its label. */
function scoreRow(html: string): string {
  const start = html.indexOf('role="img"');
  const end = html.indexOf('<p class="mt-5"', start);
  return html.slice(start, end);
}

describe("score result after Improve with AI", () => {
  it("is shown only when the server reports a higher score", () => {
    expect(scoreGain({ before: 62, after: 71 })).toEqual({ before: 62, after: 71 });
    expect(scoreGain({ before: 62, after: 62 })).toBeNull();
    expect(scoreGain({ before: 62, after: 60 })).toBeNull();
    expect(scoreGain(null)).toBeNull();
    expect(scoreGain(undefined)).toBeNull();
    expect(scoreGain({ before: Number.NaN, after: 70 })).toBeNull();
  });

  it("shows the score going from before to after with one Continue button, and nothing else", () => {
    const html = render(62, 71);
    expect(html).toContain("Your CV score went up");
    expect(html).toContain('aria-label="Your CV score went from 62 to 71 out of 100"');
    expect(html).toMatch(/data-score-old=""[^>]*>62</);
    expect(html).toContain("data-score-strike");
    expect(html).toMatch(/>71</);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Continue");
    // No per-area breakdown, formula or explanation.
    expect(html).not.toMatch(/Wording|Experience depth|Role focus|Measurable results|formula|breakdown|How we evaluate/i);
  });

  it("has the final values and the before/after label on the first render, before any animation runs", () => {
    const html = render(68, 74);
    expect(html).toContain('aria-label="Your CV score went from 68 to 74 out of 100"');
    expect(html).toMatch(/>68</);
    expect(html).toMatch(/>74</);
    // The animated version is what renders first.
    expect(html).toContain("data-odometer-strip");
    expect(html).toContain("data-score-ghost");
    expect(html).toContain("data-score-sparks");
    expect(html).toMatch(/data-score-chip=""[^>]*>\+6</);
  });

  it("keeps Continue usable from the first frame", () => {
    const html = render(68, 74);
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).not.toMatch(/disabled|aria-disabled|tabindex="-1"|pointer-events/);
  });

  it("hides every animated part from screen readers and keeps overlays out of the layout", () => {
    const row = scoreRow(render(72, 84));
    // The old score, arrow, ring and every overlay are aria-hidden.
    expect(row).toMatch(/<svg class="flex-none overflow-visible"[^>]*aria-hidden="true"/);
    for (const marker of ["data-score-ghost", "data-score-sparks"]) {
      expect(row).toMatch(new RegExp(`aria-hidden="true" ${marker}`));
    }
    const ring = row.match(/<div class="relative h-\[120px\][^>]*>/)?.[0] ?? "";
    expect(ring).toContain('aria-hidden="true"');
    expect(row).toMatch(/<div class="text-center" aria-hidden="true"/);
    // Ghost, sparks and chip are absolutely positioned overlays.
    expect(row).toMatch(/class="pointer-events-none absolute inset-0" aria-hidden="true" data-score-ghost/);
    expect(row).toMatch(/class="pointer-events-none absolute inset-0" aria-hidden="true" data-score-sparks/);
    expect(row).toMatch(/class="pointer-events-none absolute [^"]*" data-score-chip/);
  });

  it("renders the final state with reduced motion: no flight, roll or particles", () => {
    motionPreference.reduced = true;
    const html = render(68, 74);
    expect(html).toContain('aria-label="Your CV score went from 68 to 74 out of 100"');
    expect(html).toMatch(/>74</);
    expect(html).not.toMatch(/data-odometer-strip|data-score-ghost|data-score-sparks|data-score-chip|data-score-glow/);
    // Crossed out, full arc in the final colour, copy and button fully shown; only the card fades (200 ms).
    expect(html).toMatch(/data-score-strike=""[^>]*transform:none/);
    expect(html).toContain(`stroke="#8A5907" stroke-dasharray="${(74 / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}"`);
    expect(html).toMatch(/role="status" style="opacity:0"/);
    expect(html).toMatch(/<button[^>]*style="[^"]*opacity:1/);
    expect(html).toMatch(/<h1[^>]*opacity:1/);
  });

  it("speaks Turkish in the informal form", async () => {
    await i18n.changeLanguage("tr");
    const html = render(48, 57);
    expect(html).toContain("CV puanın yükseldi");
    expect(html).toContain("CV puanın 100 üzerinden 48 iken 57 oldu");
    expect(html).toContain("İyileştirmeler ana CV’ne kaydedildi.");
    expect(html).toContain("Devam et");
  });
});

describe("score carry-over timeline", () => {
  const palette = readPalette();

  it("ends the roll exactly on the new score, odometer digits included", () => {
    for (const [before, after] of [[68, 74], [72, 84], [41, 55], [95, 100], [8, 12], [69, 70]]) {
      const tl = buildTimeline(before, after);
      expect(rollValue(tl, tl.end)).toBe(after);
      const digits = String(after).padStart(3, "0").split("").map(Number).reverse();
      for (let place = 0; place < String(after).length; place++) {
        expect(odometerPosition(after, place) % 10).toBeCloseTo(digits[place]);
      }
    }
  });

  it("crossfades a band crossing in at most 200 ms", () => {
    const tl = buildTimeline(72, 84);
    expect(tl.crossings).toHaveLength(1);
    const { t } = tl.crossings[0];
    expect(t).toBeGreaterThan(tl.roll[0]);
    expect(t).toBeLessThan(tl.roll[0] + tl.roll[1]);
    expect(CROSSFADE_MS).toBeLessThanOrEqual(200);
    expect(colorAt(tl, t - 1, palette)).toBe(palette.amber);
    expect(colorAt(tl, t + CROSSFADE_MS, palette)).toBe(palette.teal);
    expect(buildTimeline(41, 85).crossings.map((c) => c.color)).toEqual(["amber", "teal"]);
    expect(buildTimeline(68, 74).crossings).toHaveLength(0);
  });

  it("keeps the full sequence for small gains, with a shorter roll", () => {
    const small = buildTimeline(70, 71), large = buildTimeline(68, 74);
    expect(small.roll[1]).toBeLessThan(large.roll[1]);
    expect(small.roll[1]).toBeGreaterThanOrEqual(400);
    expect(small.peak).toBe(small.roll[0] + small.roll[1]);
    expect(large.peak).toBe(large.roll[0] + large.roll[1]);
    expect(small.end - small.peak).toBe(large.end - large.peak);
  });
});
