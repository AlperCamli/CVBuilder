import { describe, expect, it } from "vitest";
import { aiImportImproveSchema } from "../src/modules/ai/ai.schemas";

const basePayload = {
  parsed_content: { sections: [] },
  import_id: "11111111-1111-4111-8111-111111111111"
};

describe("AI import improve request schema", () => {
  it("accepts CV review v2 weaknesses, which combine issue, quote and fix", () => {
    // Production failed with 354- and 311-character weaknesses under the old 300 limit.
    const weakness = `${"I".repeat(220)} “${"q".repeat(200)}” ${"F".repeat(240)}`;
    const parsed = aiImportImproveSchema.parse({ ...basePayload, improvement_guidance: [weakness, "Add figures."] });
    expect(parsed.improvement_guidance).toHaveLength(2);
  });

  it("still bounds the guidance", () => {
    expect(aiImportImproveSchema.safeParse({ ...basePayload, improvement_guidance: ["x".repeat(1001)] }).success).toBe(false);
    expect(aiImportImproveSchema.safeParse({ ...basePayload, improvement_guidance: Array(21).fill("x") }).success).toBe(false);
  });
});
