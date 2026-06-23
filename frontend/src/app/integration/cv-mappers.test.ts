import { describe, expect, it } from "vitest";
import type { CvContent } from "./api-types";
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
