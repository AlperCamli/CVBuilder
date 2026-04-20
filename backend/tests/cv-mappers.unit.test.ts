import { describe, expect, it } from "vitest";
import { cvContentToEditorSections } from "../../frontend/src/app/integration/cv-mappers";

const visible = "visible" as const;

describe("cv-mappers experience compatibility", () => {
  it("merges legacy experience_items into the previous real experience entry", () => {
    const content = {
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
              id: "exp-1",
              type: "experience",
              order: 0,
              visibility: visible,
              fields: {
                role: "Backend Engineer",
                company: "Acme",
                start_date: "01/2022",
                end_date: "12/2022",
                description: "Built internal APIs"
              },
              meta: {}
            },
            {
              id: "exp-1-items",
              type: "experience_items",
              order: 1,
              visibility: visible,
              fields: {
                items: ["Improved observability", "Reduced incident response time"],
                text: "Improved observability\nReduced incident response time"
              },
              meta: {}
            },
            {
              id: "exp-2",
              type: "experience",
              order: 2,
              visibility: visible,
              fields: {
                role: "Senior Engineer",
                company: "Beta",
                start_date: "01/2023",
                end_date: "Present",
                current_role: true,
                description: "Leading platform team"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const sections = cvContentToEditorSections(content as any);
    const experienceSection = sections.find((section) => section.type === "experience");
    const items = ((experienceSection?.data as any)?.items ?? []) as Array<Record<string, unknown>>;

    expect(items).toHaveLength(2);
    expect(String(items[0]?.role ?? "")).toBe("Backend Engineer");
    expect(String(items[0]?.company ?? "")).toBe("Acme");
    expect(String(items[0]?.description ?? "")).toContain("Built internal APIs");
    expect(String(items[0]?.description ?? "")).toContain("Improved observability");
    expect(String(items[1]?.role ?? "")).toBe("Senior Engineer");
    expect(String(items[1]?.company ?? "")).toBe("Beta");
  });

  it("attaches leading legacy item text to the first real experience block instead of creating a synthetic row", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "experience-2",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-leading-items",
              type: "experience_items",
              order: 0,
              visibility: visible,
              fields: {
                text: "Built reporting dashboards",
                items: ["Built reporting dashboards"]
              },
              meta: {}
            },
            {
              id: "exp-main",
              type: "experience",
              order: 1,
              visibility: visible,
              fields: {
                role: "Data Analyst",
                company: "Gamma",
                start_date: "03/2021",
                end_date: "08/2022",
                description: "Maintained analytics workflows"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const sections = cvContentToEditorSections(content as any);
    const experienceSection = sections.find((section) => section.type === "experience");
    const items = ((experienceSection?.data as any)?.items ?? []) as Array<Record<string, unknown>>;

    expect(items).toHaveLength(1);
    expect(String(items[0]?.role ?? "")).toBe("Data Analyst");
    expect(String(items[0]?.company ?? "")).toBe("Gamma");
    expect(String(items[0]?.description ?? "")).toContain("Built reporting dashboards");
    expect(String(items[0]?.description ?? "")).toContain("Maintained analytics workflows");
  });
});
