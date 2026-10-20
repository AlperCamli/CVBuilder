import { describe, expect, it } from "vitest";
import { positionGuide } from "./tutorial-position";

describe("guide placement around editor buttons", () => {
  it.each([320, 390, 768, 1280])("keeps a popup inside a %ipx viewport without covering its button", viewportWidth => {
    for (const top of [20, 360, 720]) {
      const target = { top, bottom: top + 40, left: viewportWidth - 170, right: viewportWidth - 12, width: 158, height: 40 };
      const width = Math.min(320, viewportWidth - 24);
      const result = positionGuide(target, width, 140, viewportWidth, 844, "bottom");
      expect(result.left).toBeGreaterThanOrEqual(12);
      expect(result.left + width).toBeLessThanOrEqual(viewportWidth - 12);
      expect(result.top).toBeGreaterThanOrEqual(12);
      expect(result.top + 140).toBeLessThanOrEqual(832);
      expect(result.overlap).toBe(0);
    }
  });
  it("flips above a button when there is no room below it", () => {
    expect(positionGuide({ top: 720, bottom: 760, left: 500, right: 660, width: 160, height: 40 }, 320, 140, 1280, 844, "bottom").side).toBe("top");
  });
});
