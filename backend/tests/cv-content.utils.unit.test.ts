import { describe, expect, it } from "vitest";
import { createEmptyCvContent } from "../src/shared/cv-content/cv-content.utils";

describe("createEmptyCvContent", () => {
  it("keeps the standard CV default sections unchanged", () => {
    const content = createEmptyCvContent("en", "standard");

    expect(content.sections.map((section) => section.type)).toEqual([
      "summary",
      "experience",
      "education",
      "skills"
    ]);
  });

  it("creates medical CVs with the core medical sections by default", () => {
    const content = createEmptyCvContent("en", "medical_uk");

    expect(content.sections.map((section) => section.type)).toEqual([
      "medical_registration",
      "medical_qualifications",
      "summary",
      "clinical_experience",
      "clinical_skills",
      "additional_skills",
      "audit_qi",
      "teaching",
      "publications",
      "courses_training",
      "references"
    ]);
    expect(content.sections.find((section) => section.type === "experience")).toBeUndefined();
    expect(content.sections.find((section) => section.type === "education")).toBeUndefined();
    expect(content.sections.find((section) => section.type === "skills")).toBeUndefined();
  });
});
