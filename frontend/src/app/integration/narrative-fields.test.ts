import { describe, expect, it } from "vitest";
import type { CvJsonValue } from "./api-types";
import { medicalUkModule } from "../modules/medical-uk.module";
import {
  bulletizeNarrativeFields,
  convertNarrativeLists,
  isNarrativeEditorField,
  isNarrativeItemBlock,
  narrativeBulletField,
  narrativeTextFromValue,
  normalizeNarrativeLists
} from "./narrative-fields";

type Fields = Record<string, CvJsonValue>;

describe("narrativeBulletField", () => {
  it("decides by section type and field shape, never by *_item block types", () => {
    for (const [sectionType, blockType] of [
      ["experience", "experience"],
      ["experience", "position"],
      ["work_experience", "job"],
      ["experience", "experience_entry"],
      ["education", "degree"],
      ["education", "entry"],
      ["projects", "academic_project"],
      ["volunteer", "organization_role"],
      ["awards", "text"],
      ["courses", "course"],
      ["publications", "publication"],
      ["custom_section", "custom_section_item"]
    ]) {
      expect(narrativeBulletField({ description: "• Did X" }, { sectionType, blockType })).toBe("description");
    }
  });

  it("never treats summary, skills, languages, interests or references as bullet fields", () => {
    for (const sectionType of ["summary", "profile", "skills", "technical_skills", "languages", "interests", "references", "header"]) {
      expect(narrativeBulletField({ description: "text", text: "text" }, { sectionType, blockType: "entry" })).toBeNull();
    }
    expect(narrativeBulletField({ description: "text" }, { sectionType: "custom", blockType: "summary" })).toBeNull();
  });

  it("uses the first filled narrative text field", () => {
    expect(narrativeBulletField({ description: "", summary: "• A" }, { sectionType: "experience" })).toBe("summary");
    expect(narrativeBulletField({ notes: "• honours" }, { sectionType: "education" })).toBe("notes");
    expect(narrativeBulletField({ description: "" }, { sectionType: "projects" })).toBe("description");
  });

  it("treats certifications as narrative only with a description", () => {
    expect(narrativeBulletField({ name: "AWS", description: "" }, { sectionType: "certifications" })).toBeNull();
    expect(narrativeBulletField({ name: "AWS", description: "• Scored 95%" }, { sectionType: "certifications" })).toBe("description");
  });

  it("maps medical module text fields by block or section type", () => {
    expect(narrativeBulletField({ notes: "" }, { sectionType: "medical_qualifications", blockType: "medical_qualification" })).toBe("notes");
    expect(narrativeBulletField({ explanation: "x" }, { sectionType: "career_gap" })).toBe("explanation");
    expect(narrativeBulletField({ context: "x" }, { sectionType: "additional_skills" })).toBe("context");
    expect(narrativeBulletField({ evaluation: "x" }, { sectionType: "teaching" })).toBe("evaluation");
    expect(isNarrativeItemBlock({ duties: ["a"] }, { sectionType: "clinical_experience", blockType: "clinical_post" })).toBe(false);
  });
});

describe("isNarrativeEditorField", () => {
  it("matches every medical textarea that the shared rule bullets, and nothing else", () => {
    const bulletTextareas = medicalUkModule.sectionCatalog.flatMap((definition) =>
      definition.fieldSchema
        .filter((field) => field.kind === "textarea")
        .filter((field) => isNarrativeEditorField({ sectionType: definition.type, blockType: definition.blockType }, field.key))
        .map((field) => `${definition.type}.${field.key}`)
    );
    expect(bulletTextareas.sort()).toEqual([
      "additional_skills.context",
      "career_gap.explanation",
      "medical_qualifications.notes",
      "teaching.evaluation"
    ]);
  });

  it("keeps summary and languages notes as plain text", () => {
    expect(isNarrativeEditorField({ sectionType: "summary" }, "text")).toBe(false);
    expect(isNarrativeEditorField({ sectionType: "languages" }, "notes")).toBe(false);
    expect(isNarrativeEditorField({ sectionType: "education" }, "description")).toBe(true);
  });
});

describe("normalizeNarrativeLists", () => {
  const context = { sectionType: "experience", blockType: "position" };

  it("list-only: joins items as bullet lines into description and removes the list", () => {
    for (const key of ["bullets", "responsibilities", "highlights", "achievements", "description"]) {
      const fields: Fields = { role: "Analyst", [key]: ["Built dashboards", "- Cut costs 20%", "  "] };
      const result = convertNarrativeLists(fields, context);
      expect(result.conversion).toBe("list_only");
      expect(result.fields.description).toBe("• Built dashboards\n• Cut costs 20%");
      expect(Object.keys(result.fields).sort()).toEqual(["description", "role"]);
    }
  });

  it("text + duplicate list: keeps the text and drops the list", () => {
    const fields: Fields = {
      description: "• Built Dashboards for sales.\n• Cut costs by 20%",
      highlights: ["built dashboards", "• Cut   costs by 20%"]
    };
    const result = convertNarrativeLists(fields, context);
    expect(result.conversion).toBe("duplicate_list");
    expect(result.fields).toEqual({ description: fields.description });
  });

  it("text + list with extra items: appends only the missing items", () => {
    const fields: Fields = {
      description: "Led the analytics team.\n• Built dashboards",
      responsibilities: ["Built dashboards", "Hired 3 analysts"],
      achievements: ["Won the 2023 award", "hired 3 analysts"]
    };
    const result = convertNarrativeLists(fields, context);
    expect(result.conversion).toBe("list_with_extra_items");
    expect(result.fields).toEqual({
      description: "Led the analytics team.\n• Built dashboards\n• Hired 3 analysts\n• Won the 2023 award"
    });
    expect(result.appended_items).toEqual(["Hired 3 analysts", "Won the 2023 award"]);
  });

  it("appends to the first filled text field (summary) when description is empty", () => {
    const result = normalizeNarrativeLists({ description: "", summary: "• A", bullets: ["B"] }, context);
    expect(result).toEqual({ description: "", summary: "• A\n• B" });
  });

  it("is idempotent and returns the same object when there is nothing to convert", () => {
    const fields: Fields = { description: "x", bullets: ["y"] };
    const once = normalizeNarrativeLists(fields, context);
    const twice = normalizeNarrativeLists(once, context);
    expect(twice).toBe(once);
    const textOnly: Fields = { description: "• a" };
    expect(normalizeNarrativeLists(textOnly, context)).toBe(textOnly);
  });

  it("never drops content: every list item ends up in the text", () => {
    const fields: Fields = { description: "Intro", bullets: ["a1", "b2", "c3"], highlights: ["d4"] };
    const text = String(normalizeNarrativeLists(fields, context).description);
    for (const item of ["Intro", "a1", "b2", "c3", "d4"]) {
      expect(text).toContain(item);
    }
  });

  it("ignores non-narrative arrays (skills, medical list fields, object lists)", () => {
    const skills: Fields = { skills: ["SQL"], bullets: ["x"] };
    expect(normalizeNarrativeLists(skills, { sectionType: "skills", blockType: "skills" })).toBe(skills);
    const duties: Fields = { duties: ["Ward rounds"], description: ["Led audit"] };
    expect(normalizeNarrativeLists(duties, { sectionType: "management_leadership", blockType: "management_role" })).toBe(duties);
    const objects: Fields = { bullets: [{ text: "x" }] };
    expect(normalizeNarrativeLists(objects, context)).toBe(objects);
  });
});

describe("narrativeTextFromValue", () => {
  it("renders lists as bullet lines instead of a comma-joined line", () => {
    expect(narrativeTextFromValue(["One, two", "- Three"])).toBe("• One, two\n• Three");
    expect(narrativeTextFromValue("• kept\nas is")).toBe("• kept\nas is");
    expect(narrativeTextFromValue(null)).toBe("");
  });
});

describe("bulletizeNarrativeFields", () => {
  it("normalizes AI bullet answers for any block type of a narrative section", () => {
    const block = { id: "b", type: "position", order: 0, visibility: "visible" as const, fields: { description: "- A\n- B" }, meta: {} };
    expect(bulletizeNarrativeFields(block, "experience").fields.description).toBe("• A\n• B");
    const summary = { ...block, type: "summary", fields: { text: "- A\n- B" } };
    expect(bulletizeNarrativeFields(summary, "summary")).toBe(summary);
  });
});
