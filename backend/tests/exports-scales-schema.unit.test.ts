import { describe, expect, it } from "vitest";
import { createExportSchema } from "../src/modules/exports/exports.schemas";

describe("compact export scales", () => {
  it("accepts the editor's smallest scales", () => {
    const scales = { font_scale: 0.5, spacing_scale: 0.2, layout_scale: 0.2 };
    expect(createExportSchema.parse(scales)).toEqual(scales);
  });

  it.each([
    { font_scale: 0.49 }, { spacing_scale: 0.19 }, { layout_scale: 0.19 },
    { font_scale: 1.16 }, { spacing_scale: 1.41 }, { layout_scale: 1.31 }
  ])("rejects out-of-range scales: %j", (scales) => {
    expect(createExportSchema.safeParse(scales).success).toBe(false);
  });
});
