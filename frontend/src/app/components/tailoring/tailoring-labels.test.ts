import { describe, expect, it } from "vitest";
import type { CvBlock, CvContent, CvSection } from "../../integration/api-types";
import { describeBlock, listRefinableBlocks, refinableBlockKind, rewriteDisplay } from "./tailoring-labels";

const block = (id: string, type: string, fields: CvBlock["fields"], patch: Partial<CvBlock> = {}): CvBlock => ({
  id,
  type,
  order: 0,
  visibility: "visible",
  meta: {},
  fields,
  ...patch
});

const section = (id: string, type: string, blocks: CvBlock[], order: number, patch: Partial<CvSection> = {}): CvSection => ({
  id,
  type,
  title: null,
  order,
  meta: {},
  blocks: blocks.map((item, index) => ({ ...item, order: index })),
  ...patch
});

const cv = (sections: CvSection[]): CvContent => ({ version: "v1", language: "en", metadata: {}, sections });

describe("editable CV blocks for Refine with AI", () => {
  it("classifies real block types by section type and fields", () => {
    const content = cv([
      section("h", "header", [block("h1", "header", { full_name: "Deniz", headline: "Analyst" })], 0),
      section("s", "summary", [block("s1", "text", { text: "Data analyst." })], 1),
      section("e", "work_experience", [
        block("e1", "position", { position: "Data Analyst", company: "Acme", start_date: "2023-01", description: "• Built reports" }),
        block("e2", "job", { title: "Intern", employer: "Beta", end_date: "2022" }),
        block("e3", "experience_entry", { role: "Analyst", organization: "Gamma", description: "" }),
        block("e4", "entry", { start_date: "2020", end_date: "2021" }),
        block("e5", "work", { role: "Hidden", description: "x" }, { visibility: "hidden" })
      ], 2),
      section("ed", "education", [block("ed1", "degree", { degree: "BSc", field_of_study: "Business", institution: "Example University", start_date: "2019" })], 3),
      section("p", "project", [block("p1", "project", { name: "Sales dashboard", description: "Built it" })], 4),
      section("v", "volunteering", [block("v1", "volunteer", { role: "Mentor", organization: "Code Club", description: "Taught" })], 5),
      section("sk", "skills", [block("sk1", "skills", { skills: ["SQL"] })], 6),
      section("l", "languages", [block("l1", "language", { language: "English", description: "Fluent" })], 7),
      section("r", "references", [block("r1", "reference", { name: "Ref", description: "x" })], 8),
      section("legacy", "experience", [block("x1", "experience_items", { items: ["a", "b"] })], 9)
    ]);

    expect(listRefinableBlocks(content).map((item) => [item.blockId, item.kind, item.title, item.subtitle])).toEqual([
      ["s1", "summary", "Professional summary", ""],
      ["e1", "item", "Data Analyst", "Acme"],
      ["e2", "item", "Intern", "Beta"],
      ["e3", "item", "Analyst", "Gamma"],
      ["ed1", "item", "BSc, Business", "Example University"],
      ["p1", "item", "Sales dashboard", ""],
      ["v1", "item", "Mentor", "Code Club"],
      ["sk1", "skills", "Skills", ""]
    ]);
  });

  it("uses block types when the section type is unknown, and never titles a block with dates", () => {
    const content = cv([
      section("c", "my_section", [
        block("c1", "experience_item", { company: "Acme", start_date: "2020", description: "• Did things" }),
        block("c2", "custom", { text: "Chess" })
      ], 0)
    ]);
    const blocks = listRefinableBlocks(content);
    expect(blocks.map((item) => [item.blockId, item.title, item.subtitle])).toEqual([["c1", "Acme", ""]]);
    expect(describeBlock(content, "c1")).toBe("Acme");
  });

  it("leaves out hidden sections and describes blocks for labels", () => {
    const content = cv([
      section("e", "experience", [block("e1", "experience", { role: "Engineer", company: "Acme", description: "x" })], 0, {
        meta: { visibility: "hidden" }
      }),
      section("s", "profile", [block("s1", "summary", { text: "Hi" })], 1)
    ]);
    expect(listRefinableBlocks(content).map((item) => item.blockId)).toEqual(["s1"]);
    expect(describeBlock(content, "e1")).toBe("Engineer · Acme");
    expect(describeBlock(content, "s1")).toBe("Professional summary");
  });

  it("shows rewrite cards as a paragraph for the summary and bullets for items, whatever the field", () => {
    const content = cv([
      section("s", "professional_summary", [block("s1", "profile", { summary: "Data analyst." })], 0),
      section("e", "experience", [block("e1", "job", { title: "Analyst", highlights: "• Built reports" })], 1),
      section("sk", "skills", [block("sk1", "skill_list", { items: ["SQL"] })], 2)
    ]);
    expect(refinableBlockKind(content, "s1")).toBe("summary");
    expect(refinableBlockKind(content, "e1")).toBe("item");
    expect(refinableBlockKind(content, "sk1")).toBe("skills");
    expect(refinableBlockKind(content, "missing")).toBeNull();
    expect(rewriteDisplay(content, { block_id: "s1", suggested: { field: "summary" } })).toBe("paragraph");
    expect(rewriteDisplay(content, { block_id: "e1", suggested: { field: "highlights" } })).toBe("bullets");
    expect(rewriteDisplay(content, { block_id: "e1", suggested: { field: "text" } })).toBe("bullets");
    // A block that is gone falls back to the field name.
    expect(rewriteDisplay(content, { block_id: "gone", suggested: { field: "text" } })).toBe("paragraph");
    expect(rewriteDisplay(content, { block_id: "gone", suggested: { field: "responsibilities" } })).toBe("bullets");
  });
});
