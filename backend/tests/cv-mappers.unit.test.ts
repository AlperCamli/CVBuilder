import { describe, expect, it } from "vitest";
import {
  cvContentToEditorSections,
  editorSectionsToCvContent
} from "../../frontend/src/app/integration/cv-mappers";

const visible = "visible" as const;

describe("cv-mappers experience compatibility", () => {
  it("round-trips header photo position metadata", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {
        full_name: "Ada Lovelace",
        photo_shape: "square",
        photo_position: "right"
      },
      sections: []
    };

    const sections = cvContentToEditorSections(content as any);
    const header = sections.find((section) => section.type === "header");

    expect((header?.data as any)?.name).toBe("Ada Lovelace");
    expect((header?.data as any)?.photoShape).toBe("square");
    expect((header?.data as any)?.photoPosition).toBe("right");

    const updatedSections = sections.map((section) =>
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

    const restored = editorSectionsToCvContent(updatedSections, "en", content as any);

    expect(restored.metadata.photo_position).toBe("center");
    expect(restored.metadata.photo_shape).toBe("square");
  });

  it("defaults invalid or missing photo position metadata to left", () => {
    const invalidSections = cvContentToEditorSections({
      version: "v1",
      language: "en",
      metadata: {
        photo_position: "bottom"
      },
      sections: []
    } as any);
    const missingSections = cvContentToEditorSections({
      version: "v1",
      language: "en",
      metadata: {},
      sections: []
    } as any);

    expect((invalidSections.find((section) => section.type === "header")?.data as any)?.photoPosition).toBe(
      "left"
    );
    expect((missingSections.find((section) => section.type === "header")?.data as any)?.photoPosition).toBe(
      "left"
    );
  });

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

  it("does not append duplicate legacy description text", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "experience-3",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-main",
              type: "experience",
              order: 0,
              visibility: visible,
              fields: {
                role: "Data Analyst",
                company: "Gamma",
                description: "Built reporting dashboards"
              },
              meta: {}
            },
            {
              id: "exp-items",
              type: "experience_items",
              order: 1,
              visibility: visible,
              fields: {
                items: ["Built reporting dashboards"]
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

    expect(String(items[0]?.description ?? "")).toBe("Built reporting dashboards");
  });

  it("round-trips skills pool metadata through editor mapping", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "skills-section",
          type: "skills",
          title: "Skills",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "skills-block",
              type: "skills",
              order: 0,
              visibility: visible,
              fields: {
                skills: ["TypeScript", "React"]
              },
              meta: {
                skill_pool_items: ["Node.js", "AWS"],
                skill_pool_last_generated_at: "2026-05-14T10:00:00.000Z",
                skill_pool_refresh_count_day: "2026-05-14",
                skill_pool_refresh_count_value: 1,
                skill_pool_shuffle_used: true
              }
            }
          ]
        }
      ]
    };

    const sections = cvContentToEditorSections(content as any);
    const skillsSection = sections.find((section) => section.type === "skills");
    expect((skillsSection?.data as any)?.skillPoolItems).toEqual(["Node.js", "AWS"]);
    expect((skillsSection?.data as any)?.skillPoolShuffleUsed).toBe(true);

    const restored = editorSectionsToCvContent(sections, "en");
    const restoredMeta = restored.sections[0]?.blocks[0]?.meta as Record<string, unknown>;
    expect(restoredMeta.skill_pool_items).toEqual(["Node.js", "AWS"]);
    expect(restoredMeta.skill_pool_shuffle_used).toBe(true);
  });

  it("splits a single delimited skills value for editor rendering", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "skills-section",
          type: "skills",
          title: "Skills",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "skills-block",
              type: "skills",
              order: 0,
              visibility: visible,
              fields: {
                skills: ["TypeScript, React; Node.js\nPostgreSQL"]
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const sections = cvContentToEditorSections(content as any);
    const skillsSection = sections.find((section) => section.type === "skills");

    expect((skillsSection?.data as any)?.skills).toEqual([
      "TypeScript",
      "React",
      "Node.js",
      "PostgreSQL"
    ]);
  });

  it("does not duplicate volunteer descriptions when organization is blank", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "volunteer-section",
          type: "volunteer",
          title: "Volunteer Work",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "volunteer-block",
              type: "volunteer_item",
              order: 0,
              visibility: visible,
              fields: {
                organization: "",
                role: "Volunteer",
                description: "Organized community events",
                text: "Organized community events"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const sections = cvContentToEditorSections(content as any);
    const volunteerSection = sections.find((section) => section.type === "volunteer");
    const items = ((volunteerSection?.data as any)?.items ?? []) as Array<Record<string, unknown>>;

    expect(items[0]?.organization).toBe("");
    expect(items[0]?.description).toBe("Organized community events");
  });

  it("preserves bullet-list newlines in experience descriptions through a full round trip", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "experience-section",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-block",
              type: "experience_item",
              order: 0,
              visibility: visible,
              fields: {
                role: "Data Engineer",
                company: "Acme",
                description: "• Led migration\n• Cut latency by 40%"
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

    // Load path must not collapse "\n" into " ".
    expect(items[0]?.description).toBe("• Led migration\n• Cut latency by 40%");

    // ...and the write path keeps it verbatim.
    const roundTripped = editorSectionsToCvContent(sections, "en");
    const block = roundTripped.sections.find((section) => section.type === "experience")?.blocks[0];
    expect(block?.fields.description).toBe("• Led migration\n• Cut latency by 40%");
  });
});
