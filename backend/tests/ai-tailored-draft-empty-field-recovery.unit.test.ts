import { describe, expect, it } from "vitest";
import {
  recoverTailoredDraftEmptyFieldsFromMaster,
  stabilizeTailoredDraftFromMaster
} from "../src/modules/ai/tailored-draft-empty-field-recovery";
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

  it("preserves master sections/blocks when generated output drops them", () => {
    const master = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "summary-1",
          type: "summary",
          title: "Summary",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "summary-block-1",
              type: "summary",
              order: 0,
              visibility: "visible" as const,
              fields: { text: "Original summary" },
              meta: {}
            }
          ]
        },
        {
          id: "experience-1",
          type: "experience",
          title: "Experience",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "exp-block-1",
              type: "experience_item",
              order: 0,
              visibility: "visible" as const,
              fields: {
                role: "E-commerce Intern",
                company: "Adil Isik Group"
              },
              meta: {}
            },
            {
              id: "exp-block-2",
              type: "experience_item",
              order: 1,
              visibility: "visible" as const,
              fields: {
                role: "Research Assistant",
                company: "Sabanci University"
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

    const stabilized = stabilizeTailoredDraftFromMaster(generated, master);
    expect(stabilized.overlayed_section_count).toBe(1);
    expect(stabilized.overlayed_block_count).toBe(1);
    expect(stabilized.content.sections).toHaveLength(2);
    expect(stabilized.content.sections[1]?.blocks).toHaveLength(2);
    expect(stabilized.content.sections[1]?.blocks[0]?.fields).toEqual({
      role: "Business Intelligence Intern",
      company: "Vakifbank"
    });
    expect(stabilized.content.sections[1]?.blocks[1]?.fields).toEqual({
      role: "Research Assistant",
      company: "Sabanci University"
    });
  });
});
