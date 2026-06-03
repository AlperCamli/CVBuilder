import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import type { SessionContext } from "../src/modules/ai/ai.types";
import type { AiRepository } from "../src/modules/ai/ai.repository";
import type { AiPromptResolver, ResolvedAiPrompt } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../src/modules/ai/provider/ai-provider";
import type { BillingService } from "../src/modules/billing/billing.service";
import type { CvRevisionsService } from "../src/modules/cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { AiFlowType, AiRunRecord, UserRecord } from "../src/shared/types/domain";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const NOW = "2026-06-03T12:00:00.000Z";

const sessionUser: UserRecord = {
  id: "user-1",
  auth_user_id: "auth-1",
  email: "user@example.com",
  full_name: "User One",
  locale: "en",
  default_cv_language: "en",
  onboarding_completed: true,
  created_at: NOW,
  updated_at: NOW
};

const session: SessionContext = {
  authUser: {
    auth_user_id: "auth-1",
    email: "user@example.com",
    full_name: "User One",
    locale: "en"
  },
  appUser: sessionUser
};

const baseContent = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {
    full_name: "User One",
    email: "user@example.com"
  },
  sections: [
    {
      id: "header-section",
      type: "header",
      title: "Header",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "header-block",
          type: "contact",
          order: 0,
          visibility: "visible",
          fields: {
            full_name: "User One",
            email: "user@example.com"
          },
          meta: {}
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
          id: "experience-short",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          fields: {
            role: "Backend Engineer",
            description: "Built APIs."
          },
          meta: {}
        },
        {
          id: "experience-long",
          type: "experience_item",
          order: 1,
          visibility: "visible",
          fields: {
            role: "Platform Engineer",
            description:
              "Designed and maintained backend services for multiple product teams with monitoring and release automation."
          },
          meta: {}
        },
        {
          id: "experience-empty",
          type: "experience_item",
          order: 2,
          visibility: "visible",
          fields: {
            role: "Empty",
            description: ""
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
          id: "education-block",
          type: "education_item",
          order: 0,
          visibility: "visible",
          fields: {
            institution: "Example University",
            degree: "Bachelor",
            field_of_study: "Computer Science"
          },
          meta: {}
        }
      ]
    }
  ]
});

const headerOnlyContent = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {
    full_name: "User One"
  },
  sections: [
    {
      id: "header-section",
      type: "header",
      title: "Header",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "header-block",
          type: "contact",
          order: 0,
          visibility: "visible",
          fields: {
            full_name: "User One"
          },
          meta: {}
        }
      ]
    }
  ]
});

const resolvedPromptFor = (flowType: AiFlowType, actionType?: string | null): ResolvedAiPrompt => ({
  prompt_key:
    flowType === "block_suggest"
      ? `block-suggest-${actionType ?? "improve"}`
      : flowType === "professional_summary"
        ? "professional-summary"
        : "import-improve",
  prompt_version: flowType === "professional_summary" ? "phase1-v1" : "phase7-v1",
  system_prompt: `${flowType} prompt`,
  model_name: flowType === "professional_summary" ? "heavy-model" : "light-model",
  user_prompt_template: null
});

const makeRun = (id: string, flowType: AiFlowType): AiRunRecord => ({
  id,
  user_id: sessionUser.id,
  master_cv_id: null,
  tailored_cv_id: null,
  job_id: null,
  flow_type: flowType,
  provider: "gemini",
  model_name: flowType === "professional_summary" ? "heavy-model" : "light-model",
  status: "pending",
  progress_stage: "queued",
  input_payload: {},
  output_payload: null,
  error_message: null,
  debug_payload: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  started_at: NOW,
  completed_at: null
});

const makeService = (providerGenerate: (request: AiProviderRequest) => Promise<AiProviderResult>) => {
  let runCounter = 0;
  const createdRuns: AiRunRecord[] = [];
  const completedRuns: Array<{ runId: string; output: Record<string, unknown> }> = [];
  const failedRuns: Array<{ runId: string; message: string; debug: Record<string, unknown> | null | undefined }> = [];

  const aiRepository = {
    createRun: vi.fn().mockImplementation(async (payload: { flow_type: AiFlowType }) => {
      runCounter += 1;
      const run = makeRun(`run-${runCounter}`, payload.flow_type);
      createdRuns.push(run);
      return run;
    }),
    completeRun: vi.fn().mockImplementation(async (_userId: string, runId: string, output: Record<string, unknown>) => {
      const run = createdRuns.find((item) => item.id === runId) ?? makeRun(runId, "import_improve");
      completedRuns.push({ runId, output });
      return {
        ...run,
        status: "completed",
        progress_stage: "completed",
        output_payload: output,
        completed_at: NOW
      };
    }),
    failRun: vi.fn().mockImplementation(
      async (_userId: string, runId: string, message: string, debug?: Record<string, unknown> | null) => {
        const run = createdRuns.find((item) => item.id === runId) ?? makeRun(runId, "import_improve");
        failedRuns.push({ runId, message, debug });
        return {
          ...run,
          status: "failed",
          progress_stage: "failed",
          error_message: message,
          debug_payload: debug ?? null,
          completed_at: NOW
        };
      }
    ),
    updateRunProgressStage: vi.fn().mockImplementation(async (_userId: string, runId: string, stage: string) => {
      const run = createdRuns.find((item) => item.id === runId) ?? makeRun(runId, "import_improve");
      return {
        ...run,
        progress_stage: stage
      };
    }),
    updateRunContext: vi.fn(),
    findRunById: vi.fn()
  } as unknown as AiRepository;

  const aiProvider = {
    providerName: "gemini",
    resolveModelName: vi.fn().mockImplementation((flowType: AiFlowType) =>
      flowType === "professional_summary" ? "heavy-model" : "light-model"
    ),
    generate: vi.fn(providerGenerate)
  } as unknown as AiProvider;

  const billingService = {
    assertActionAllowed: vi.fn().mockResolvedValue(undefined),
    recordAiActionUsage: vi.fn().mockResolvedValue(undefined)
  } as unknown as BillingService;

  const promptResolver = {
    resolve: vi.fn().mockImplementation(async (input: { flow_type: AiFlowType; action_type?: string | null }) =>
      resolvedPromptFor(input.flow_type, input.action_type)
    )
  } as unknown as AiPromptResolver;

  const service = new AiService(
    aiRepository,
    aiProvider,
    {} as MasterCvRepository,
    {} as TailoredCvRepository,
    {} as JobsRepository,
    {} as CvRevisionsService,
    {} as TemplatesService,
    promptResolver,
    billingService
  );

  return {
    service,
    aiRepository,
    aiProvider,
    billingService,
    createdRuns,
    completedRuns,
    failedRuns
  };
};

describe("AiService parallel import_improve flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a parent run and parallel sub-runs for summary, skills, expand, and improve tasks", async () => {
    const { service, aiProvider, billingService, createdRuns } = makeService(async (request) => {
      if (request.flow_type === "professional_summary") {
        expect(JSON.stringify(request.input_payload)).not.toContain("user@example.com");
        return {
          provider: "gemini",
          model_name: request.model_name,
          output_payload: {
            summary_text: "Backend engineer with experience building reliable APIs."
          }
        };
      }

      const block = request.input_payload.block as Record<string, unknown>;
      const fields = block.fields as Record<string, unknown>;
      if (request.input_payload.skills_pool_context) {
        return {
          provider: "gemini",
          model_name: request.model_name,
          output_payload: {
            suggested_block: {
              ...block,
              fields: {
                ...fields,
                skills: ["TypeScript", "APIs"]
              }
            }
          }
        };
      }

      return {
        provider: "gemini",
        model_name: request.model_name,
        output_payload: {
          suggested_block: {
            ...block,
            fields: {
              ...fields,
              description: `${String(fields.description ?? "")} Improved.`
            }
          }
        }
      };
    });

    const result = await service.improveImportedContent(session, {
      parsed_content: baseContent(),
      improvement_guidance: ["Use stronger action verbs"]
    });

    expect(createdRuns[0]?.flow_type).toBe("import_improve");
    expect(createdRuns.filter((run) => run.flow_type === "professional_summary")).toHaveLength(1);
    expect(createdRuns.filter((run) => run.flow_type === "block_suggest")).toHaveLength(4);
    expect(aiProvider.generate).toHaveBeenCalledTimes(5);
    expect(
      (aiProvider.generate as unknown as { mock: { calls: Array<[AiProviderRequest]> } }).mock.calls
        .filter(([request]) => request.flow_type === "block_suggest")
        .map(([request]) => request.input_payload.action_type)
    ).toEqual(expect.arrayContaining(["expand", "improve"]));
    expect(result.generation_metadata.attempted_runs).toBe(5);
    expect(result.generation_metadata.successful_runs).toBe(5);
    expect(result.generation_metadata.failed_runs).toBe(0);
    expect(result.generation_metadata.partial_success).toBe(false);
    expect(result.improved_content.sections.some((section) => section.type === "summary")).toBe(true);
    expect(result.improved_content.sections.some((section) => section.type === "skills")).toBe(true);
    expect(result.changed_block_ids).toEqual(
      expect.arrayContaining(["experience-short", "experience-long", "education-block"])
    );
    expect(billingService.recordAiActionUsage).toHaveBeenCalledTimes(1);
  });

  it("returns partial success when some sub-runs fail", async () => {
    const { service, failedRuns } = makeService(async (request) => {
      if (request.flow_type === "professional_summary") {
        throw new Error("summary failed");
      }

      const block = request.input_payload.block as Record<string, unknown>;
      const fields = block.fields as Record<string, unknown>;
      if (request.input_payload.skills_pool_context) {
        return {
          provider: "gemini",
          model_name: request.model_name,
          output_payload: {
            suggested_block: {
              ...block,
              fields: {
                ...fields,
                skills: ["TypeScript", "APIs"]
              }
            }
          }
        };
      }

      return {
        provider: "gemini",
        model_name: request.model_name,
        output_payload: {
          suggested_block: {
            ...block,
            fields: {
              ...fields,
              description: `${String(fields.description ?? "")} Improved.`
            }
          }
        }
      };
    });

    const result = await service.improveImportedContent(session, {
      parsed_content: {
        ...baseContent(),
        sections: baseContent().sections.filter((section) => section.type !== "education")
      }
    });

    expect(result.generation_metadata.partial_success).toBe(true);
    expect(result.generation_metadata.failed_runs).toBe(1);
    expect(result.generation_metadata.successful_runs).toBeGreaterThan(0);
    expect(failedRuns.some((run) => run.runId !== "run-1")).toBe(true);
  });

  it("fails the parent run when all attempted sub-runs fail", async () => {
    const { service, failedRuns, billingService } = makeService(async () => {
      throw new Error("provider down");
    });

    await expect(
      service.improveImportedContent(session, {
        parsed_content: baseContent()
      })
    ).rejects.toThrow("Import improve sub-runs failed");

    expect(failedRuns.some((run) => run.runId === "run-1")).toBe(true);
    expect(billingService.recordAiActionUsage).toHaveBeenCalledTimes(1);
  });

  it("completes without billing when no eligible tasks exist", async () => {
    const { service, aiProvider, billingService } = makeService(async () => {
      throw new Error("provider should not be called");
    });

    const result = await service.improveImportedContent(session, {
      parsed_content: headerOnlyContent()
    });

    expect(aiProvider.generate).not.toHaveBeenCalled();
    expect(billingService.recordAiActionUsage).not.toHaveBeenCalled();
    expect(result.generation_metadata.attempted_runs).toBe(0);
    expect(result.improved_content.sections).toHaveLength(1);
  });
});
