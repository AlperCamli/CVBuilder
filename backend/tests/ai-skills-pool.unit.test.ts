import { describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import { ConflictError } from "../src/shared/errors/app-error";
import type { SessionContext } from "../src/modules/ai/ai.types";
import type { AiRepository } from "../src/modules/ai/ai.repository";
import type { BillingService } from "../src/modules/billing/billing.service";
import type { CvRevisionsService } from "../src/modules/cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";
import {
  collectSkillsPoolContext,
  dedupeSkills,
  extractPoolSkillsFromSuggestedBlock
} from "../src/modules/ai/skills-pool";
import type { MasterCvRecord } from "../src/shared/types/domain";

const NOW = "2026-05-14T10:00:00.000Z";

const session: SessionContext = {
  authUser: {
    auth_user_id: "auth-1",
    email: "user@example.com",
    full_name: "User",
    locale: "en"
  },
  appUser: {
    id: "user-1",
    auth_user_id: "auth-1",
    email: "user@example.com",
    full_name: "User",
    locale: "en",
    default_cv_language: "en",
    onboarding_completed: true,
    created_at: NOW,
    updated_at: NOW
  }
};

const createMasterCvRecord = (skillsMeta: Record<string, unknown> = {}): MasterCvRecord => ({
  id: "master-1",
  user_id: "user-1",
  title: "Master CV",
  language: "en",
  template_id: null,
  summary_text: null,
  source_type: "scratch",
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW,
  current_content: {
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
            visibility: "visible",
            fields: {
              skills: ["TypeScript", "React"]
            },
            meta: skillsMeta
          }
        ]
      },
      {
        id: "experience-section",
        type: "experience",
        title: "Experience",
        order: 1,
        meta: {},
        blocks: [
          {
            id: "exp-1",
            type: "experience_item",
            order: 0,
            visibility: "visible",
            fields: {
              description: "Built resilient Node.js APIs and AWS pipelines."
            },
            meta: {}
          },
          {
            id: "exp-2",
            type: "experience_item",
            order: 1,
            visibility: "visible",
            fields: {
              description: "Optimized PostgreSQL query performance."
            },
            meta: {}
          }
        ]
      },
      {
        id: "education-section",
        type: "education",
        title: "Education",
        order: 2,
        meta: {},
        blocks: [
          {
            id: "edu-1",
            type: "education_item",
            order: 0,
            visibility: "visible",
            fields: {
              institution: "Tech University",
              degree: "BSc",
              field_of_study: "Computer Science",
              description: "Machine learning fundamentals"
            },
            meta: {}
          }
        ]
      }
    ]
  }
});

const makeService = (masterCv: MasterCvRecord, planCode: "free" | "pro") => {
  const createSuggestions = vi.fn().mockImplementation(async (payloads: Array<Record<string, unknown>>) => {
    return payloads.map((payload, index) => ({
      id: `s-${index + 1}`,
      ai_run_id: String(payload.ai_run_id),
      user_id: "user-1",
      master_cv_id: "master-1",
      tailored_cv_id: null,
      block_id: "skills-block",
      action_type: "improve",
      before_content: payload.before_content as Record<string, unknown>,
      suggested_content: payload.suggested_content as Record<string, unknown>,
      option_group_key: null,
      status: "pending",
      applied_at: null,
      created_at: NOW
    }));
  });

  const aiRepository = {
    createSuggestions
  } as unknown as AiRepository;

  const masterCvRepository = {
    findById: vi.fn().mockResolvedValue(masterCv)
  } as unknown as MasterCvRepository;

  const billingService = {
    assertActionAllowed: vi.fn().mockResolvedValue(undefined),
    getCurrentPlanSummary: vi.fn().mockResolvedValue({
      plan_code: planCode
    }),
    recordAiActionUsage: vi.fn().mockResolvedValue(undefined)
  } as unknown as BillingService;

  const service = new AiService(
    aiRepository,
    {
      providerName: "mock",
      resolveModelName: vi.fn().mockReturnValue("mock-model"),
      generate: vi.fn()
    } as unknown as AiProvider,
    masterCvRepository,
    {} as TailoredCvRepository,
    {} as JobsRepository,
    {} as CvRevisionsService,
    {} as TemplatesService,
    {
      resolve: vi.fn()
    } as unknown as AiPromptResolver,
    billingService
  );

  return {
    service,
    createSuggestions,
    billingService
  };
};

describe("skills-pool helpers", () => {
  it("builds context from existing skills + experience descriptions + education", () => {
    const cv = createMasterCvRecord();
    const skillsBlock = cv.current_content.sections[0].blocks[0];
    const context = collectSkillsPoolContext(cv.current_content, skillsBlock);

    expect(context.existing_skills).toEqual(["TypeScript", "React"]);
    expect(context.work_experience).toHaveLength(2);
    expect(context.work_experience[0]?.label).toBe("work experience 1");
    expect(context.education[0]?.institution).toBe("Tech University");
  });

  it("extracts and deduplicates suggested skills", () => {
    const skills = extractPoolSkillsFromSuggestedBlock({
      fields: {
        skills: ["AWS", "aws", "Docker"],
        items: ["Kubernetes"]
      }
    });

    expect(dedupeSkills(skills)).toEqual(["AWS", "Docker", "Kubernetes"]);
  });
});

describe("AiService skills pool refresh rules", () => {
  it("blocks refresh for free users when pool already exists", async () => {
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW
    });
    const { service } = makeService(cv, "free");

    await expect(
      service.suggestBlock(session, {
        master_cv_id: "master-1",
        block_id: "skills-block",
        action_type: "improve"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks real refresh when first shuffle has not been used", async () => {
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_shuffle_used: false
    });
    const { service } = makeService(cv, "pro");

    await expect(
      service.suggestBlock(session, {
        master_cv_id: "master-1",
        block_id: "skills-block",
        action_type: "improve"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("blocks real refresh when daily limit is reached", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_shuffle_used: true,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 2
    });
    const { service } = makeService(cv, "pro");

    await expect(
      service.suggestBlock(session, {
        master_cv_id: "master-1",
        block_id: "skills-block",
        action_type: "improve"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("generates valid pool suggestions and persists metadata", async () => {
    const cv = createMasterCvRecord();
    const { service, createSuggestions, billingService } = makeService(cv, "pro");

    vi.spyOn(service as unknown as { executeFlow: Function }, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-1" },
      output: {
        suggestions: [
          {
            label: "Skills Pool",
            rationale: "Derived from CV context",
            suggested_block: {
              fields: {
                skills: ["TypeScript", "Node.js", "TypeScript", "AWS"]
              }
            }
          }
        ]
      }
    });

    const result = await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    expect(result.suggestions).toHaveLength(1);
    expect(createSuggestions).toHaveBeenCalledTimes(1);
    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    const suggestedContent = payload.suggested_content as Record<string, unknown>;
    const suggestedFields = (suggestedContent.fields as Record<string, unknown>).skills as string[];
    const suggestedMeta = suggestedContent.meta as Record<string, unknown>;
    expect(suggestedFields).toEqual(["TypeScript", "Node.js", "AWS"]);
    expect(Array.isArray(suggestedMeta.skill_pool_items)).toBe(true);
    expect(suggestedMeta.skill_pool_shuffle_used).toBe(false);
    expect((billingService.recordAiActionUsage as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("increments daily refresh counters on real refresh", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_shuffle_used: true,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 1
    });
    const { service, createSuggestions } = makeService(cv, "pro");

    vi.spyOn(service as unknown as { executeFlow: Function }, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-2" },
      output: {
        suggestions: [
          {
            label: "Skills Pool",
            rationale: "Refresh",
            suggested_block: {
              fields: {
                skills: ["Node.js", "Redis", "Kafka"]
              }
            }
          }
        ]
      }
    });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    const suggestedMeta = (payload.suggested_content as Record<string, unknown>).meta as Record<string, unknown>;
    expect(suggestedMeta.skill_pool_shuffle_used).toBe(true);
    expect(suggestedMeta.skill_pool_refresh_count_day).toBe(today);
    expect(suggestedMeta.skill_pool_refresh_count_value).toBe(2);
  });
});
