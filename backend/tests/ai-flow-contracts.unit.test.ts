import { describe, expect, it } from "vitest";
import {
  importImproveOutputSchema,
  tailoredDraftOutputSchema
} from "../src/modules/ai/flows/flow-contracts";

const validCvContent = {
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "summary",
      type: "summary",
      order: 0,
      blocks: [
        {
          id: "summary-1",
          type: "text",
          order: 0,
          fields: {
            text: "Senior software engineer."
          }
        }
      ]
    }
  ]
};

describe("AI flow output contracts", () => {
  it("requires structured CV content for tailored_draft outputs", () => {
    const parsed = tailoredDraftOutputSchema.safeParse({
      current_content: "invalid",
      generation_summary: "Generated draft.",
      changed_block_ids: ["summary-1"]
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts valid tailored_draft outputs", () => {
    const parsed = tailoredDraftOutputSchema.safeParse({
      current_content: validCvContent,
      generation_summary: "Generated draft.",
      changed_block_ids: ["summary-1"]
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects tailored_draft output when sections are missing", () => {
    const parsed = tailoredDraftOutputSchema.safeParse({
      current_content: {
        version: "v1",
        language: "en",
        metadata: {}
      },
      generation_summary: "Generated draft.",
      changed_block_ids: ["summary-1"]
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects tailored_draft output when blocks are missing required fields", () => {
    const parsed = tailoredDraftOutputSchema.safeParse({
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            type: "summary",
            blocks: [
              {
                type: "summary"
              }
            ]
          }
        ]
      },
      generation_summary: "Generated draft.",
      changed_block_ids: ["summary-1"]
    });

    expect(parsed.success).toBe(false);
  });

  it("requires structured CV content for import_improve outputs", () => {
    const parsed = importImproveOutputSchema.safeParse({
      improved_content: 123,
      generation_summary: "Improved imported CV.",
      changed_block_ids: ["summary-1"]
    });

    expect(parsed.success).toBe(false);
  });
});
