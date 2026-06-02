import { describe, expect, it } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import type { AiRepository } from "../src/modules/ai/ai.repository";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository";
import type { CvRevisionsService } from "../src/modules/cv-revisions/cv-revisions.service";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import type { BillingService } from "../src/modules/billing/billing.service";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const makeService = () =>
  new AiService(
    {} as AiRepository,
    {} as AiProvider,
    {} as MasterCvRepository,
    {} as TailoredCvRepository,
    {} as JobsRepository,
    {} as CvRevisionsService,
    {} as TemplatesService,
    {} as AiPromptResolver,
    {} as BillingService
  ) as unknown as {
    ensureTailoredSkillsSection: (
      content: CvContent,
      selectedKeywords: string[],
      selectedTopics: string[]
    ) => { content: CvContent; changed_block_ids: string[] };
  };

const contentWithoutSkills: CvContent = {
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "summary-section",
      type: "summary",
      title: "Summary",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "summary-block",
          type: "summary",
          order: 0,
          visibility: "visible",
          fields: {
            text: "Product analyst with dashboard experience."
          },
          meta: {}
        }
      ]
    }
  ]
};

describe("tailored draft skills section post-processing", () => {
  it("adds a skills section when selected skills exist and the CV has no skills section", () => {
    const result = makeService().ensureTailoredSkillsSection(
      contentWithoutSkills,
      ["SQL", "Product Analytics", "SQL"],
      ["Stakeholder Management", "This is too long to be treated as a concise skill sentence."]
    );

    const skillsSection = result.content.sections.find((section) => section.type === "skills");
    expect(skillsSection).toBeDefined();
    expect(result.changed_block_ids).toHaveLength(1);
    expect(skillsSection?.blocks[0]?.fields.skills).toEqual([
      "SQL",
      "Product Analytics",
      "Stakeholder Management"
    ]);
  });

  it("merges selected skills into an existing skills block without duplicates", () => {
    const content: CvContent = {
      ...contentWithoutSkills,
      sections: [
        ...contentWithoutSkills.sections,
        {
          id: "skills-section",
          type: "skills",
          title: "Skills",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "skills-block",
              type: "skills",
              order: 0,
              visibility: "visible",
              fields: {
                skills: ["SQL", "Tableau"]
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const result = makeService().ensureTailoredSkillsSection(content, ["SQL", "Python"], []);
    const skills = result.content.sections.find((section) => section.type === "skills")?.blocks[0]
      ?.fields.skills;

    expect(result.changed_block_ids).toEqual(["skills-block"]);
    expect(skills).toEqual(["SQL", "Tableau", "Python"]);
  });
});
