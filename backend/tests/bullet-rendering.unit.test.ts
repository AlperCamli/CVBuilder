import { describe, expect, it } from "vitest";
import { RenderingService } from "../src/modules/rendering/rendering.service";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const createRenderingService = (slug = "modern-clean"): RenderingService => {
  const templatesService = {
    async resolveTemplateForRendering() {
      return {
        resolution: "selected" as const,
        template: {
          id: "template-1",
          name: slug,
          slug,
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

const experienceContent = (description: string): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "experience-1",
      type: "experience",
      title: "Experience",
      order: 0,
      blocks: [
        {
          id: "experience-item-1",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          fields: {
            role: "Data Engineer",
            company: "Acme",
            description
          },
          meta: {}
        }
      ],
      meta: {}
    }
  ]
});

const experienceItem = async (service: RenderingService, description: string) => {
  const result = await service.buildRendering({
    cv_kind: "master",
    current_content: experienceContent(description)
  });
  const section = result.presentation.sections.find((s) => s.type === "experience");
  return section?.items[0];
};

describe("bullet rendering split", () => {
  it("turns a whole-bullet description into bullets with no duplicated body", async () => {
    const item = await experienceItem(createRenderingService(), "• Led migration\n• Cut latency by 40%");
    expect(item?.bullets).toEqual(["Led migration", "Cut latency by 40%"]);
    expect(item?.body).toBeNull();
  });

  it("keeps a lead paragraph as body and the rest as bullets", async () => {
    const item = await experienceItem(createRenderingService(), "Senior role at Acme.\n• Led migration\n• Cut latency");
    expect(item?.body).toBe("Senior role at Acme.");
    expect(item?.bullets).toEqual(["Led migration", "Cut latency"]);
  });

  it("leaves a plain paragraph description as body without bullets", async () => {
    const item = await experienceItem(createRenderingService(), "Owned the data platform and mentored the team.");
    expect(item?.bullets).toEqual([]);
    expect(item?.body).toBe("Owned the data platform and mentored the team.");
  });

  it("does not bulletize a multi-line summary (no marker)", async () => {
    const service = createRenderingService();
    const result = await service.buildRendering({
      cv_kind: "master",
      current_content: {
        version: "v1",
        language: "en",
        metadata: {},
        sections: [
          {
            id: "summary-1",
            type: "summary",
            title: "Summary",
            order: 0,
            blocks: [
              {
                id: "summary-block-1",
                type: "summary",
                order: 0,
                visibility: "visible",
                fields: { text: "First line.\nSecond line." },
                meta: {}
              }
            ],
            meta: {}
          }
        ]
      }
    });
    const summary = result.presentation.sections.find((s) => s.type === "summary");
    expect(summary?.items[0]?.bullets ?? []).toEqual([]);
  });

  it("renders skills inline by default and as bullets for a bulleted-skills template", async () => {
    const skillsContent: CvContent = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "skills-1",
          type: "skills",
          title: "Skills",
          order: 0,
          blocks: [
            {
              id: "skills-block-1",
              type: "skills",
              order: 0,
              visibility: "visible",
              fields: { skills: ["TypeScript", "Python", "SQL"] },
              meta: {}
            }
          ],
          meta: {}
        }
      ]
    };

    const inlineResult = await createRenderingService("modern-clean").buildRendering({
      cv_kind: "master",
      current_content: skillsContent
    });
    const inlineSkills = inlineResult.presentation.sections.find((s) => s.type === "skills");
    expect(inlineSkills?.inline_text).toBe("TypeScript, Python, SQL");
    expect(inlineSkills?.items).toEqual([]);

    const bulletedResult = await createRenderingService("academic-classic").buildRendering({
      cv_kind: "master",
      current_content: skillsContent
    });
    const bulletedSkills = bulletedResult.presentation.sections.find((s) => s.type === "skills");
    expect(bulletedSkills?.inline_text).toBeNull();
    expect(bulletedSkills?.items[0]?.bullets).toEqual(["TypeScript", "Python", "SQL"]);
  });
});
