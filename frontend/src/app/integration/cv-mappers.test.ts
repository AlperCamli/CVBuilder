import { describe, expect, it } from "vitest";
import type { CvBlock, CvContent, CvJsonValue } from "./api-types";
import { cvContentToEditorSections, editorSectionsToCvContent } from "./cv-mappers";

describe("cv module mapper support", () => {
  it("round-trips header photo position metadata", () => {
    const content: CvContent = {
      version: "v1",
      language: "en",
      metadata: {
        full_name: "Ada Lovelace",
        photo_shape: "square",
        photo_position: "right"
      },
      sections: []
    };

    const editorSections = cvContentToEditorSections(content, "standard");
    const header = editorSections.find((section) => section.type === "header");

    expect(header?.data).toMatchObject({
      name: "Ada Lovelace",
      photoShape: "square",
      photoPosition: "right"
    });

    const updatedSections = editorSections.map((section) =>
      section.type === "header"
        ? {
            ...section,
            data: {
              ...(section.data as Record<string, unknown>),
              photoPosition: "center"
            }
          }
        : section
    );

    const roundTripped = editorSectionsToCvContent(updatedSections, "en", content, "standard");

    expect(roundTripped.metadata.photo_position).toBe("center");
    expect(roundTripped.metadata.photo_shape).toBe("square");
  });

  it("defaults invalid or missing photo position metadata to left", () => {
    const invalidContent: CvContent = {
      version: "v1",
      language: "en",
      metadata: {
        photo_position: "bottom"
      },
      sections: []
    };
    const missingContent: CvContent = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: []
    };

    expect(
      cvContentToEditorSections(invalidContent, "standard").find((section) => section.type === "header")
        ?.data.photoPosition
    ).toBe("left");
    expect(
      cvContentToEditorSections(missingContent, "standard").find((section) => section.type === "header")
        ?.data.photoPosition
    ).toBe("left");
  });

  it("round-trips descriptor-driven medical module sections without losing fields or block types", () => {
    const content: CvContent = {
      version: "v1",
      language: "en",
      metadata: {
        full_name: "Dr Ada Lovelace",
        headline: "ST4 Anaesthetics Registrar"
      },
      sections: [
        {
          id: "clinical-skills",
          type: "clinical_skills",
          title: "Clinical Skills & Procedures",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "skill-airway",
              type: "clinical_skill",
              order: 0,
              visibility: "visible",
              fields: {
                skill: "Rapid sequence induction",
                competency_level: "supervised",
                frequency: "Weekly",
                context: "Emergency theatre"
              },
              meta: {
                source: "import"
              }
            }
          ]
        },
        {
          id: "audit",
          type: "audit_qi",
          title: "Clinical Audit & Quality Improvement",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "audit-1",
              type: "audit_qi_project",
              order: 0,
              visibility: "visible",
              fields: {
                title: "WHO checklist compliance",
                project_type: "audit",
                loop_closed: true,
                outcomes: ["Improved sign-out documentation"]
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const editorSections = cvContentToEditorSections(content, "medical_uk");

    expect(editorSections.find((section) => section.type === "clinical_skills")?.data).toMatchObject({
      items: [
        {
          blockId: "skill-airway",
          blockType: "clinical_skill",
          rawFields: {
            skill: "Rapid sequence induction",
            competency_level: "supervised",
            frequency: "Weekly",
            context: "Emergency theatre"
          }
        }
      ]
    });

    const roundTripped = editorSectionsToCvContent(editorSections, "en", undefined, "medical_uk");

    expect(roundTripped.sections).toEqual([
      expect.objectContaining({
        id: "clinical-skills",
        type: "clinical_skills",
        title: "Clinical Skills & Procedures",
        blocks: [
          expect.objectContaining({
            id: "skill-airway",
            type: "clinical_skill",
            fields: expect.objectContaining({
              skill: "Rapid sequence induction",
              competency_level: "supervised",
              frequency: "Weekly",
              context: "Emergency theatre"
            }),
            meta: {
              source: "import"
            }
          })
        ]
      }),
      expect.objectContaining({
        id: "audit",
        type: "audit_qi",
        title: "Clinical Audit & Quality Improvement",
        blocks: [
          expect.objectContaining({
            id: "audit-1",
            type: "audit_qi_project",
            fields: expect.objectContaining({
              title: "WHO checklist compliance",
              project_type: "audit",
              loop_closed: true,
              outcomes: ["Improved sign-out documentation"]
            })
          })
        ]
      })
    ]);
  });
});

const block = (id: string, type: string, fields: Record<string, CvJsonValue>): CvBlock => ({
  id,
  type,
  order: 0,
  visibility: "visible",
  fields,
  meta: {}
});

const cvWith = (...sections: Array<[string, CvBlock[]]>): CvContent => ({
  version: "v1",
  language: "en",
  metadata: { full_name: "Ada Lovelace" },
  sections: sections.map(([type, blocks], order) => ({
    id: `${type}-section`,
    type,
    title: null,
    order,
    meta: {},
    blocks: blocks.map((entry, index) => ({ ...entry, order: index }))
  }))
});

const editorItems = (content: CvContent, sectionType: string, moduleType = "standard") =>
  ((cvContentToEditorSections(content, moduleType).find((section) => section.type === sectionType)?.data
    .items ?? []) as Array<Record<string, unknown>>);

const savedBlocks = (content: CvContent, sectionType: string, moduleType = "standard") =>
  editorSectionsToCvContent(cvContentToEditorSections(content, moduleType), "en", content, moduleType).sections.find(
    (section) => section.type === sectionType
  )?.blocks ?? [];

describe("narrative bullet lists in the editor mapping", () => {
  it("list-only blocks load as bullet lines (not one comma line) and save as text", () => {
    const content = cvWith(
      ["experience", [block("exp-1", "position", { role: "Analyst", company: "Acme", start_date: "2020", bullets: ["Built dashboards, reports", "Cut costs 20%"] })]],
      ["education", [block("edu-1", "degree", { institution: "ITU", degree: "BSc", description: ["Thesis on churn", "Dean's list"] })]],
      ["projects", [block("prj-1", "academic_project", { title: "CV Builder", highlights: ["React", "Vitest"] })]],
      ["volunteer", [block("vol-1", "organization_role", { organization: "Red Cross", role: "Volunteer", start_date: "2019", responsibilities: ["First aid"] })]],
      ["awards", [block("awd-1", "text", { name: "Best paper", achievements: ["Top 1%"] })]],
      ["courses", [block("crs-1", "course", { title: "ML", bullets: ["Regression"] })]],
      ["publications", [block("pub-1", "entry", { title: "Paper", bullets: ["Peer reviewed"] })]],
      ["certifications", [block("crt-1", "certificate", { name: "AWS", bullets: ["Scored 95%"] })]],
      ["leadership", [block("cus-1", "entry", { title: "Chair", bullets: ["Ran 12 meetings"] })]]
    );

    expect(editorItems(content, "experience")[0].description).toBe("• Built dashboards, reports\n• Cut costs 20%");
    expect(editorItems(content, "education")[0].description).toBe("• Thesis on churn\n• Dean's list");
    expect(editorItems(content, "projects")[0].description).toBe("• React\n• Vitest");
    expect(editorItems(content, "volunteer")[0].description).toBe("• First aid");
    expect(editorItems(content, "awards")[0].description).toBe("• Top 1%");
    expect(editorItems(content, "courses")[0].description).toBe("• Regression");
    expect(editorItems(content, "publications")[0].description).toBe("• Peer reviewed");
    expect(editorItems(content, "certifications")[0].description).toBe("• Scored 95%");
    expect(editorItems(content, "leadership")[0].description).toBe("• Ran 12 meetings");

    const saved = editorSectionsToCvContent(cvContentToEditorSections(content, "standard"), "en", content, "standard");
    for (const section of saved.sections) {
      for (const savedBlock of section.blocks) {
        expect(typeof savedBlock.fields.description).toBe("string");
        for (const key of ["bullets", "responsibilities", "highlights", "achievements"]) {
          expect(savedBlock.fields[key]).toBeUndefined();
        }
      }
    }
    expect(saved.sections.find((section) => section.type === "experience")?.blocks[0].type).toBe("position");
  });

  it("text + duplicate list keeps the text and drops the duplicate list on save", () => {
    const description = "• Built dashboards for sales\n• Cut costs by 20%";
    const content = cvWith([
      "experience",
      [block("exp-1", "experience", { role: "Analyst", company: "Acme", start_date: "2020", description, highlights: ["Built dashboards for sales", "Cut costs by 20%"] })]
    ]);
    expect(editorItems(content, "experience")[0].description).toBe(description);
    expect(savedBlocks(content, "experience")[0].fields).toMatchObject({ description });
    expect(savedBlocks(content, "experience")[0].fields.highlights).toBeUndefined();
  });

  it("text + list with extra items keeps the extra bullets instead of deleting them on save", () => {
    const content = cvWith([
      "experience",
      [block("exp-1", "job", { role: "Analyst", company: "Acme", start_date: "2020", description: "• Built dashboards", responsibilities: ["Built dashboards", "Hired 3 analysts"] })]
    ]);
    expect(editorItems(content, "experience")[0].description).toBe("• Built dashboards\n• Hired 3 analysts");
    expect(savedBlocks(content, "experience")[0].fields.description).toBe("• Built dashboards\n• Hired 3 analysts");
  });

  it("round trip: load -> save -> load gives the same text and loses nothing", () => {
    const content = cvWith(
      ["experience", [block("exp-1", "experience_entry", { role: "Analyst", company: "Acme", start_date: "2020", description: "Led analytics.", bullets: ["Built dashboards", "Hired 3 analysts"] })]],
      ["education", [block("edu-1", "education", { institution: "ITU", degree: "BSc", description: ["Thesis", "Honours"] })]],
      ["projects", [block("prj-1", "project", { title: "CV Builder", description: "• React app", highlights: ["React app", "500 users"] })]]
    );

    const firstLoad = cvContentToEditorSections(content, "standard");
    const saved = editorSectionsToCvContent(firstLoad, "en", content, "standard");
    const secondLoad = cvContentToEditorSections(saved, "standard");
    const savedAgain = editorSectionsToCvContent(secondLoad, "en", saved, "standard");

    const descriptions = (sections: ReturnType<typeof cvContentToEditorSections>) =>
      sections
        .filter((section) => Array.isArray(section.data.items))
        .map((section) => (section.data.items as Array<Record<string, unknown>>).map((item) => item.description));

    expect(descriptions(secondLoad)).toEqual(descriptions(firstLoad));
    expect(descriptions(firstLoad)).toEqual([
      ["Led analytics.\n• Built dashboards\n• Hired 3 analysts"],
      ["• Thesis\n• Honours"],
      ["• React app\n• 500 users"]
    ]);
    expect(savedAgain.sections).toEqual(saved.sections);
  });

  it("keeps bullet lines of text-only blocks instead of collapsing them into one line", () => {
    const content = cvWith(
      ["education", [block("edu-1", "text", { text: "BSc Computer Engineering | ITU\n- Thesis on churn\n- Dean's list" })]],
      ["experience", [block("exp-1", "text", { text: "Data Analyst at Acme 2020 - 2022\n- Built dashboards\n- Cut costs 20%" })]]
    );
    expect(editorItems(content, "education")[0].description).toBe(
      "BSc Computer Engineering | ITU\n• Thesis on churn\n• Dean's list"
    );
    expect(editorItems(content, "experience")[0].description).toBe("• Built dashboards\n• Cut costs 20%");
  });

  it("leaves summary and skills alone", () => {
    const content = cvWith(
      ["summary", [block("sum-1", "summary", { text: "One paragraph." })]],
      ["skills", [block("skl-1", "skills", { skills: ["SQL", "Python"] })]]
    );
    const sections = cvContentToEditorSections(content, "standard");
    expect(sections.find((section) => section.type === "summary")?.data.text).toBe("One paragraph.");
    expect(sections.find((section) => section.type === "skills")?.data.skills).toEqual(["SQL", "Python"]);
  });

  it("edits medical list fields as bullet text and saves them back as arrays", () => {
    const content = cvWith([
      "management_leadership",
      [block("mgmt-1", "management_role", { role: "Rota lead", description: ["Wrote the rota", "Chaired meetings"] })]
    ]);
    const sections = cvContentToEditorSections(content, "medical_uk");
    const section = sections.find((entry) => entry.type === "management_leadership")!;
    const item = (section.data.items as Array<Record<string, unknown>>)[0];
    expect((item.rawFields as Record<string, unknown>).description).toEqual(["Wrote the rota", "Chaired meetings"]);

    const edited = sections.map((entry) =>
      entry === section
        ? { ...entry, data: { items: [{ ...item, rawFields: { ...(item.rawFields as object), description: "• Wrote the rota\n• Chaired meetings\n• " } }] } }
        : entry
    );
    const saved = editorSectionsToCvContent(edited, "en", content, "medical_uk");
    expect(saved.sections.find((entry) => entry.type === "management_leadership")?.blocks[0].fields.description).toEqual([
      "Wrote the rota",
      "Chaired meetings"
    ]);
  });
});
