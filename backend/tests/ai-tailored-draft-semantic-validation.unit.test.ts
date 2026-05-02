import { describe, expect, it } from "vitest";
import { evaluateTailoredDraftSemanticContent } from "../src/modules/ai/tailored-draft-semantic-validation";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const baseContent: CvContent = {
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "summary-section",
      type: "summary",
      title: "Summary",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "summary-1",
          type: "summary",
          order: 0,
          visibility: "visible",
          fields: {
            text: ""
          },
          meta: {}
        }
      ]
    }
  ]
};

describe("evaluateTailoredDraftSemanticContent", () => {
  it("flags outputs without meaningful visible fields as semantically empty", () => {
    const content: CvContent = {
      ...baseContent,
      sections: [
        {
          ...baseContent.sections[0],
          blocks: [
            {
              ...baseContent.sections[0]!.blocks[0]!,
              fields: {
                text: "   ",
                expected_graduation: false,
                exchange_program: false,
                score: null
              }
            }
          ]
        }
      ]
    };

    const result = evaluateTailoredDraftSemanticContent(content);
    expect(result.is_valid).toBe(false);
    expect(result.stats.meaningful_block_count).toBe(0);
    expect(result.stats.visible_block_count).toBe(1);
  });

  it("treats at least one visible block with meaningful text/number as valid", () => {
    const content: CvContent = {
      ...baseContent,
      sections: [
        {
          ...baseContent.sections[0],
          blocks: [
            {
              ...baseContent.sections[0]!.blocks[0]!,
              fields: {
                text: "Impact-focused summary"
              }
            },
            {
              id: "hidden-block",
              type: "summary",
              order: 1,
              visibility: "hidden",
              fields: {
                text: "Hidden content"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const result = evaluateTailoredDraftSemanticContent(content);
    expect(result.is_valid).toBe(true);
    expect(result.stats.block_count).toBe(2);
    expect(result.stats.visible_block_count).toBe(1);
    expect(result.stats.meaningful_block_count).toBe(1);
  });
});
