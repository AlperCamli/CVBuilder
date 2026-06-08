import { describe, expect, it } from "vitest";
import { __private } from "../src/modules/imports/parsers/simple-cv-parser";
import { canonicalizeImportedCvContent } from "../src/modules/imports/import-content-canonicalizer";
import type { CvBlock, CvContent } from "../src/shared/cv-content/cv-content.types";

const { toStructuredContent } = __private;

const findExperienceBlock = (content: CvContent): CvBlock | undefined => {
  const section = content.sections.find((s) => s.type === "experience");
  return section?.blocks[0];
};

describe("import bullet preservation", () => {
  it("keeps imported bullet points as • lines in the experience description", () => {
    const text = [
      "Experience",
      "Data Engineer, Acme 2020 - 2023",
      "- Led migration of legacy ETL pipeline",
      "- Cut report latency by 40%",
      "- Mentored 3 junior engineers"
    ].join("\n");

    const content = toStructuredContent(text);
    const block = findExperienceBlock(content);
    const description = typeof block?.fields.description === "string" ? block.fields.description : "";

    expect(description).toContain("• Led migration of legacy ETL pipeline");
    expect(description).toContain("• Cut report latency by 40%");
    expect(description.split("\n").filter((line) => line.startsWith("• ")).length).toBe(3);
  });

  it("leaves a non-bulleted experience description as a flat paragraph", () => {
    const text = [
      "Experience",
      "Data Engineer, Acme 2020 - 2023",
      "Owned the data platform and mentored the team."
    ].join("\n");

    const content = toStructuredContent(text);
    const block = findExperienceBlock(content);
    const description = typeof block?.fields.description === "string" ? block.fields.description : "";

    expect(description).not.toContain("• ");
    expect(description).toContain("Owned the data platform");
  });

  it("canonicalization preserves the bullet markers and newlines in description", () => {
    const content: CvContent = {
      version: "v1",
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
              id: "experience-item-1",
              type: "experience_item",
              order: 0,
              visibility: "visible",
              fields: {
                role: "Data Engineer",
                company: "Acme",
                description: "• Led migration\n• Cut latency"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonical = canonicalizeImportedCvContent(content);
    const block = findExperienceBlock(canonical);
    expect(block?.fields.description).toBe("• Led migration\n• Cut latency");
  });
});
