import { describe, expect, it } from "vitest";
import { PRELOADED_TAILORED_MAX_AGE_MS, tailoringReturnPath, takePreloadedTailored } from "./cv-editor-tailoring-nav";

const detail = { id: "tailored-1", title: "CV" };

describe("takePreloadedTailored", () => {
  it("ignores state without a preload", () => {
    expect(takePreloadedTailored(null, "tailored-1")).toEqual({ preloaded: null, strippedState: null });
    expect(takePreloadedTailored({ openTailoring: true }, "tailored-1")).toEqual({ preloaded: null, strippedState: null });
  });

  it("uses a fresh preload for the matching route and strips it from state", () => {
    const state = { cvKind: "tailored", isTailored: true, openTailoring: true, preloadedTailored: detail, preloadedAt: 1000 };
    const result = takePreloadedTailored<typeof detail>(state, "tailored-1", 1500);
    expect(result.preloaded).toBe(detail);
    expect(result.strippedState).toEqual({ cvKind: "tailored", isTailored: true, openTailoring: true });
  });

  it("rejects a stale preload (e.g. restored by refresh or back/forward) but still strips it", () => {
    const state = { openTailoring: true, preloadedTailored: detail, preloadedAt: 1000 };
    const result = takePreloadedTailored(state, "tailored-1", 1000 + PRELOADED_TAILORED_MAX_AGE_MS + 1);
    expect(result.preloaded).toBeNull();
    expect(result.strippedState).toEqual({ openTailoring: true });
  });

  it("rejects a preload without a timestamp or for another CV", () => {
    expect(takePreloadedTailored({ preloadedTailored: detail }, "tailored-1").preloaded).toBeNull();
    expect(takePreloadedTailored({ preloadedTailored: detail, preloadedAt: 1000 }, "other", 1000).preloaded).toBeNull();
    expect(takePreloadedTailored({ preloadedTailored: detail, preloadedAt: 2000 }, "tailored-1", 1000).preloaded).toBeNull();
  });
});

describe("tailoringReturnPath", () => {
  it("returns to the editor with the Tailor panel open", () => {
    expect(tailoringReturnPath("abc-123")).toBe("/app/cv/abc-123?tailor=1");
  });
});
