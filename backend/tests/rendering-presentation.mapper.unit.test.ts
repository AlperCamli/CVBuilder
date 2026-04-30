import { describe, expect, it } from "vitest";
import type { CvJsonValue } from "../src/shared/cv-content/cv-content.types";
import { mapRenderingPayloadToPresentation } from "../src/modules/rendering/rendering-presentation";
import type { RenderingBlock, RenderingPayload } from "../src/modules/rendering/rendering.types";

const field = (raw: CvJsonValue, text: string, textItems: string[] = []): { raw: CvJsonValue; text: string; text_items: string[] } => ({
  raw,
  text,
  text_items: textItems
});

const block = (input: Partial<RenderingBlock> & { id: string; type: string }): RenderingBlock => ({
  id: input.id,
  type: input.type,
  order: input.order ?? 0,
  visibility: input.visibility ?? "visible",
  fields: input.fields ?? {},
  meta: input.meta ?? {},
  normalized_fields: input.normalized_fields ?? {},
  derived: input.derived ?? {
    headline: null,
    subheadline: null,
    bullets: [],
    date_range: null,
    location: null
  },
  plain_text: input.plain_text ?? ""
});

const renderingPayload = (): RenderingPayload => ({
  version: "v1",
  document: {
    kind: "master",
    id: "master-1",
    title: "My CV",
    language: "en",
    generated_at: "2026-04-30T00:00:00.000Z",
    updated_at: null,
    context: {}
  },
  template: {
    resolution: "selected",
    template: {
      id: "template-1",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: null,
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z"
    }
  },
  sections: [
    {
      id: "summary",
      type: "summary",
      title: "Summary",
      order: 0,
      meta: {},
      plain_text: "Highly motivated student",
      blocks: [
        block({
          id: "summary-1",
          type: "summary",
          normalized_fields: {
            text: field("Highly motivated student", "Highly motivated student", ["Highly motivated student"])
          },
          derived: {
            headline: "Highly motivated student",
            subheadline: null,
            bullets: [],
            date_range: null,
            location: null
          },
          plain_text: "Highly motivated student"
        })
      ]
    },
    {
      id: "experience",
      type: "experience",
      title: "Experience",
      order: 1,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "exp-1",
          type: "experience_item",
          normalized_fields: {
            role: field("Business Intelligence Intern", "Business Intelligence Intern", ["Business Intelligence Intern"]),
            company: field("Vakıfbank", "Vakıfbank", ["Vakıfbank"]),
            start_date: field("07/2025", "07/2025", ["07/2025"]),
            end_date: field("09/2025", "09/2025", ["09/2025"]),
            description: field("Engineered ETL flows", "Engineered ETL flows", ["Engineered ETL flows"])
          },
          derived: {
            headline: "Business Intelligence Intern",
            subheadline: "Vakıfbank",
            bullets: [],
            date_range: "07/2025 - 09/2025",
            location: null
          },
          plain_text: "Business Intelligence Intern Vakıfbank Engineered ETL flows"
        })
      ]
    },
    {
      id: "education",
      type: "education",
      title: "Education",
      order: 2,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "edu-1",
          type: "education_item",
          normalized_fields: {
            degree: field("Bachelor of Science", "Bachelor of Science", ["Bachelor of Science"]),
            institution: field("Sabancı University", "Sabancı University", ["Sabancı University"]),
            start_date: field("02/2022", "02/2022", ["02/2022"]),
            end_date: field("01/2026", "01/2026", ["01/2026"]),
            description: field("Board Member of the Game Developers Club", "Board Member of the Game Developers Club", ["Board Member of the Game Developers Club"])
          },
          derived: {
            headline: "Bachelor of Science",
            subheadline: "Sabancı University",
            bullets: [],
            date_range: "02/2022 - 01/2026",
            location: null
          },
          plain_text: "Bachelor of Science Sabancı University"
        })
      ]
    },
    {
      id: "skills",
      type: "skills",
      title: "Skills",
      order: 3,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "skills-1",
          type: "skills",
          normalized_fields: {
            skills: field(["PostgreSQL", "Spark", "PostgreSQL"], "PostgreSQL Spark PostgreSQL", ["PostgreSQL", "Spark", "PostgreSQL"])
          }
        }),
        block({
          id: "skills-2",
          type: "skills",
          normalized_fields: {
            items: field(["Spark", "Informatica"], "Spark Informatica", ["Spark", "Informatica"])
          }
        })
      ]
    },
    {
      id: "languages",
      type: "languages",
      title: "Languages",
      order: 4,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "lang-1",
          type: "language_item",
          normalized_fields: {
            language: field("Turkish", "Turkish", ["Turkish"]),
            proficiency: field("Native", "Native", ["Native"])
          }
        }),
        block({
          id: "lang-2",
          type: "language_item",
          normalized_fields: {
            text: field("English (Professional), Turkish (Native)", "English (Professional), Turkish (Native)", ["English (Professional), Turkish (Native)"])
          }
        })
      ]
    }
  ],
  plain_text: ""
});

describe("rendering presentation mapper", () => {
  it("maps section titles, deduplicates inline lists, and preserves social/photo metadata", () => {
    const metadata: Record<string, CvJsonValue> = {
      full_name: "Alper Çamlı",
      headline: "Computer Science Student",
      email: "alper@example.com",
      phone: "+90 500 000 00 00",
      location: "Istanbul, Turkey",
      photo: "data:image/png;base64,AAA",
      social_links: [
        {
          id: "link-1",
          type: "github",
          url: "https://github.com/AlperCamli"
        }
      ],
      urls: ["linkedin.com/in/alpercamli"]
    };

    const presentation = mapRenderingPayloadToPresentation(renderingPayload(), metadata, {
      id: "template-1",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: null,
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z"
    });

    expect(presentation.header.name).toBe("Alper Çamlı");
    expect(presentation.header.photo).toBe("data:image/png;base64,AAA");
    expect(presentation.header.social_links).toHaveLength(2);

    expect(presentation.sections[0]?.title).toBe("Professional Summary");
    expect(presentation.sections[1]?.title).toBe("Work Experience");

    const skillsSection = presentation.sections.find((section) => section.type === "skills");
    expect(skillsSection?.inline_text).toBe("PostgreSQL, Spark, Informatica");

    const languagesSection = presentation.sections.find((section) => section.type === "languages");
    expect(languagesSection?.inline_text).toContain("Turkish (Native)");
    expect(languagesSection?.inline_text).toContain("English (Professional)");

    const educationSection = presentation.sections.find((section) => section.type === "education");
    const educationItem = educationSection?.items[0];
    expect(educationItem?.body).toBe("Board Member of the Game Developers Club");
  });
});
