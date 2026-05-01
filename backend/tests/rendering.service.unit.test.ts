import { describe, expect, it } from "vitest";
import { RenderingService } from "../src/modules/rendering/rendering.service";

const createRenderingService = (): RenderingService => {
  const templatesService = {
    async resolveTemplateForRendering() {
      return {
        resolution: "selected" as const,
        template: {
          id: "template-1",
          name: "Modern Clean",
          slug: "modern-clean",
          status: "active",
          preview_config: null,
          export_config: null,
          created_at: "2026-05-02T00:00:00.000Z",
          updated_at: "2026-05-02T00:00:00.000Z"
        }
      };
    }
  };

  return new RenderingService(templatesService as any);
};

describe("rendering service", () => {
  it("does not include boolean scalar fields in rendered plain text", async () => {
    const service = createRenderingService();

    const result = await service.buildRendering({
      cv_kind: "master",
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            id: "education-1",
            type: "education",
            title: "Education",
            order: 0,
            blocks: [
              {
                id: "education-item-1",
                type: "education_item",
                order: 0,
                visibility: "visible",
                fields: {
                  institution: "Sabancı University",
                  degree: "Computer Science",
                  start_date: "02/2022",
                  end_date: "01/2026",
                  expected_graduation: true,
                  exchange_program: false
                },
                meta: {}
              }
            ],
            meta: {}
          }
        ]
      }
    });

    expect(result.rendering.plain_text.toLowerCase()).not.toContain("true");
    expect(result.rendering.plain_text.toLowerCase()).not.toContain("false");

    const educationSection = result.presentation.sections.find(
      (section) => section.type === "education"
    );
    const educationItem = educationSection?.items[0];
    expect(educationItem?.title).toBe("Computer Science");
    expect(educationItem?.subtitle).toContain("Sabancı University");
  });
});
