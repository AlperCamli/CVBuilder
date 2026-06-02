import { describe, expect, it } from "vitest";
import {
  buildTailoredDraftModelContent,
  resolveTailoredDraftModelContent
} from "../src/modules/ai/tailored-draft-model-content";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const masterContent: CvContent = {
  version: "v1",
  language: "en",
  metadata: {
    full_name: "User One",
    email: "user@example.com"
  },
  sections: [
    {
      id: "header-real-id",
      type: "header",
      title: "Header",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "header-block-real-id",
          type: "contact",
          order: 0,
          visibility: "visible",
          fields: {
            full_name: "User One",
            email: "user@example.com"
          },
          meta: {}
        }
      ]
    },
    {
      id: "experience-real-id",
      type: "experience",
      title: "Experience",
      order: 1,
      meta: {
        internal_id: "99d5751f-b90f-4df8-8ff9-50651d7725cc"
      },
      blocks: [
        {
          id: "experience-block-real-id",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          fields: {
            role: "Backend Engineer",
            company: "Acme",
            description: "Built APIs.",
            empty: "",
            owner_id: "99d5751f-b90f-4df8-8ff9-50651d7725cc"
          },
          meta: {
            source: "internal"
          }
        },
        {
          id: "empty-block-real-id",
          type: "experience_item",
          order: 1,
          visibility: "visible",
          fields: {
            description: ""
          },
          meta: {}
        }
      ]
    }
  ]
};

describe("tailored draft model content mapper", () => {
  it("sanitizes master CV content before sending it to the model", () => {
    const context = buildTailoredDraftModelContent(masterContent);

    expect(JSON.stringify(context.model_content)).not.toContain("header-real-id");
    expect(JSON.stringify(context.model_content)).not.toContain("header-block-real-id");
    expect(JSON.stringify(context.model_content)).not.toContain("experience-real-id");
    expect(JSON.stringify(context.model_content)).not.toContain("experience-block-real-id");
    expect(JSON.stringify(context.model_content)).not.toContain("99d5751f-b90f-4df8-8ff9-50651d7725cc");
    expect(JSON.stringify(context.model_content)).not.toContain("user@example.com");

    const sections = context.model_content.sections as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("experience_1_section");
    expect(sections[0]?.meta).toBeUndefined();

    const blocks = sections[0]?.blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("experience_1");
    expect(blocks[0]?.meta).toBeUndefined();
    expect(blocks[0]?.fields).toEqual({
      role: "Backend Engineer",
      company: "Acme",
      description: "Built APIs."
    });
  });

  it("restores real IDs and master header after model output", () => {
    const context = buildTailoredDraftModelContent(masterContent);
    const resolved = resolveTailoredDraftModelContent(
      {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            id: "experience_1_section",
            type: "experience",
            title: "Relevant Experience",
            order: 0,
            meta: {},
            blocks: [
              {
                id: "experience_1",
                type: "experience_item",
                order: 0,
                visibility: "visible",
                fields: {
                  role: "Backend Engineer",
                  company: "Acme",
                  description: "Built APIs for selected backend keywords."
                },
                meta: {}
              },
              {
                id: "experience_new",
                type: "experience_item",
                order: 1,
                visibility: "visible",
                fields: {
                  description: "New truthful project context."
                },
                meta: {}
              }
            ]
          }
        ]
      },
      masterContent,
      context.alias_map
    );

    expect(resolved.metadata).toEqual(masterContent.metadata);
    expect(resolved.sections[0]?.id).toBe("header-real-id");
    expect(resolved.sections[1]?.id).toBe("experience-real-id");
    expect(resolved.sections[1]?.blocks[0]?.id).toBe("experience-block-real-id");
    expect(resolved.sections[1]?.blocks[1]?.id).not.toBe("experience_new");
    expect(context.alias_map.block_alias_to_id.experience_new).toBe(resolved.sections[1]?.blocks[1]?.id);
  });
});

