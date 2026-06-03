import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import type { SessionContext } from "../src/modules/ai/ai.types";
import type { AiRepository } from "../src/modules/ai/ai.repository";
import type { AiPromptResolver, ResolvedAiPrompt } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";
import type { BillingService } from "../src/modules/billing/billing.service";
import type { CvRevisionsService } from "../src/modules/cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { AiRunRecord, UserRecord } from "../src/shared/types/domain";
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

const parsedContent: CvContent = {
  version: "v1",
  language: "en",
  metadata: {
    full_name: "User One",
    email: "user@example.com"
  },
  sections: [
    {
      id: "header-real-id",
      type: "header",
      title: "Header",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "header-block-real-id",
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
      id: "experience-real-id",
      type: "experience",
      title: "Experience",
      order: 1,
      meta: {},
      blocks: [
        {
          id: "experience-block-real-id",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          fields: {
            role: "Backend Engineer",
            description: "Built APIs.",
            owner_id: "99d5751f-b90f-4df8-8ff9-50651d7725cc",
            empty: ""
          },
          meta: {
            parser: "import"
          }
        }
      ]
    }
  ]
};

const pendingRun: AiRunRecord = {
  id: "run-1",
  user_id: sessionUser.id,
  master_cv_id: null,
  tailored_cv_id: null,
  job_id: null,
  flow_type: "import_improve",
  provider: "gemini",
  model_name: "gemini-2.5-flash",
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
};

const resolvedPrompt: ResolvedAiPrompt = {
  prompt_key: "import-improve",
  prompt_version: "phase6-v1",
  system_prompt: "Improve import body.",
  model_name: "gemini-2.5-flash",
  user_prompt_template: null
};

const makeService = (overrides?: {
  aiRepository?: Partial<AiRepository>;
  aiProvider?: Partial<AiProvider>;
  billingService?: Partial<BillingService>;
  promptResolver?: Partial<AiPromptResolver>;
}): AiService => {
  const aiRepository = {
    createRun: vi.fn().mockResolvedValue(pendingRun),
    completeRun: vi.fn().mockResolvedValue({
      ...pendingRun,
      status: "completed",
      progress_stage: "completed",
      completed_at: NOW
    }),
    failRun: vi.fn().mockResolvedValue({
      ...pendingRun,
      status: "failed",
      completed_at: NOW
    }),
    updateRunProgressStage: vi.fn().mockResolvedValue(pendingRun),
    updateRunContext: vi.fn().mockResolvedValue(pendingRun),
    ...(overrides?.aiRepository ?? {})
  } as unknown as AiRepository;

  const aiProvider = {
    providerName: "gemini",
    resolveModelName: vi.fn().mockReturnValue("gemini-2.5-flash"),
    generate: vi.fn(),
    ...(overrides?.aiProvider ?? {})
  } as unknown as AiProvider;

  const billingService = {
    assertActionAllowed: vi.fn().mockResolvedValue(undefined),
    recordAiActionUsage: vi.fn().mockResolvedValue(undefined),
    ...(overrides?.billingService ?? {})
  } as unknown as BillingService;

  const promptResolver = {
    resolve: vi.fn().mockResolvedValue(resolvedPrompt),
    ...(overrides?.promptResolver ?? {})
  } as unknown as AiPromptResolver;

  return new AiService(
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
};

describe("AiService import_improve flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends sanitized alias body to the model and restores header/contact output", async () => {
    const service = makeService();
    const executeFlow = vi
      .spyOn(
        service as unknown as {
          executeFlow: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
        },
        "executeFlow"
      )
      .mockResolvedValue({
        ai_run: {
          id: "run-1"
        },
        output: {
          improved_content: {
            sections: [
              {
                id: "experience_1_section",
                type: "experience",
                title: "Experience",
                order: 0,
                blocks: [
                  {
                    id: "experience_1",
                    type: "experience_item",
                    order: 0,
                    visibility: "visible",
                    fields: {
                      role: "Backend Engineer",
                      description: "Built reliable APIs."
                    }
                  }
                ]
              }
            ]
          },
          changed_block_ids: ["experience_1"]
        },
        provider: "gemini",
        model_name: "gemini-2.5-flash",
        prompt_key: "import-improve",
        prompt_version: "phase6-v1"
      });

    const result = await service.improveImportedContent(session, {
      parsed_content: parsedContent,
      improvement_guidance: []
    });

    expect(executeFlow).toHaveBeenCalledTimes(1);
    const inputPayload = executeFlow.mock.calls[0]?.[0]?.input_payload as Record<string, unknown>;
    expect(inputPayload).toHaveProperty("cv_body");
    expect(inputPayload).not.toHaveProperty("language");
    expect(inputPayload).not.toHaveProperty("parsed_content");
    expect(inputPayload).not.toHaveProperty("improvement_guidance");

    const serializedInput = JSON.stringify(inputPayload);
    expect(serializedInput).not.toContain("header-real-id");
    expect(serializedInput).not.toContain("header-block-real-id");
    expect(serializedInput).not.toContain("experience-real-id");
    expect(serializedInput).not.toContain("experience-block-real-id");
    expect(serializedInput).not.toContain("99d5751f-b90f-4df8-8ff9-50651d7725cc");
    expect(serializedInput).not.toContain("user@example.com");
    expect(serializedInput).toContain("experience_1");

    expect(result.generation_metadata.flow_type).toBe("import_improve");
    expect(result.changed_block_ids).toEqual(["experience-block-real-id"]);
    expect(result.improved_content.metadata).toEqual(parsedContent.metadata);
    expect(result.improved_content.sections[0]?.id).toBe("header-real-id");
    expect(result.improved_content.sections[1]?.id).toBe("experience-real-id");
    expect(result.improved_content.sections[1]?.blocks[0]?.id).toBe("experience-block-real-id");
    expect(result.improved_content.sections[1]?.blocks[0]?.fields.description).toBe("Built reliable APIs.");
  });

  it("fails the AI run when import_improve provider output is invalid", async () => {
    const failRun = vi.fn().mockResolvedValue({
      ...pendingRun,
      status: "failed",
      completed_at: NOW
    });
    const providerGenerate = vi.fn().mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-2.5-flash",
      output_payload: {
        improved_content: 123,
        changed_block_ids: []
      }
    });
    const service = makeService({
      aiRepository: {
        failRun
      },
      aiProvider: {
        generate: providerGenerate
      }
    });

    await expect(
      service.improveImportedContent(session, {
        parsed_content: parsedContent
      })
    ).rejects.toThrow("AI output did not match required contract");

    expect(providerGenerate).toHaveBeenCalledTimes(1);
    expect(failRun).toHaveBeenCalled();
    expect(
      failRun.mock.calls.some((call) => {
        const debugPayload = call[3] as Record<string, unknown> | undefined;
        return debugPayload?.reason === "output_contract_invalid";
      })
    ).toBe(true);
  });
});
