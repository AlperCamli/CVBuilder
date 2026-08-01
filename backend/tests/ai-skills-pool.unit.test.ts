import { describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import { AiFlowFailedError, ConflictError } from "../src/shared/errors/app-error";
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
import type { CvJsonValue } from "../src/shared/cv-content/cv-content.types";
import type { MasterCvRecord } from "../src/shared/types/domain";

const NOW = "2026-05-14T10:00:00.000Z";

type ExecuteFlowHost = {
  executeFlow: (input: Record<string, unknown>) => Promise<{
    ai_run: { id: string };
    output: Record<string, unknown>;
  }>;
};

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
    onboarding_state: {},
    created_at: NOW,
    updated_at: NOW
  }
};

const createMasterCvRecord = (skillsMeta: Record<string, CvJsonValue> = {}): MasterCvRecord => ({
  id: "master-1",
  user_id: "user-1",
  title: "Master CV",
  language: "en",
  template_id: null,
  module_type: "standard",
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
      status: payload.status ?? "pending",
      applied_at: payload.applied_at ?? null,
      created_at: NOW
    }));
  });

  const aiRepository = {
    createSuggestions
  } as unknown as AiRepository;

  const masterCvRepository = {
    findById: vi.fn().mockResolvedValue(masterCv),
    updateById: vi.fn().mockImplementation(async (_userId, _masterCvId, patch) => ({
      ...masterCv,
      ...patch,
      updated_at: NOW
    }))
  } as unknown as MasterCvRepository;

  const cvRevisionsService = {
    createMasterBlockRevision: vi.fn().mockResolvedValue({})
  } as unknown as CvRevisionsService;

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
    cvRevisionsService,
    {} as TemplatesService,
    {
      resolve: vi.fn()
    } as unknown as AiPromptResolver,
    billingService
  );

  return {
    service,
    createSuggestions,
    cvRevisionsService,
    billingService
  };
};

describe("skills-pool helpers", () => {
  it("builds context from existing skills + experience descriptions + education", () => {
    const cv = createMasterCvRecord();
    const skillsBlock = cv.current_content.sections[0].blocks[0];
    const context = collectSkillsPoolContext(cv.current_content, skillsBlock);

    expect(context.existing_skills).toEqual(["TypeScript", "React"]);
    expect(context.current_pool).toEqual([]);
    expect(context.summary).toBe("");
    expect(context.work_experience).toHaveLength(2);
    expect(context.work_experience[0]?.label).toBe("work experience 1");
    expect(context.education[0]?.institution).toBe("Tech University");
  });

  it("collects variant section types, projects, and summary into the context", () => {
    const content = {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "summary-section",
          type: "professional_summary",
          title: "Summary",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "summary-block",
              type: "summary",
              order: 0,
              visibility: "visible" as const,
              fields: { text: "Full-stack engineer focused on data platforms." },
              meta: {}
            }
          ]
        },
        {
          id: "exp-section",
          type: "Work Experience",
          title: "Experience",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "exp-1",
              type: "experience_item",
              order: 0,
              visibility: "visible" as const,
              fields: {
                role: "Data Engineer",
                company: "Acme",
                text: "Built streaming pipelines.",
                bullets: ["Cut latency by 40%"]
              },
              meta: {}
            }
          ]
        },
        {
          id: "projects-section",
          type: "projects",
          title: "Projects",
          order: 2,
          meta: {},
          blocks: [
            {
              id: "project-1",
              type: "project_item",
              order: 0,
              visibility: "visible" as const,
              fields: { description: "CV builder with AI tailoring." },
              meta: {}
            }
          ]
        }
      ]
    };
    const skillsBlock = {
      id: "skills-block",
      type: "skills",
      order: 0,
      visibility: "visible" as const,
      fields: { skills: ["SQL"] },
      meta: {}
    };

    const context = collectSkillsPoolContext(content as never, skillsBlock as never);

    expect(context.summary).toBe("Full-stack engineer focused on data platforms.");
    expect(context.work_experience).toHaveLength(2);
    expect(context.work_experience[0]?.description).toContain("Data Engineer at Acme");
    expect(context.work_experience[0]?.description).toContain("Built streaming pipelines.");
    expect(context.work_experience[0]?.description).toContain("Cut latency by 40%");
    expect(context.work_experience[1]?.label).toBe("project 1");
    expect(context.work_experience[1]?.description).toBe("CV builder with AI tailoring.");
  });

  it("includes the current pool in the context so providers can avoid repeating it", () => {
    const cv = createMasterCvRecord();
    const skillsBlock = cv.current_content.sections[0].blocks[0];
    const context = collectSkillsPoolContext(cv.current_content, skillsBlock, ["Node.js", "node.js", "AWS"]);

    expect(context.current_pool).toEqual(["Node.js", "AWS"]);
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

  it("extracts skills returned flat on the suggested_block root (no fields wrapper)", () => {
    // Regression: OpenAI's structured-output fallback returned this exact shape and the
    // parser dropped all 20 valid skills, surfacing a bogus "no new skills" error.
    const skills = extractPoolSkillsFromSuggestedBlock({
      skills: ["Figma", "Google Analytics", "SQL", "Prompt Engineering"]
    });

    expect(skills).toEqual(["Figma", "Google Analytics", "SQL", "Prompt Engineering"]);
  });

  it("splits delimited skill strings into atomic skills", () => {
    const skills = extractPoolSkillsFromSuggestedBlock({
      fields: {
        skills: ["Technical Skills: TypeScript, Node.js; PostgreSQL\nAWS"],
        items: ["Docker | Kubernetes"]
      }
    });

    expect(skills).toEqual(["TypeScript", "Node.js", "PostgreSQL", "AWS", "Docker", "Kubernetes"]);
  });

  it("rejects paragraph-like suggested skills", () => {
    const skills = extractPoolSkillsFromSuggestedBlock({
      fields: {
        skills: [
          "Built reliable APIs with observability for multiple product teams.",
          "Professional Summary",
          "TypeScript"
        ],
        items: ["Cross-functional technical leadership across many complex platform initiatives"]
      }
    });

    expect(skills).toEqual(["TypeScript"]);
  });
});

describe("AiService skills pool refresh rules", () => {
  it("allows free users to refresh an existing pool via their monthly AI quota", async () => {
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW
    });
    const { service, createSuggestions } = makeService(cv, "free");

    vi.spyOn(service as unknown as ExecuteFlowHost, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-free-refresh" },
      output: {
        suggested_block: {
          fields: {
            skills: ["Redis", "Kafka"]
          }
        }
      }
    });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    expect(createSuggestions).toHaveBeenCalledTimes(1);
  });

  it("applies the same daily cap of 5 to free users", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 5
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

  it("blocks paid refresh when the daily limit of 5 is reached", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 5
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

  it("allows paid refresh below the daily limit of 5", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 4
    });
    const { service, createSuggestions } = makeService(cv, "pro");

    vi.spyOn(service as unknown as ExecuteFlowHost, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-paid-refresh" },
      output: {
        suggested_block: {
          fields: {
            skills: ["Redis"]
          }
        }
      }
    });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    expect(createSuggestions).toHaveBeenCalledTimes(1);
  });

  it("generates a pool of new skills without touching the CV skills field", async () => {
    const cv = createMasterCvRecord();
    const { service, createSuggestions, billingService } = makeService(cv, "pro");

    vi.spyOn(service as unknown as ExecuteFlowHost, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-1" },
      output: {
        suggested_block: {
          fields: {
            skills: ["TypeScript", "Node.js", "TypeScript", "AWS"]
          }
        }
      }
    });

    const result = await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    expect(result.suggestion_id).toBe("s-1");
    expect(result.updated_block.id).toBe("skills-block");
    expect(createSuggestions).toHaveBeenCalledTimes(1);
    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    expect(payload.status).toBe("applied");
    expect(typeof payload.applied_at).toBe("string");
    const suggestedContent = payload.suggested_content as Record<string, unknown>;
    const suggestedFields = (suggestedContent.fields as Record<string, unknown>).skills as string[];
    const suggestedMeta = suggestedContent.meta as Record<string, unknown>;
    // Accepted skills stay exactly as they were — pool generation must not rewrite the CV.
    expect(suggestedFields).toEqual(["TypeScript", "React"]);
    // The pool keeps only skills the CV doesn't already have (TypeScript is filtered out).
    expect(suggestedMeta.skill_pool_items).toEqual(["Node.js", "AWS"]);
    expect((billingService.recordAiActionUsage as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("prepends new skills, keeps pending suggestions, and increments counters on refresh", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW,
      skill_pool_refresh_count_day: today,
      skill_pool_refresh_count_value: 1
    });
    const { service, createSuggestions } = makeService(cv, "pro");

    vi.spyOn(service as unknown as ExecuteFlowHost, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-2" },
      output: {
        suggested_block: {
          fields: {
            // Node.js echoes the current pool and TypeScript echoes an accepted skill —
            // only Redis and Kafka are genuinely new.
            skills: ["Node.js", "TypeScript", "Redis", "Kafka"]
          }
        }
      }
    });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    const suggestedContent = payload.suggested_content as Record<string, unknown>;
    const suggestedFields = (suggestedContent.fields as Record<string, unknown>).skills as string[];
    const suggestedMeta = suggestedContent.meta as Record<string, unknown>;
    expect(suggestedFields).toEqual(["TypeScript", "React"]);
    expect(suggestedMeta.skill_pool_items).toEqual(["Redis", "Kafka", "Node.js"]);
    expect(suggestedMeta.skill_pool_refresh_count_day).toBe(today);
    expect(suggestedMeta.skill_pool_refresh_count_value).toBe(2);
  });

  it("accepts pool skills returned flat on the suggested_block root", async () => {
    const cv = createMasterCvRecord();
    const { service, createSuggestions } = makeService(cv, "pro");

    vi.spyOn(service as unknown as ExecuteFlowHost, "executeFlow").mockResolvedValue({
      ai_run: { id: "run-flat" },
      output: {
        suggested_block: {
          skills: ["Figma", "Google Analytics"]
        }
      }
    });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    const suggestedMeta = (payload.suggested_content as Record<string, unknown>).meta as Record<string, unknown>;
    expect(suggestedMeta.skill_pool_items).toEqual(["Figma", "Google Analytics"]);
  });

  it("retries with a banned list when the model only echoes known skills, then succeeds", async () => {
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW
    });
    const { service, createSuggestions } = makeService(cv, "pro");

    const executeFlow = vi
      .spyOn(service as unknown as ExecuteFlowHost, "executeFlow")
      .mockResolvedValueOnce({
        ai_run: { id: "run-echo" },
        output: {
          suggested_block: {
            fields: {
              // Everything here is already accepted or pooled — nothing new.
              skills: ["TypeScript", "React", "Node.js"]
            }
          }
        }
      })
      .mockResolvedValueOnce({
        ai_run: { id: "run-retry" },
        output: {
          suggested_block: {
            fields: {
              skills: ["Redis", "Kafka"]
            }
          }
        }
      });

    await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "skills-block",
      action_type: "improve"
    });

    expect(executeFlow).toHaveBeenCalledTimes(2);
    const firstCall = executeFlow.mock.calls[0]?.[0] as Record<string, unknown>;
    const retryCall = executeFlow.mock.calls[1]?.[0] as Record<string, unknown>;
    // The pool rides on its own flow so DB prompt rows for it are independent of block_suggest.
    expect(firstCall.flow_type).toBe("skills_pool");
    expect(firstCall.force_user_prompt).toBe(false);
    expect(retryCall.force_user_prompt).toBe(true);
    const retryPayload = retryCall.input_payload as Record<string, unknown>;
    expect(retryPayload.excluded_skills).toEqual(["TypeScript", "React", "Node.js"]);

    const payload = createSuggestions.mock.calls[0]?.[0]?.[0] as Record<string, unknown>;
    const suggestedMeta = (payload.suggested_content as Record<string, unknown>).meta as Record<string, unknown>;
    expect(suggestedMeta.skill_pool_items).toEqual(["Redis", "Kafka", "Node.js"]);
  });

  it("fails with a clear error when even the retry produces nothing new", async () => {
    const cv = createMasterCvRecord({
      skill_pool_items: ["Node.js"],
      skill_pool_last_generated_at: NOW
    });
    const { service, createSuggestions } = makeService(cv, "pro");

    const executeFlow = vi
      .spyOn(service as unknown as ExecuteFlowHost, "executeFlow")
      .mockResolvedValue({
        ai_run: { id: "run-echo-only" },
        output: {
          suggested_block: {
            fields: {
              skills: ["TypeScript", "Node.js"]
            }
          }
        }
      });

    await expect(
      service.suggestBlock(session, {
        master_cv_id: "master-1",
        block_id: "skills-block",
        action_type: "improve"
      })
    ).rejects.toBeInstanceOf(AiFlowFailedError);

    expect(executeFlow).toHaveBeenCalledTimes(2);
    expect(createSuggestions).not.toHaveBeenCalled();
  });
});
