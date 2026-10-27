import { describe, expect, it } from "vitest";
import type { CvBlock, CvContent, CvJsonValue } from "./api-types";
import {
  bulletizeNarrativeFields,
  convertNarrativeLists,
  isNarrativeItemBlock,
  narrativeBulletField,
  normalizeNarrativeLists,
  normalizeNarrativeListsInContent
} from "./narrative-fields";

// Parity with the backend rule: the fixtures and expected outputs below are copied
// verbatim from backend/tests/narrative-fields.unit.test.ts (the rule, converter and
// bulletizer cases; the importer, block_suggest prompt and rendering cases are
// backend-only). If a case here fails, the mirror in narrative-fields.ts has drifted.

const block = (type: string, fields: Record<string, CvJsonValue>, id = `${type}-1`): CvBlock => ({
  id,
  type,
  order: 0,
  visibility: "visible",
  fields,
  meta: {}
});

const field = (sectionType: string, blockType: string, fields: Record<string, CvJsonValue>) =>
  narrativeBulletField(fields, { sectionType, blockType });

describe("shared narrative rule on real block types", () => {
  it("finds the bullet field of narrative items by section and field shape", () => {
    expect(field("experience", "position", { role: "Analyst", description: "• Built reports" })).toBe("description");
    expect(field("experience", "job", { role: "Ops", description: "" })).toBe("description");
    expect(field("experience", "experience_entry", { role: "Ops", company: "Acme" })).toBeNull();
    expect(field("education", "degree", { degree: "BSc", description: "Thesis on graphs." })).toBe("description");
    expect(field("education", "education", { degree: "MSc", summary: "Exchange semester." })).toBe("summary");
    expect(field("projects", "academic_project", { name: "Graph study", details: "Analysed 2 networks" })).toBe("details");
    expect(field("volunteer", "organization_role", { role: "Lead", responsibilities: "Ran events" })).toBe("responsibilities");
    expect(field("awards", "award", { name: "Dean's list", description: "Top 5%" })).toBe("description");
    expect(field("courses", "course", { name: "ML", description: "" })).toBe("description");
    expect(field("publications", "publication", { title: "Paper", notes: "Peer reviewed" })).toBe("notes");
    expect(field("custom_activities", "entry", { title: "Club", description: "Organised meetups" })).toBe("description");
  });

  it("treats certifications as narrative only with a description", () => {
    expect(field("certifications", "certification", { name: "AWS SA", description: "Passed with 900" })).toBe("description");
    expect(field("certifications", "certificate", { name: "AWS SA", description: "" })).toBeNull();
    expect(field("certifications", "text", { name: "AWS SA", issuer: "AWS" })).toBeNull();
  });

  it("never treats summary, skills, languages, interests, header or references as bullet fields", () => {
    expect(field("summary", "text", { text: "Engineer." })).toBeNull();
    expect(field("professional_summary", "paragraph", { description: "Engineer." })).toBeNull();
    expect(field("skills", "skill_group", { skills: ["Go"], description: "Backend" })).toBeNull();
    expect(field("languages", "language", { language: "English", notes: "C1" })).toBeNull();
    expect(field("interests", "interests", { description: "Chess" })).toBeNull();
    expect(field("header", "profile", { full_name: "Ada", description: "x" })).toBeNull();
    expect(field("references", "entry", { name: "Bob", description: "x" })).toBeNull();
    expect(field("experience", "summary", { description: "x" })).toBeNull();
  });

  it("uses the medical module text fields and keeps module bullets arrays out", () => {
    expect(field("medical_qualifications", "medical_qualification", { qualification: "MBBS", notes: "" })).toBe("notes");
    expect(field("career_gap", "career_gap", { explanation: "• Caring for family" })).toBe("explanation");
    expect(field("additional_skills", "additional_skill", { skill: "Audit", context: "" })).toBe("context");
    expect(field("teaching", "teaching_activity", { topic: "ALS", evaluation: "4.8/5" })).toBe("evaluation");
    expect(field("management_leadership", "management_role", { role: "Rota lead", description: ["Ran rota"] })).toBeNull();
    expect(field("clinical_experience", "clinical_post", { job_title: "FY1", duties: ["Ward rounds"] })).toBeNull();
    // A standard block in a module section keeps the standard rule.
    expect(field("medical_qualifications", "experience_item", { role: "Engineer", description: "Built reports" })).toBe("description");
  });

  it("does not offer a text field while the narrative lives only in a list", () => {
    const fields = { role: "Developer", description: "", bullets: ["Shipped 4 features"] };
    expect(isNarrativeItemBlock(fields, { sectionType: "experience", blockType: "entry" })).toBe(false);
    const converted = normalizeNarrativeLists(fields, { sectionType: "experience", blockType: "entry" });
    expect(isNarrativeItemBlock(converted, { sectionType: "experience", blockType: "entry" })).toBe(true);
  });
});

describe("list-kind bullets to text", () => {
  const experience = { sectionType: "experience", blockType: "position" };

  it("turns a list-only block into bullet text and removes the list", () => {
    const result = convertNarrativeLists({ role: "Developer", responsibilities: ["Shipped 4 features", "• Ran code reviews"] }, experience);
    expect(result.conversion).toBe("list_only");
    expect(result.fields).toEqual({ role: "Developer", description: "• Shipped 4 features\n• Ran code reviews" });

    // An array-valued description becomes its own text.
    expect(normalizeNarrativeLists({ name: "Graph study", description: ["Analysed 2 networks", "Wrote report"] }, { sectionType: "projects", blockType: "academic_project" })).toEqual({
      name: "Graph study",
      description: "• Analysed 2 networks\n• Wrote report"
    });
  });

  it("keeps the text and drops a list that duplicates it (as the importer wrote it)", () => {
    const fields = {
      role: "Analyst",
      description: "Prepared weekly sales reports\nAutomated   the KPI dashboard.",
      responsibilities: ["Prepared weekly sales reports", "automated the KPI dashboard"]
    };
    const result = convertNarrativeLists(fields, experience);
    expect(result.conversion).toBe("duplicate_list");
    expect(result.fields).toEqual({ role: "Analyst", description: fields.description });
    // Word-boundary match: "art" is not contained in "start".
    expect(convertNarrativeLists({ description: "Start projects", bullets: ["art"] }, experience).conversion).toBe("list_with_extra_items");
  });

  it("appends list items missing from the text as bullets, never dropping content", () => {
    const result = convertNarrativeLists(
      { description: "• Built ETL pipelines", highlights: ["Built ETL pipelines", "Mentored 2 interns"], achievements: ["Won hackathon"] },
      experience
    );
    expect(result.conversion).toBe("list_with_extra_items");
    expect(result.fields).toEqual({ description: "• Built ETL pipelines\n• Mentored 2 interns\n• Won hackathon" });
    expect(result.appended_items).toEqual(["Mentored 2 interns", "Won hackathon"]);
  });

  it("writes into the block's own narrative field when description is empty", () => {
    expect(normalizeNarrativeLists({ summary: "Exchange semester.", bullets: ["Structures course"] }, { sectionType: "education", blockType: "education" })).toEqual({
      summary: "Exchange semester.\n• Structures course"
    });
  });

  it("is idempotent and leaves text-only blocks untouched", () => {
    const fields = { role: "Developer", bullets: ["Shipped 4 features"] };
    const once = normalizeNarrativeLists(fields, experience);
    expect(normalizeNarrativeLists(once, experience)).toBe(once);
    const textOnly = { role: "Analyst", description: "• Built reports" };
    expect(normalizeNarrativeLists(textOnly, experience)).toBe(textOnly);
    const content: CvContent = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [{ id: "s", type: "experience", title: null, order: 0, meta: {}, blocks: [block("position", textOnly)] }]
    };
    expect(normalizeNarrativeListsInContent(content)).toBe(content);
  });

  it("ignores skills lists, medical bullets arrays, non-narrative sections and non-string lists", () => {
    const skills = { skills: ["Go"], bullets: ["Go"] };
    expect(normalizeNarrativeLists(skills, { sectionType: "skills", blockType: "skill_group" })).toBe(skills);
    const management = { role: "Rota lead", description: ["Ran the rota"] };
    expect(normalizeNarrativeLists(management, { sectionType: "management_leadership", blockType: "management_role" })).toBe(management);
    const post = { job_title: "FY1", duties: ["Ward rounds"], responsibilities: ["Clerking"] };
    expect(normalizeNarrativeLists(post, { sectionType: "clinical_experience", blockType: "clinical_post" })).toEqual({
      job_title: "FY1",
      duties: ["Ward rounds"],
      description: "• Clerking"
    });
    const audit = { title: "Sepsis audit", outcomes: ["Improved compliance"] };
    expect(normalizeNarrativeLists(audit, { sectionType: "audit_qi", blockType: "audit_qi_project" })).toBe(audit);
    const objects = { role: "Dev", bullets: [{ text: "x" }] as unknown as CvJsonValue };
    expect(normalizeNarrativeLists(objects, experience)).toBe(objects);
    const other = { role: "Dev", technologies: ["Go"], relevant_coursework: ["ML"] };
    expect(normalizeNarrativeLists(other, experience)).toBe(other);
  });
});

describe("Improve with AI bulletizer on real block types", () => {
  it("bulletizes multi-line narrative of any narrative block type, by section", () => {
    for (const [sectionType, type] of [
      ["experience", "position"],
      ["experience", "job"],
      ["education", "degree"],
      ["projects", "academic_project"],
      ["volunteer", "organization_role"]
    ]) {
      const result = bulletizeNarrativeFields(block(type, { role: "X", description: "- Built reports\n- Cut costs" }), sectionType);
      expect(result.fields.description, `${sectionType}/${type}`).toBe("• Built reports\n• Cut costs");
    }
    // Medical module field, and a one-paragraph answer stays a paragraph.
    expect(bulletizeNarrativeFields(block("career_gap", { explanation: "1. Caring\n2. Studying" }), "career_gap").fields.explanation).toBe("• Caring\n• Studying");
    const paragraph = block("position", { description: "Built reports for the sales team." });
    expect(bulletizeNarrativeFields(paragraph, "experience")).toBe(paragraph);
  });

  it("leaves summary and skills blocks alone", () => {
    const summary = block("text", { text: "Engineer.\nBuilds APIs." });
    expect(bulletizeNarrativeFields(summary, "summary")).toBe(summary);
    const skills = block("skill_group", { skills: ["Go"], description: "a\nb" });
    expect(bulletizeNarrativeFields(skills, "skills")).toBe(skills);
  });
});
