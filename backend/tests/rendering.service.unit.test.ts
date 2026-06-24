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

  // Runs the full pipeline (deriveBlock -> presentation mapping) for a section that holds a
  // single block, returning the resulting presentation item. The presentation item is what the
  // export generators consume, so asserting on it proves exports no longer duplicate text.
  const renderSingleBlockItem = async (
    sectionType: string,
    blockType: string,
    fields: Record<string, string>
  ) => {
    const service = createRenderingService();
    const result = await service.buildRendering({
      cv_kind: "master",
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            id: `${sectionType}-1`,
            type: sectionType,
            title: sectionType,
            order: 0,
            blocks: [
              {
                id: `${sectionType}-item-1`,
                type: blockType,
                order: 0,
                visibility: "visible",
                fields,
                meta: {}
              }
            ],
            meta: {}
          }
        ]
      }
    });

    return result.presentation.sections.find((section) => section.type === sectionType)?.items[0];
  };

  it("does not duplicate a project description into the subtitle when the subtitle is empty", async () => {
    const description = "Built a recommendation engine that increased engagement by 30%.";
    const item = await renderSingleBlockItem("projects", "project_item", {
      title: "Recommendation Engine",
      subtitle: "",
      description
    });

    expect(item?.title).toBe("Recommendation Engine");
    expect(item?.subtitle).toBeNull();
    expect(item?.body).toBe(description);
  });

  it("does not duplicate a course institution across title and subtitle when the title is missing", async () => {
    const description = "Completed a six-week course on data structures and algorithms.";
    const item = await renderSingleBlockItem("courses", "course_item", {
      institution: "Coursera",
      description
    });

    expect(item?.title).toBe("Coursera");
    expect(item?.subtitle).toBeNull();
    expect(item?.body).toBe(description);
  });

  it("does not duplicate a volunteer description into the subtitle when the organization is empty", async () => {
    const description = "Mentored five first-year students through their capstone projects.";
    const item = await renderSingleBlockItem("volunteer", "volunteer_item", {
      role: "Student Mentor",
      organization: "",
      description
    });

    expect(item?.title).toBe("Student Mentor");
    expect(item?.subtitle).toBeNull();
    expect(item?.body).toBe(description);
  });

  it("does not duplicate a publication publisher into the subtitle when the title is missing", async () => {
    const description = "A study on transformer attention sparsity across long-context inputs.";
    const item = await renderSingleBlockItem("publications", "publication_item", {
      publisher: "Nature",
      description
    });

    expect(item?.title).toBe("Nature");
    expect(item?.subtitle).toBeNull();
    expect(item?.body).toBe(description);
  });

  it("renders a description-only publication as body text instead of a duplicated title", async () => {
    const description =
      "An extensive write-up of the methodology, the dataset, and the evaluation that the importer captured without a title.";
    const item = await renderSingleBlockItem("publications", "publication_item", {
      description
    });

    expect(item?.title).toBeNull();
    expect(item?.subtitle).toBeNull();
    expect(item?.body).toBe(description);
  });
});
