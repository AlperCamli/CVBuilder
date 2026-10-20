import { describe, expect, it } from "vitest";
import { nextCompactScales, resolveScaleFromMetadata, resolveSourcePageCount } from "./cv-display-settings";

describe("compact CV settings", () => {
  it("adjusts uploaded CV fonts first, with whitespace as a fallback", () => {
    expect(nextCompactScales({ fontScale: 1, spacingScale: 1, layoutScale: 1 }, true))
      .toEqual({ fontScale: 0.98, spacingScale: 1, layoutScale: 1 });
    expect(nextCompactScales({ fontScale: 0.5, spacingScale: 1, layoutScale: 1 }, true))
      .toEqual({ fontScale: 0.5, spacingScale: 0.92, layoutScale: 1 });
  });

  it("restores the uploaded page target and rejects invalid counts", () => {
    for (const value of [2, "2"]) {
      expect(resolveSourcePageCount({ version: "v1", language: "en", sections: [], metadata: { source_page_count: value } })).toBe(2);
    }
    for (const value of [0, -1, 1.5, "NaN", "2 pages"]) {
      expect(resolveSourcePageCount({ version: "v1", language: "en", sections: [], metadata: { source_page_count: value } })).toBeNull();
    }
  });

  it("pauses layout at 0.3x, then reduces fonts before using the remaining layout range", () => {
    expect(nextCompactScales({ fontScale: 1, spacingScale: 0.2, layoutScale: 0.34 }))
      .toEqual({ fontScale: 1, spacingScale: 0.2, layoutScale: 0.3 });
    expect(nextCompactScales({ fontScale: 1, spacingScale: 0.2, layoutScale: 0.3 }))
      .toEqual({ fontScale: 0.98, spacingScale: 0.2, layoutScale: 0.3 });
    expect(nextCompactScales({ fontScale: 0.5, spacingScale: 0.2, layoutScale: 0.3 }))
      .toEqual({ fontScale: 0.5, spacingScale: 0.2, layoutScale: 0.22 });
  });

  it("reduces whitespace before reducing font size and reaches every minimum", () => {
    let scales = { fontScale: 1.15, spacingScale: 1.4, layoutScale: 1.3 };
    let steps = 0;
    for (let next = nextCompactScales(scales); next; next = nextCompactScales(scales)) {
      if (next.fontScale < scales.fontScale) {
        expect(next.spacingScale).toBe(0.2);
        expect(next.layoutScale).toBe(0.3);
      }
      if (next.layoutScale < scales.layoutScale) expect(next.spacingScale).toBe(0.2);
      if (next.layoutScale < 0.3) expect(next.fontScale).toBe(0.5);
      expect(next.fontScale).toBeGreaterThanOrEqual(0.5);
      expect(next.spacingScale).toBeGreaterThanOrEqual(0.2);
      expect(next.layoutScale).toBeGreaterThanOrEqual(0.2);
      scales = next;
      expect(++steps).toBeLessThan(100);
    }
    expect(scales).toEqual({ fontScale: 0.5, spacingScale: 0.2, layoutScale: 0.2 });
    expect(steps).toBeGreaterThan(16);
  });

  it("restores compact numeric and string metadata without inflating the scale", () => {
    for (const value of [0.5, "0.5"]) {
      expect(resolveScaleFromMetadata({ version: "v1", language: "en", sections: [], metadata: { font_scale: value } }, "font_scale", value => Math.max(0.5, value))).toBe(0.5);
    }
  });
});
