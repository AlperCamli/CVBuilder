import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clampToSchemaLimits } from "../src/modules/ai/flows/clamp-to-schema";
import {
  tailoringAnalysisOutputSchema,
  tailoringSkillsOutputSchema
} from "../src/modules/ai/flows/flow-contracts";

describe("clampToSchemaLimits", () => {
  it("drops over-long list items, cuts over-long fields at a word and caps list lengths", () => {
    const schema = z
      .object({
        reason: z.string().trim().max(20),
        keywords: z.array(z.string().trim().min(1).max(10)).max(2)
      })
      .strict();
    const clamped = clampToSchemaLimits(schema, {
      reason: "  one two three four five six  ",
      keywords: ["SQL", "a much too long keyword", "Excel", "Python"]
    });
    expect(clamped).toEqual({ reason: "one two three four", keywords: ["SQL", "Excel"] });
    expect(schema.safeParse(clamped).success).toBe(true);
  });

  it("leaves shape errors for the contract to report", () => {
    const schema = z.object({ items: z.array(z.string().max(5)).min(1) }).strict();
    expect(schema.safeParse(clampToSchemaLimits(schema, { items: [] })).success).toBe(false);
    expect(schema.safeParse(clampToSchemaLimits(schema, { items: 3 })).success).toBe(false);
    expect(schema.safeParse(clampToSchemaLimits(schema, { items: ["ok"], extra: 1 })).success).toBe(false);
  });

  it("makes a real-world tailoring analysis with long Turkish keywords valid", () => {
    const requirement = (id: string, keyword: string) => ({
      id,
      text: "Raporlama ve veri analizi deneyimi",
      keywords: [keyword, "Excel"],
      importance: "must",
      weight: 3,
      status: "weak",
      confidence: "medium",
      evidence_block_ids: ["b4"],
      reason: "Deneyim kısmen gösteriliyor."
    });
    const output = {
      role_summary: "Raporlama personeli.",
      requirements: Array.from({ length: 17 }, (_, index) =>
        requirement(`r${index + 1}`, "Raporlama süreçlerinin uçtan uca yönetimi ve departmanlar arası koordinasyon")
      ),
      questions: [],
      block_briefs: []
    };
    expect(tailoringAnalysisOutputSchema.safeParse(output).success).toBe(false);
    const clamped = clampToSchemaLimits(tailoringAnalysisOutputSchema, output) as typeof output;
    expect(tailoringAnalysisOutputSchema.safeParse(clamped).success).toBe(true);
    expect(clamped.requirements).toHaveLength(15);
    expect(clamped.requirements[0].keywords).toEqual(["Excel"]);
  });

  it("drops an over-long skill object's name only through its list item", () => {
    const output = {
      changed: true,
      skills: [
        { name: "SQL", allowed_skill: null },
        { name: "x".repeat(80), allowed_skill: null }
      ],
      rationale: "Ordered for the job.",
      requirement_ids: []
    };
    const clamped = clampToSchemaLimits(tailoringSkillsOutputSchema, output);
    // Object items are kept and their fields cut, so the contract still sees a valid shape.
    expect(tailoringSkillsOutputSchema.safeParse(clamped).success).toBe(true);
  });
});
