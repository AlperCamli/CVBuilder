import { describe, expect, it } from "vitest";
import { coerceTailoredDraftOutputPayload } from "../src/modules/ai/tailored-draft-output-coercion";
import { tailoredDraftOutputSchema } from "../src/modules/ai/flows/flow-contracts";

describe("coerceTailoredDraftOutputPayload", () => {
  it("derives section type and fallback block when sections arrive without type/blocks", () => {
    const coerced = coerceTailoredDraftOutputPayload({
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            title: "Work Experience",
            role: "Business Intelligence Intern",
            company: "Vakifbank",
            description: "Built reporting pipelines."
          }
        ]
      },
      generation_summary: "Tailored draft generated.",
      changed_block_ids: []
    });

    const parsed = tailoredDraftOutputSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const sections = parsed.data.current_content.sections ?? [];
      const section = sections[0];
      expect(section?.type).toBe("experience");
      const blocks = section?.blocks ?? [];
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]?.fields).toEqual(
        expect.objectContaining({
          role: "Business Intelligence Intern",
          company: "Vakifbank"
        })
      );
    }
  });

  it("maps section items arrays into blocks when blocks key is missing", () => {
    const coerced = coerceTailoredDraftOutputPayload({
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            section_type: "education",
            items: [
              {
                institution: "Sabanci University",
                degree: "BSc",
                field_of_study: "Computer Science"
              }
            ]
          }
        ]
      },
      generation_summary: "Tailored draft generated.",
      changed_block_ids: []
    });

    const parsed = tailoredDraftOutputSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const sections = parsed.data.current_content.sections ?? [];
      const section = sections[0];
      expect(section?.type).toBe("education");
      const blocks = section?.blocks ?? [];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.fields).toEqual(
        expect.objectContaining({
          institution: "Sabanci University",
          field_of_study: "Computer Science"
        })
      );
    }
  });

  it("keeps existing canonical structured outputs intact", () => {
    const payload = {
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            type: "summary",
            blocks: [
              {
                type: "summary",
                fields: {
                  text: "Data professional with BI experience."
                }
              }
            ]
          }
        ]
      },
      generation_summary: "Tailored draft generated.",
      changed_block_ids: ["summary-1"]
    };

    const coerced = coerceTailoredDraftOutputPayload(payload);
    const parsed = tailoredDraftOutputSchema.safeParse(coerced);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const sections = parsed.data.current_content.sections ?? [];
      expect(sections[0]?.type).toBe("summary");
      expect(sections[0]?.blocks?.[0]?.fields).toEqual({
        text: "Data professional with BI experience."
      });
    }
  });

  it("infers header section type from contact-like field keys", () => {
    const coerced = coerceTailoredDraftOutputPayload({
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            name: "Section 1",
            full_name: "Alper Camli",
            email: "alper@example.com",
            phone: "+90 500 000 0000",
            location: "Istanbul, Turkey",
            github: "github.com/alpercamli"
          }
        ]
      },
      generation_summary: "Tailored draft generated.",
      changed_block_ids: []
    });

    const parsed = tailoredDraftOutputSchema.safeParse(coerced);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const section = parsed.data.current_content.sections?.[0];
      expect(section?.type).toBe("header");
      expect(section?.blocks?.[0]?.fields).toEqual(
        expect.objectContaining({
          full_name: "Alper Camli",
          email: "alper@example.com"
        })
      );
    }
  });
});
