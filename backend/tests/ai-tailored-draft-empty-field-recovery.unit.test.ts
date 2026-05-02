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

  it("inserts a new canonical-typed section (e.g. summary) that master lacks", () => {
    const master = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "header-1",
          type: "header",
          title: "Contact",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "header-block-1",
              type: "header",
              order: 0,
              visibility: "visible" as const,
              fields: { full_name: "Alper Camli", email: "alper@example.com" },
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
              id: "exp-1",
              type: "experience",
              order: 0,
              visibility: "visible" as const,
              fields: { role: "BI Intern", company: "Vakifbank" },
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
          id: "summary-1",
          type: "summary",
          title: "Professional Summary",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "summary-block-1",
              type: "summary",
              order: 0,
              visibility: "visible" as const,
              fields: {
                text: "Fresh CS graduate with hands-on Excel modeling and a passion for casual puzzle games."
              },
              meta: {}
            }
          ]
        },
        {
          id: "experience-1",
          type: "experience",
          title: "Experience",
          order: 2,
          meta: {},
          blocks: [
            {
              id: "exp-1",
              type: "experience",
              order: 0,
              visibility: "visible" as const,
              fields: {
                role: "BI Intern",
                company: "Vakifbank",
                description: "Built BI pipelines using Excel and SQL for data-driven reporting."
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const stabilized = stabilizeTailoredDraftFromMaster(generated, master);

    expect(stabilized.inserted_section_count).toBe(1);
    expect(stabilized.content.sections).toHaveLength(3);

    const types = stabilized.content.sections.map((section) => section.type);
    expect(types).toEqual(["header", "summary", "experience"]);

    const orders = stabilized.content.sections.map((section) => section.order);
    expect(orders).toEqual([0, 1, 2]);

    const summarySection = stabilized.content.sections.find((s) => s.type === "summary");
    expect(summarySection?.blocks?.[0]?.fields?.text).toContain("casual puzzle games");

    const experienceSection = stabilized.content.sections.find((s) => s.type === "experience");
    expect(experienceSection?.blocks?.[0]?.fields?.description).toContain("Excel");
  });

  it("does not insert generic-typed sections that master lacks", () => {
    const master = {
      version: "v1" as const,
      language: "en",
      metadata: {},
      sections: [
        {
          id: "header-1",
          type: "header",
          title: "Contact",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "header-block-1",
              type: "header",
              order: 0,
              visibility: "visible" as const,
              fields: { full_name: "Alper Camli" },
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
          id: "section_1",
          type: "section_1",
          title: "Section 1",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "block-1",
              type: "text",
              order: 0,
              visibility: "visible" as const,
              fields: { text: "Some content" },
              meta: {}
            }
          ]
        }
      ]
    };

    const stabilized = stabilizeTailoredDraftFromMaster(generated, master);
    expect(stabilized.inserted_section_count).toBe(0);
    expect(stabilized.content.sections).toHaveLength(1);
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
