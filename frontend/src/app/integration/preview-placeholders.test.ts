import { describe, expect, it } from "vitest";
import type { CvContent } from "./api-types";
import { injectPreviewPlaceholders, PLACEHOLDER_SEGMENT_RE } from "./preview-placeholders";

const baseContent = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: { full_name: "", headline: "", email: "ada@example.com", phone: "", location: "" },
  sections: [
    {
      id: "summary-1",
      type: "summary",
      title: "Summary",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "summary-block",
          type: "summary",
          order: 0,
          visibility: "visible",
          fields: { text: "" },
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
          id: "exp-block",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          fields: {
            role: "Engineer",
            company: "",
            location: "",
            start_date: "01/2024",
            end_date: "",
            current_role: false,
            description: ""
          },
          meta: {}
        }
      ]
    },
    {
      id: "education-1",
      type: "education",
      title: "Education",
      order: 2,
      meta: {},
      blocks: []
    }
  ]
});

const isMarked = (value: unknown): boolean =>
  typeof value === "string" && new RegExp(PLACEHOLDER_SEGMENT_RE.source).test(value);

describe("injectPreviewPlaceholders", () => {
  it("fills empty metadata and block fields with marked placeholders, keeping real values", () => {
    const result = injectPreviewPlaceholders(baseContent(), null);

    expect(isMarked(result.metadata.full_name)).toBe(true);
    expect(result.metadata.email).toBe("ada@example.com");

    const experience = result.sections[1].blocks[0];
    expect(experience.fields.role).toBe("Engineer");
    expect(experience.fields.start_date).toBe("01/2024");
    expect(isMarked(experience.fields.company)).toBe(true);
    expect(isMarked(experience.fields.description)).toBe(true);
    expect(experience.fields.current_role).toBe(false);

    expect(isMarked(result.sections[0].blocks[0].fields.text)).toBe(true);
  });

  it("synthesizes a placeholder block for sections without blocks", () => {
    const result = injectPreviewPlaceholders(baseContent(), null);
    const education = result.sections[2];

    expect(education.blocks).toHaveLength(1);
    expect(education.blocks[0].type).toBe("education_item");
    expect(isMarked(education.blocks[0].fields.degree)).toBe(true);
    expect(isMarked(education.blocks[0].fields.institution)).toBe(true);
  });

  it("does not mutate the original content", () => {
    const content = baseContent();
    const before = JSON.stringify(content);
    injectPreviewPlaceholders(content, null);
    expect(JSON.stringify(content)).toBe(before);
  });

  it("uses the medical field schema labels for module-managed sections", () => {
    const content = baseContent();
    content.sections.push({
      id: "clinical-experience-1",
      type: "clinical_experience",
      title: "Clinical Experience",
      order: 3,
      meta: {},
      blocks: [
        {
          id: "post-1",
          type: "clinical_post",
          order: 0,
          visibility: "visible",
          fields: { job_title: "", grade: "", specialty: "", hospital: "", duties: [] },
          meta: {}
        }
      ]
    });

    const result = injectPreviewPlaceholders(content, "medical_uk");
    const post = result.sections[3].blocks[0];

    expect(post.fields.job_title).toBe("⟪Job Title⟫");
    expect(post.fields.grade).toBe("⟪Grade⟫");
    expect(post.fields.duties).toEqual(["⟪Duties & Responsibilities⟫"]);
    // booleans never get text placeholders
    expect(post.fields.is_current).toBeUndefined();
  });

  it("skips hidden sections and hidden blocks", () => {
    const content = baseContent();
    content.sections[0].meta = { visibility: "hidden" };
    content.sections[1].blocks[0].visibility = "hidden";

    const result = injectPreviewPlaceholders(content, null);

    expect(result.sections[0].blocks[0].fields.text).toBe("");
    expect(result.sections[1].blocks[0].fields.company).toBe("");
  });
});
