import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import { AiFlowFailedError, AiProviderError } from "../src/shared/errors/app-error";
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
import type { AiRunRecord, MasterCvRecord, UserRecord } from "../src/shared/types/domain";

const NOW = "2026-04-21T16:10:00.000Z";

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

const masterCv: MasterCvRecord = {
  id: "master-1",
  user_id: sessionUser.id,
  title: "Master CV",
  language: "en",
  template_id: null,
  current_content: {
    version: "v1",
    language: "en",
    metadata: {},
    sections: []
  },
  summary_text: null,
  source_type: "scratch",
  is_deleted: false,
  created_at: NOW,
  updated_at: NOW
};

const pendingRun: AiRunRecord = {
  id: "run-1",
  user_id: sessionUser.id,
  master_cv_id: masterCv.id,
  tailored_cv_id: null,
  job_id: null,
  flow_type: "follow_up_questions",
  provider: "gemini",
  model_name: "gemini-3-flash-preview",
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

const completedRun: AiRunRecord = {
  ...pendingRun,
  status: "completed",
  progress_stage: "completed",
  output_payload: {
    questions: []
  },
  completed_at: NOW
};

const resolvedPrompt: ResolvedAiPrompt = {
  prompt_key: "follow-up-questions",
  prompt_version: "phase5-v1",
  system_prompt: "Generate follow-up questions in English.",
  model_name: "gemini-3-flash-preview",
  user_prompt_template: null
};

describe("AiService follow_up_questions flow", () => {
  const createRun = vi.fn();
  const completeRun = vi.fn();
  const failRun = vi.fn();
  const updateRunProgressStage = vi.fn();
  const updateRunContext = vi.fn();
  const findMasterCvById = vi.fn();
  const providerGenerate = vi.fn();
  const resolvePrompt = vi.fn();

  const makeService = () => {
    const aiRepository = {
      createRun,
      completeRun,
      failRun,
      updateRunProgressStage,
      updateRunContext
    } as unknown as AiRepository;

    const aiProvider = {
      providerName: "gemini",
      resolveModelName: vi.fn().mockReturnValue("gemini-3-flash-preview"),
      generate: providerGenerate
    } as unknown as AiProvider;

    const masterCvRepository = {
      findById: findMasterCvById
    } as unknown as MasterCvRepository;

    const promptResolver = {
      resolve: resolvePrompt
    } as unknown as AiPromptResolver;

    return new AiService(
      aiRepository,
      aiProvider,
      masterCvRepository,
      {} as TailoredCvRepository,
      {} as JobsRepository,
      {} as CvRevisionsService,
      {} as TemplatesService,
      promptResolver,
      {} as BillingService
    );
  };

  beforeEach(() => {
    createRun.mockReset();
    completeRun.mockReset();
    failRun.mockReset();
    updateRunProgressStage.mockReset();
    updateRunContext.mockReset();
    findMasterCvById.mockReset();
    providerGenerate.mockReset();
    resolvePrompt.mockReset();

    findMasterCvById.mockResolvedValue(masterCv);
    createRun.mockResolvedValue(pendingRun);
    completeRun.mockResolvedValue(completedRun);
    updateRunProgressStage.mockResolvedValue(pendingRun);
    updateRunContext.mockResolvedValue(pendingRun);
    failRun.mockResolvedValue({
      ...pendingRun,
      status: "failed",
      completed_at: NOW
    } satisfies AiRunRecord);
    resolvePrompt.mockResolvedValue(resolvedPrompt);
  });

  it("completes follow-up flow with valid provider payload", async () => {
    const service = makeService();
    providerGenerate.mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-3-flash-preview",
      output_payload: {
        questions: [
          {
            id: "q1",
            question: "Which achievements are most relevant to this role?",
            question_type: "text"
          }
        ]
      }
    });

    const result = await service.generateFollowUpQuestions(session, {
      master_cv_id: masterCv.id,
      job: {
        company_name: "Acme",
        job_title: "Backend Engineer",
        job_description: "Build APIs and services."
      },
      prior_analysis: {
        gaps: ["leadership examples"]
      }
    });

    const questions = result.questions as Array<{ id: string }>;
    expect(questions).toHaveLength(1);
    expect(questions[0]?.id).toBe("q1");
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(failRun).not.toHaveBeenCalled();
  });

  it("keeps model selection env/provider-driven even when prompt config has model_name", async () => {
    const service = makeService();
    resolvePrompt.mockResolvedValue({
      ...resolvedPrompt,
      model_name: "db-configured-model-name"
    });
    providerGenerate.mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-3-flash-preview",
      output_payload: {
        questions: []
      }
    });

    await service.generateFollowUpQuestions(session, {
      master_cv_id: masterCv.id,
      job: {
        company_name: "Acme",
        job_title: "Backend Engineer",
        job_description: "Build APIs and services."
      }
    });

    expect(providerGenerate).toHaveBeenCalledTimes(1);
    expect(providerGenerate.mock.calls[0]?.[0]?.model_name).toBe("gemini-3-flash-preview");
  });

  it("keeps strict contract validation and fails run for invalid provider payload", async () => {
    const service = makeService();
    providerGenerate.mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-3-flash-preview",
      output_payload: {
        questions: [
          {
            id: "q1",
            question: "Question with unsupported fields",
            question_type: "text",
            extra: "not allowed"
          }
        ]
      }
    });

    await expect(
      service.generateFollowUpQuestions(session, {
        master_cv_id: masterCv.id,
        job: {
          company_name: "Acme",
          job_title: "Backend Engineer",
          job_description: "Build APIs and services."
        }
      })
    ).rejects.toBeInstanceOf(AiFlowFailedError);

    expect(failRun.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(String(failRun.mock.calls[0][2])).toContain("Structured output validation failed");
    expect(completeRun).not.toHaveBeenCalled();
  });

  it("normalizes overly long target_hint values instead of failing the flow", async () => {
    const service = makeService();
    const longTargetHint = "A".repeat(220);
    providerGenerate.mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-3-flash-preview",
      output_payload: {
        questions: [
          {
            id: "q1",
            question: "Which outcomes should we emphasize first?",
            question_type: "text",
            target_hint: longTargetHint
          }
        ]
      }
    });

    const result = await service.generateFollowUpQuestions(session, {
      master_cv_id: masterCv.id,
      job: {
        company_name: "Acme",
        job_title: "Backend Engineer",
        job_description: "Build APIs and services."
      }
    });

    const questions = result.questions as Array<{ target_hint?: string | null }>;
    expect(questions).toHaveLength(1);
    expect(questions[0]?.target_hint).toHaveLength(160);
    expect(questions[0]?.target_hint).toBe("A".repeat(160));
    expect(completeRun).toHaveBeenCalledTimes(1);
    expect(failRun).not.toHaveBeenCalled();
  });

  it("persists provider diagnostics into ai_runs.error_message on provider failures", async () => {
    const service = makeService();
    providerGenerate.mockRejectedValue(
      new AiProviderError("Gemini provider request failed", {
        provider_status: 400,
        provider_error_name: "ApiError",
        reason: "Request contains an invalid argument."
      })
    );

    await expect(
      service.generateFollowUpQuestions(session, {
        master_cv_id: masterCv.id,
        job: {
          company_name: "Acme",
          job_title: "Backend Engineer",
          job_description: "Build APIs and services."
        }
      })
    ).rejects.toBeInstanceOf(AiProviderError);

    expect(failRun.mock.calls.length).toBeGreaterThanOrEqual(1);
    const persistedMessage = String(failRun.mock.calls[0][2]);
    expect(persistedMessage).toContain("Gemini provider request failed");
    expect(persistedMessage).toContain("provider_status=400");
    expect(persistedMessage).toContain("provider_error=ApiError");
    expect(persistedMessage).toContain("reason=Request contains an invalid argument.");
  });

  it("marks run as failed when persistence step throws after output validation", async () => {
    const service = makeService();
    providerGenerate.mockResolvedValue({
      provider: "gemini",
      model_name: "gemini-3-flash-preview",
      output_payload: {
        questions: [
          {
            id: "q1",
            question: "Which outcomes are most important to highlight?",
            question_type: "text"
          }
        ]
      }
    });
    updateRunProgressStage.mockImplementation(async (_userId: string, _runId: string, stage: string) => {
      if (stage === "persisting_result") {
        throw new Error("Failed to update AI run progress stage");
      }
      return pendingRun;
    });

    await expect(
      service.generateFollowUpQuestions(session, {
        master_cv_id: masterCv.id,
        job: {
          company_name: "Acme",
          job_title: "Backend Engineer",
          job_description: "Build APIs and services."
        }
      })
    ).rejects.toThrow("Failed to update AI run progress stage");

    expect(failRun.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(String(failRun.mock.calls[0][2])).toContain("Failed to update AI run progress stage");
  });
});
