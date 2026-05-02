import { describe, expect, it } from "vitest";
import { recoverTailoredDraftEmptyFieldsFromMaster } from "../src/modules/ai/tailored-draft-empty-field-recovery";
import { evaluateTailoredDraftSemanticContent } from "../src/modules/ai/tailored-draft-semantic-validation";

describe("recoverTailoredDraftEmptyFieldsFromMaster", () => {
  it("hydrates empty generated block fields from matching master section/block", () => {
    const master = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "experience-1",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-block-1",
              type: "experience_item",
              order: 0,
              visibility: "visible" as const,
              fields: {
                role: "Business Intelligence Intern",
                company: "Vakifbank"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const generated = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "experience-1",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-block-1",
              type: "experience_item",
              order: 0,
              visibility: "visible" as const,
              fields: {},
              meta: {}
            }
          ]
        }
      ]
    };

    const before = evaluateTailoredDraftSemanticContent(generated);
    expect(before.is_valid).toBe(false);

    const recovered = recoverTailoredDraftEmptyFieldsFromMaster(generated, master);
    expect(recovered.hydrated_block_count).toBe(1);
    expect(recovered.content.sections[0]?.blocks[0]?.fields).toEqual({
      role: "Business Intelligence Intern",
      company: "Vakifbank"
    });

    const after = evaluateTailoredDraftSemanticContent(recovered.content);
    expect(after.is_valid).toBe(true);
  });

  it("does not hydrate when master block is also semantically empty", () => {
    const master = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "skills-1",
          type: "skills",
          title: "Skills",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "skills-block-1",
              type: "skills_list",
              order: 0,
              visibility: "visible" as const,
              fields: {},
              meta: {}
            }
          ]
        }
      ]
    };

    const generated = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "skills-1",
          type: "skills",
          title: "Skills",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "skills-block-1",
              type: "skills_list",
              order: 0,
              visibility: "visible" as const,
              fields: {},
              meta: {}
            }
          ]
        }
      ]
    };

    const recovered = recoverTailoredDraftEmptyFieldsFromMaster(generated, master);
    expect(recovered.hydrated_block_count).toBe(0);
  });
});
