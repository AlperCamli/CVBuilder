import { describe, expect, it } from "vitest";
import { collectSummaryProfileContext, isSummaryBlock } from "../src/modules/ai/summary-context";
import type { CvBlock, CvContent, CvSection } from "../src/shared/cv-content/cv-content.types";

const block = (id: string, type: string, fields: CvBlock["fields"], extra: Partial<CvBlock> = {}): CvBlock => ({
  id, type, order: 0, visibility: "visible", fields, meta: {}, ...extra
});

const section = (id: string, type: string, order: number, blocks: CvBlock[], extra: Partial<CvSection> = {}): CvSection => ({
  id, type, title: null, order, meta: {}, blocks, ...extra
});

const content = (sections: CvSection[], metadata: CvContent["metadata"] = {}): CvContent => ({
  version: "v1", language: "en", metadata, sections
});

describe("collectSummaryProfileContext", () => {
  it("collects the other visible sections and leaves out the summary, header, references and contacts", () => {
    const cv = content(
      [
        section("header", "header", 0, [block("h", "header", { full_name: "Ada", email: "ada@example.com" })]),
        section("summary", "summary", 1, [block("summary-block", "summary", { text: "Engineer." })]),
        section("exp", "experience", 2, [
          block("e1", "experience_item", {
            role: "Lead Engineer", company: "Acme", start_date: "2020", current_role: true, is_remote: false,
            responsibilities: ["Led a team of 6", "Migrated billing to AWS"], company_url: "https://acme.test", description: ""
          }),
          block("e2", "experience_item", { role: "Hidden role", company: "Secret" }, { visibility: "hidden" })
        ], { title: "Work Experience" }),
        section("skills", "skills", 3, [block("s", "skills", { skills: ["TypeScript", "AWS"] }, { meta: { skill_pool_items: ["Go"] } })]),
        section("refs", "references", 4, [block("r", "reference", { name: "Bob", phone: "123" })]),
        section("hidden", "projects", 5, [block("p", "project", { title: "Side project" })], { meta: { visibility: "hidden" } })
      ],
      { full_name: "Ada", headline: "Senior Software Engineer" }
    );

    expect(collectSummaryProfileContext(cv, "summary-block")).toEqual({
      headline: "Senior Software Engineer",
      sections: [
        {
          section: "Work Experience",
          entries: [{
            role: "Lead Engineer", company: "Acme", start_date: "2020", current_role: true,
            description: "• Led a team of 6\n• Migrated billing to AWS"
          }]
        },
        { section: "skills", entries: [{ skills: ["TypeScript", "AWS"] }] }
      ]
    });
  });

  it("includes module sections such as medical clinical experience", () => {
    const cv = content([
      section("summary", "summary", 0, [block("summary-block", "summary", { text: "" })]),
      section("clinical", "clinical_experience", 1, [
        block("c1", "clinical_post", { grade: "FY2", specialty: "Cardiology", hospital: "St Thomas'", duties: ["Ward rounds"] })
      ])
    ]);

    expect(collectSummaryProfileContext(cv, "summary-block").sections).toEqual([
      { section: "clinical_experience", entries: [{ grade: "FY2", specialty: "Cardiology", hospital: "St Thomas'", duties: ["Ward rounds"] }] }
    ]);
  });

  it("caps long text, entry counts and the overall size", () => {
    const longText = "x".repeat(5000);
    const many = Array.from({ length: 40 }, (_, index) =>
      block(`e${index}`, "experience_item", { role: `Role ${index}`, description: longText }, { order: index })
    );
    const context = collectSummaryProfileContext(
      content([section("summary", "summary", 0, [block("summary-block", "summary", { text: "" })]), section("exp", "experience", 1, many)]),
      "summary-block"
    );

    const entries = context.sections[0]!.entries;
    expect(entries.length).toBeLessThanOrEqual(15);
    expect(String(entries[0]!.description).length).toBeLessThanOrEqual(1001);
    expect(JSON.stringify(context).length).toBeLessThan(14000);
  });

  it("returns no sections for a CV that only has a summary", () => {
    const cv = content([section("summary", "summary", 0, [block("summary-block", "summary", { text: "" })])]);
    expect(collectSummaryProfileContext(cv, "summary-block")).toEqual({ sections: [] });
  });
});

describe("isSummaryBlock", () => {
  it("matches summary-like sections and summary blocks", () => {
    expect(isSummaryBlock({ type: "text" }, "Professional Summary")).toBe(true);
    expect(isSummaryBlock({ type: "summary" }, "custom")).toBe(true);
    expect(isSummaryBlock({ type: "experience_item" }, "experience")).toBe(false);
  });
});
