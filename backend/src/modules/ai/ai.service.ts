import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildCvPreview,
  buildCvSummaryText,
  cloneCvContent,
  findBlockInCvContent,
  normalizeCvBlock,
  normalizeCvContent,
  replaceBlockInCvContent
} from "../../shared/cv-content/cv-content.utils";
import {
  AiFlowFailedError,
  AiProviderError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  SuggestionNotApplicableError
} from "../../shared/errors/app-error";
import type {
  AiFlowType,
  AiRunProgressStage,
  CvKind,
  AiSuggestionActionType,
  AiRunRecord,
  AiSuggestionRecord,
  JobRecord,
  MasterCvRecord,
  TailoredCvRecord
} from "../../shared/types/domain";
import type { JobsRepository } from "../jobs/jobs.repository";
import type { MasterCvRepository } from "../master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../tailored-cv/tailored-cv.repository";
import type { TemplatesService } from "../templates/templates.service";
import type { CvRevisionsService } from "../cv-revisions/cv-revisions.service";
import type { BillingService } from "../billing/billing.service";
import { AI_FLOW_REGISTRY } from "./flows/flow-registry";
import { cvParseOutputSchema } from "./flows/flow-contracts";
import { evaluateTailoredDraftSemanticContent } from "./tailored-draft-semantic-validation";
import { coerceTailoredDraftOutputPayload } from "./tailored-draft-output-coercion";
import type {
  AiBlockVersionChain,
  AiBlockVersionEntry,
  AiTailoredDraftJobPayload,
  CvAiBlockVersionsResponse,
  CvAiHistoryResponse,
  AiRunSummary,
  AiSuggestionDetail,
  AiSuggestionSummary,
  BlockCompareInput,
  BlockCompareResult,
  BlockOptionsInput,
  BlockSuggestInput,
  FollowUpQuestionsInput,
  FollowUpQuestionsResult,
  ImportImproveInput,
  ImportImproveResponse,
  JobAnalysisInput,
  JobAnalysisResult,
  SessionContext,
  SuggestionApplyResponse,
  SuggestionRejectResponse,
  TailoringRunExecuteResponse,
  TailoringRunFlowType,
  TailoringRunResultResponse,
  TailoringRunStartInput,
  TailoringRunStartResponse,
  TailoringRunStatusResponse,
  TailoredCvDraftInput,
  TailoredCvDraftJobSummary,
  TailoredCvDraftSummary
} from "./ai.types";
import type { AiRepository } from "./ai.repository";
import type { AiPromptResolver } from "./prompts/prompt-resolver";
import type { AiProvider } from "./provider/ai-provider";
import {
  aiFollowUpQuestionsSchema,
  aiJobAnalysisSchema,
  aiTailoredDraftSchema
} from "./ai.schemas";

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(",")}}`;
};

const snapshotsEqual = (left: unknown, right: unknown): boolean => {
  return stableStringify(left) === stableStringify(right);
};

const toPersistableAiRunError = (error: unknown): string => {
  if (error instanceof AiProviderError) {
    const details = asRecord(error.details);
    const diagnostics: string[] = [];

    if (typeof details.provider_status === "number") {
      diagnostics.push(`provider_status=${details.provider_status}`);
    } else if (typeof details.provider_status === "string" && details.provider_status.trim()) {
      diagnostics.push(`provider_status=${details.provider_status.trim()}`);
    }

    if (typeof details.provider_error_name === "string" && details.provider_error_name.trim()) {
      diagnostics.push(`provider_error=${details.provider_error_name.trim()}`);
    }

    if (typeof details.reason === "string" && details.reason.trim()) {
      diagnostics.push(`reason=${details.reason.trim()}`);
    }

    if (diagnostics.length > 0) {
      return `${error.message} (${diagnostics.join("; ")})`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown AI flow error";
};

const sanitizeDebugScalar = (value: unknown): string | number | boolean | null => {
  if (typeof value === "string") {
    return value.slice(0, 2000);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
};

const toPersistableAiRunDebugPayload = (error: unknown): Record<string, unknown> | null => {
  if (error instanceof AiProviderError) {
    const details = asRecord(error.details);
    return {
      error_name: error.name,
      provider_error: error.message,
      provider_status: sanitizeDebugScalar(details.provider_status),
      provider_status_code: sanitizeDebugScalar(details.provider_status_code),
      provider_error_name: sanitizeDebugScalar(details.provider_error_name),
      provider_parse_error: sanitizeDebugScalar(details.parse_error),
      provider_quota_id: sanitizeDebugScalar(details.provider_quota_id),
      provider_quota_metric: sanitizeDebugScalar(details.provider_quota_metric),
      provider_retry_delay_ms: sanitizeDebugScalar(details.provider_retry_delay_ms),
      reason: sanitizeDebugScalar(details.reason),
      raw_output_excerpt: sanitizeDebugScalar(details.raw_output_excerpt)
    };
  }

  if (error instanceof AiFlowFailedError) {
    const details = asRecord(error.details);
    return Object.keys(details).length > 0
      ? {
          error_name: error.name,
          reason: error.message,
          details
        }
      : null;
  }

  if (error instanceof Error) {
    return {
      error_name: error.name,
      reason: error.message.slice(0, 2000)
    };
  }

  return null;
};

interface ExecuteFlowOptions {
  flow_type: keyof typeof AI_FLOW_REGISTRY;
  user_id: string;
  input_payload: Record<string, unknown>;
  user_prompt: string;
  action_type?: AiSuggestionActionType | null;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  job_id?: string | null;
}

interface ExecuteFlowResult<TOutput> {
  ai_run: AiRunRecord;
  output: TOutput;
  provider: string;
  model_name: string;
  prompt_key: string;
  prompt_version: string;
}

interface AiBlockTargetContext {
  cv_kind: CvKind;
  cv_id: string;
  current_content: TailoredCvRecord["current_content"] | MasterCvRecord["current_content"];
  linked_job: JobRecord | null;
}

interface ResolvedPromptSnapshot {
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  user_prompt: string;
  model_name: string;
}

interface RunFlowExecutionOptions {
  user_id: string;
  ai_run_id: string;
  flow_type: AiFlowType;
  prompt: ResolvedPromptSnapshot;
  input_payload: Record<string, unknown>;
}

interface RunFlowExecutionResult {
  output_payload: Record<string, unknown>;
  provider: string;
  model_name: string;
  token_usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
}

type TailoringRunInputPayload = JobAnalysisInput | FollowUpQuestionsInput | TailoredCvDraftInput;

const TAILORING_FLOW_TYPES: TailoringRunFlowType[] = [
  "job_analysis",
  "follow_up_questions",
  "tailored_draft"
];

export class AiService {
  constructor(
    private readonly aiRepository: AiRepository,
    private readonly aiProvider: AiProvider,
    private readonly masterCvRepository: MasterCvRepository,
    private readonly tailoredCvRepository: TailoredCvRepository,
    private readonly jobsRepository: JobsRepository,
    private readonly cvRevisionsService: CvRevisionsService,
    private readonly templatesService: TemplatesService,
    private readonly promptResolver: AiPromptResolver,
    private readonly billingService: BillingService
  ) {}

  async startTailoringRun(
    session: SessionContext,
    input: TailoringRunStartInput
  ): Promise<TailoringRunStartResponse> {
    const parsedInput = this.parseTailoringRunInput(input.flow_type, input.input);
    const runtimeContext = await this.assertTailoringRunInput(
      session.appUser.id,
      input.flow_type,
      parsedInput
    );
    const userPrompt = this.buildTailoringUserPrompt(input.flow_type, parsedInput);
    const resolvedPrompt = await this.resolvePromptForFlow({
      flow_type: input.flow_type,
      action_type: null,
      user_prompt: userPrompt
    });

    const runContext = this.extractRunTargetContext(parsedInput);
    const run = await this.aiRepository.createRun({
      user_id: session.appUser.id,
      flow_type: input.flow_type,
      provider: this.aiProvider.providerName,
      model_name: resolvedPrompt.model_name,
      master_cv_id: runContext.master_cv_id,
      tailored_cv_id: runContext.tailored_cv_id,
      job_id: runContext.job_id,
      progress_stage: "queued",
      input_payload: {
        flow_input: parsedInput,
        runtime: runtimeContext,
        prompt: {
          prompt_key: resolvedPrompt.prompt_key,
          prompt_version: resolvedPrompt.prompt_version,
          provider: this.aiProvider.providerName,
          model_name: resolvedPrompt.model_name,
          user_prompt: resolvedPrompt.user_prompt,
          system_prompt: resolvedPrompt.system_prompt
        }
      }
    });

    return {
      ai_run_id: run.id,
      flow_type: input.flow_type,
      status: run.status,
      progress_stage: run.progress_stage
    };
  }

  async executeTailoringRun(
    session: SessionContext,
    aiRunId: string
  ): Promise<TailoringRunExecuteResponse> {
    const run = await this.requireTailoringRun(session.appUser.id, aiRunId);
    if (run.status !== "pending" || run.progress_stage !== "queued") {
      return this.toTailoringRunExecuteResponse(run);
    }

    const claimed = await this.aiRepository.claimRunForExecution(session.appUser.id, run.id);
    if (!claimed) {
      const current = await this.aiRepository.findRunById(session.appUser.id, run.id);
      return this.toTailoringRunExecuteResponse(current ?? run);
    }
    try {
      const parsedInput = this.parseTailoringRunInput(
        claimed.flow_type as TailoringRunFlowType,
        this.readRunFlowInput(claimed)
      );
      const storedPrompt = await this.resolveStoredRunPrompt(claimed, parsedInput);

      let executedRun: AiRunRecord;
      if (claimed.flow_type === "job_analysis") {
        executedRun = await this.executeTailoringJobAnalysisRun(
          session.appUser.id,
          claimed,
          parsedInput as JobAnalysisInput,
          storedPrompt
        );
      } else if (claimed.flow_type === "follow_up_questions") {
        executedRun = await this.executeTailoringFollowUpQuestionsRun(
          session.appUser.id,
          claimed,
          parsedInput as FollowUpQuestionsInput,
          storedPrompt
        );
      } else {
        executedRun = await this.executeTailoringDraftRun(
          session.appUser.id,
          claimed,
          parsedInput as TailoredCvDraftInput,
          storedPrompt
        );
      }

      return this.toTailoringRunExecuteResponse(executedRun);
    } catch (error) {
      await this.failRunBestEffort(session.appUser.id, claimed.id, error);
      throw error;
    }
  }

  async getTailoringRunStatus(
    session: SessionContext,
    aiRunId: string
  ): Promise<TailoringRunStatusResponse> {
    const run = await this.requireTailoringRun(session.appUser.id, aiRunId);
    return {
      ai_run_id: run.id,
      flow_type: run.flow_type as TailoringRunFlowType,
      status: run.status,
      progress_stage: run.progress_stage,
      error_message: run.error_message,
      started_at: run.started_at,
      completed_at: run.completed_at
    };
  }

  async getTailoringRunResult(
    session: SessionContext,
    aiRunId: string
  ): Promise<TailoringRunResultResponse> {
    const run = await this.requireTailoringRun(session.appUser.id, aiRunId);
    if (run.status !== "completed") {
      throw new ConflictError("AI run result is not ready", {
        ai_run_id: run.id,
        status: run.status,
        error_message: run.error_message
      });
    }

    const result = asRecord(run.output_payload);
    return {
      ai_run_id: run.id,
      flow_type: run.flow_type as TailoringRunFlowType,
      status: "completed",
      result
    };
  }

  async analyzeJob(session: SessionContext, input: JobAnalysisInput) {
    const masterCv = await this.requireMasterCv(session.appUser.id, input.master_cv_id);

    const flowInput = {
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      master_cv_text: buildCvSummaryText(masterCv.current_content, 5000) ?? "",
      master_cv_summary: masterCv.summary_text
    };

    const executed = await this.executeFlow({
      flow_type: "job_analysis",
      user_id: session.appUser.id,
      master_cv_id: masterCv.id,
      input_payload: flowInput,
      user_prompt: `Analyze role fit for ${input.job.job_title} at ${input.job.company_name}.`
    });

    return {
      ai_run_id: executed.ai_run.id,
      ...asRecord(executed.output)
    };
  }

  async generateFollowUpQuestions(session: SessionContext, input: FollowUpQuestionsInput) {
    await this.requireMasterCv(session.appUser.id, input.master_cv_id);

    const priorAnalysis = asRecord(input.prior_analysis);
    const flowInput = {
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      gap_keywords: asStringArray(priorAnalysis.gaps),
      prior_analysis: input.prior_analysis ?? null
    };

    const executed = await this.executeFlow({
      flow_type: "follow_up_questions",
      user_id: session.appUser.id,
      master_cv_id: input.master_cv_id,
      input_payload: flowInput,
      user_prompt: `Generate follow-up questions for ${input.job.job_title} at ${input.job.company_name}.`
    });

    return {
      ai_run_id: executed.ai_run.id,
      questions: asRecord(executed.output).questions ?? []
    };
  }

  async generateTailoredCvDraft(session: SessionContext, input: TailoredCvDraftInput) {
    await this.billingService.assertActionAllowed(session.appUser.id, "tailored_cv_generation");

    const masterCv = await this.requireMasterCv(session.appUser.id, input.master_cv_id);
    const validatedTemplateId =
      input.template_id !== undefined
        ? await this.templatesService.validateAssignableTemplateId(input.template_id)
        : undefined;
    const { tailoredCv, job } = await this.prepareDraftTarget(
      session.appUser.id,
      masterCv,
      input,
      validatedTemplateId
    );

    let result: {
      ai_run_id: string;
      tailored_cv: TailoredCvDraftSummary;
      job: TailoredCvDraftJobSummary;
      generation_metadata: {
        provider: string;
        model_name: string;
        flow_type: "tailored_draft";
        prompt_key: string;
        prompt_version: string;
        changed_block_ids: string[];
        generation_summary: string;
      };
    };

    try {
      const flowInput = {
        master_content: masterCv.current_content,
        master_cv_title: masterCv.title,
        master_cv_summary: masterCv.summary_text,
        job: input.job,
        answers: input.answers,
        language: input.language ?? tailoredCv.language
      };

      const executed = await this.executeFlow({
        flow_type: "tailored_draft",
        user_id: session.appUser.id,
        master_cv_id: masterCv.id,
        tailored_cv_id: tailoredCv.id,
        job_id: job.id,
        input_payload: flowInput,
        user_prompt: `Generate a tailored draft for ${input.job.job_title} at ${input.job.company_name}.`
      });

      const normalizedContent = normalizeCvContent(
        asRecord(executed.output).current_content,
        input.language ?? tailoredCv.language
      );

      this.assertTailoredDraftSemanticContent(normalizedContent);

      const updatedTailoredCv = await this.tailoredCvRepository.updateById(session.appUser.id, tailoredCv.id, {
        current_content: normalizedContent,
        language: normalizedContent.language,
        template_id: validatedTemplateId !== undefined ? validatedTemplateId : tailoredCv.template_id,
        ai_generation_status: "completed",
        job_id: job.id
      });

      if (!updatedTailoredCv) {
        throw new NotFoundError("Tailored CV was not found");
      }

      const linkedJob = await this.ensureJobLinked(session.appUser.id, updatedTailoredCv.id, job);

      result = {
        ai_run_id: executed.ai_run.id,
        tailored_cv: this.toTailoredDraftSummary(updatedTailoredCv),
        job: this.toDraftJobSummary(linkedJob),
        generation_metadata: {
          provider: executed.provider,
          model_name: executed.model_name,
          flow_type: "tailored_draft",
          prompt_key: executed.prompt_key,
          prompt_version: executed.prompt_version,
          changed_block_ids: asStringArray(asRecord(executed.output).changed_block_ids),
          generation_summary: String(asRecord(executed.output).generation_summary ?? "")
        }
      };
    } catch (error) {
      await this.tailoredCvRepository.updateById(session.appUser.id, tailoredCv.id, {
        ai_generation_status: "failed"
      });
      throw error;
    }

    await this.billingService.recordTailoredCvGenerationUsage(session.appUser.id);

    return result;
  }

  async improveImportedContent(
    session: SessionContext,
    input: ImportImproveInput
  ): Promise<ImportImproveResponse> {
    await this.billingService.assertActionAllowed(session.appUser.id, "ai_action");

    const normalizedContent = normalizeCvContent(
      asRecord(input.parsed_content),
      input.language ?? "en"
    );

    const flowInput = {
      parsed_content: normalizedContent,
      language: normalizedContent.language,
      improvement_guidance: input.improvement_guidance ?? []
    };

    const executed = await this.executeFlow({
      flow_type: "import_improve",
      user_id: session.appUser.id,
      input_payload: flowInput,
      user_prompt: "Improve imported CV content while preserving factual accuracy."
    });

    await this.billingService.recordAiActionUsage(session.appUser.id);

    const improvedContent = normalizeCvContent(
      asRecord(asRecord(executed.output).improved_content),
      normalizedContent.language
    );

    return {
      ai_run_id: executed.ai_run.id,
      improved_content: improvedContent,
      generation_summary: String(asRecord(executed.output).generation_summary ?? ""),
      changed_block_ids: asStringArray(asRecord(executed.output).changed_block_ids),
      generation_metadata: {
        provider: executed.provider,
        model_name: executed.model_name,
        flow_type: "import_improve",
        prompt_key: executed.prompt_key,
        prompt_version: executed.prompt_version
      }
    };
  }

  async parseCvContent(
    session: SessionContext,
    input: {
      raw_text: string;
      source_filename: string;
      mime_type: string;
      language_hint: string;
    }
  ): Promise<{
    ai_run_id: string;
    parsed_content: ReturnType<typeof cloneCvContent>;
    warnings: string[];
    generation_metadata: {
      provider: string;
      model_name: string;
      flow_type: "cv_parse";
      prompt_key: string;
      prompt_version: string;
    };
  }> {
    const flowInput = {
      raw_text: input.raw_text,
      source_filename: input.source_filename,
      mime_type: input.mime_type,
      language_hint: input.language_hint
    };

    const executed = await this.executeFlow({
      flow_type: "cv_parse",
      user_id: session.appUser.id,
      input_payload: flowInput,
      user_prompt: "Parse raw CV text and return canonical cv_content JSON."
    });

    const parsed = cvParseOutputSchema.parse(executed.output);
    const normalizedContent = normalizeCvContent(
      parsed.parsed_content,
      parsed.parsed_content.language || input.language_hint || "en"
    );

    return {
      ai_run_id: executed.ai_run.id,
      parsed_content: cloneCvContent(normalizedContent),
      warnings: asStringArray(parsed.warnings ?? []),
      generation_metadata: {
        provider: executed.provider,
        model_name: executed.model_name,
        flow_type: "cv_parse",
        prompt_key: executed.prompt_key,
        prompt_version: executed.prompt_version
      }
    };
  }

  async generateCoverLetter(
    session: SessionContext,
    input: import("./ai.types").CoverLetterGenerationInput
  ): Promise<import("./ai.types").CoverLetterGenerationResult> {
    await this.billingService.assertActionAllowed(session.appUser.id, "ai_action");

    let cvContent;
    let actualMasterCvId = input.master_cv_id;

    if (input.tailored_cv_id) {
      const tailoredCv = await this.tailoredCvRepository.findById(session.appUser.id, input.tailored_cv_id);
      if (!tailoredCv || tailoredCv.is_deleted) {
        throw new NotFoundError("Tailored CV not found");
      }
      cvContent = tailoredCv.current_content;
      actualMasterCvId = tailoredCv.master_cv_id;
    } else if (input.master_cv_id) {
      const masterCv = await this.masterCvRepository.findById(session.appUser.id, input.master_cv_id);
      if (!masterCv || masterCv.is_deleted) {
        throw new NotFoundError("Master CV not found");
      }
      cvContent = masterCv.current_content;
    } else {
      throw new InternalServerError("Either master_cv_id or tailored_cv_id is required");
    }

    const flowInput = {
      job_title: input.job_title,
      company_name: input.company_name,
      job_description: input.job_description ?? "",
      cv_content: cvContent,
      tone: input.tone ?? "professional",
      additional_instructions: input.additional_instructions ?? ""
    };

    const executed = await this.executeFlow({
      flow_type: "cover_letter_generation",
      user_id: session.appUser.id,
      master_cv_id: actualMasterCvId,
      tailored_cv_id: input.tailored_cv_id ?? null,
      input_payload: flowInput,
      user_prompt: `Generate a cover letter for the role of ${input.job_title} at ${input.company_name}.`
    });

    await this.billingService.recordAiActionUsage(session.appUser.id);

    const output = asRecord(executed.output);

    return {
      title: String(output.title ?? `Cover Letter - ${input.company_name}`),
      content: String(output.content ?? "")
    };
  }

  async suggestBlock(session: SessionContext, input: BlockSuggestInput) {
    await this.billingService.assertActionAllowed(session.appUser.id, "ai_action");

    const target = await this.resolveAiBlockTarget(session.appUser.id, input);
    const currentBlock = findBlockInCvContent(target.current_content, input.block_id);

    const optionCount = input.action_type === "options" ? 3 : 1;

    const executed = await this.executeFlow({
      flow_type: "block_suggest",
      action_type: input.action_type,
      user_id: session.appUser.id,
      master_cv_id: target.cv_kind === "master" ? target.cv_id : null,
      tailored_cv_id: target.cv_kind === "tailored" ? target.cv_id : null,
      job_id: target.linked_job?.id ?? null,
      input_payload: {
        action_type: input.action_type,
        block: currentBlock.block,
        user_instruction: input.user_instruction ?? "",
        job_description: target.linked_job?.job_description ?? "",
        option_count: optionCount
      },
      user_prompt: `Suggest a ${input.action_type} update for block ${input.block_id}.`
    });

    const output = asRecord(executed.output);
    const outputSuggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((item) => asRecord(item))
      : [];

    const optionGroupKey = input.action_type === "options" ? randomUUID() : null;

    const persistedSuggestions = await this.aiRepository.createSuggestions(
      outputSuggestions.map((variant) => ({
        ai_run_id: executed.ai_run.id,
        user_id: session.appUser.id,
        master_cv_id: target.cv_kind === "master" ? target.cv_id : null,
        tailored_cv_id: target.cv_kind === "tailored" ? target.cv_id : null,
        block_id: input.block_id,
        action_type: input.action_type,
        before_content: asRecord(currentBlock.block),
        suggested_content: asRecord(variant.suggested_block),
        option_group_key: optionGroupKey
      }))
    );

    await this.billingService.recordAiActionUsage(session.appUser.id);

    return {
      ai_run_id: executed.ai_run.id,
      suggestion_ids: persistedSuggestions.map((item) => item.id),
      suggestions: persistedSuggestions.map((item, index) => ({
        ...this.toSuggestionSummary(item),
        before_content: item.before_content,
        suggested_content: item.suggested_content,
        rationale: String(outputSuggestions[index]?.rationale ?? "")
      }))
    };
  }

  async compareBlock(session: SessionContext, input: BlockCompareInput) {
    const tailoredCv = await this.requireTailoredCv(session.appUser.id, input.tailored_cv_id);
    const currentBlock = findBlockInCvContent(tailoredCv.current_content, input.block_id);
    const linkedJob = await this.loadLinkedJob(session.appUser.id, tailoredCv);

    if (!linkedJob) {
      throw new NotFoundError("Linked job context was not found for this tailored CV");
    }

    const blockFields = asRecord(currentBlock.block.fields);
    const blockText = Object.values(blockFields)
      .map((value) => (typeof value === "string" ? value : ""))
      .filter(Boolean)
      .join(" ")
      .trim();

    const executed = await this.executeFlow<BlockCompareResult>({
      flow_type: "block_compare",
      user_id: session.appUser.id,
      tailored_cv_id: tailoredCv.id,
      job_id: linkedJob.id,
      input_payload: {
        block_id: currentBlock.block.id,
        block_text: blockText,
        block: currentBlock.block,
        job_title: linkedJob.job_title,
        company_name: linkedJob.company_name,
        job_description: linkedJob.job_description
      },
      user_prompt: `Compare block ${input.block_id} to job requirements.`
    });

    return {
      ai_run_id: executed.ai_run.id,
      ...executed.output
    };
  }

  async generateBlockOptions(session: SessionContext, input: BlockOptionsInput) {
    await this.billingService.assertActionAllowed(session.appUser.id, "ai_action");

    const target = await this.resolveAiBlockTarget(session.appUser.id, input);
    const currentBlock = findBlockInCvContent(target.current_content, input.block_id);
    const optionCount = input.option_count ?? 3;

    const executed = await this.executeFlow({
      flow_type: "multi_option",
      action_type: "options",
      user_id: session.appUser.id,
      master_cv_id: target.cv_kind === "master" ? target.cv_id : null,
      tailored_cv_id: target.cv_kind === "tailored" ? target.cv_id : null,
      job_id: target.linked_job?.id ?? null,
      input_payload: {
        action_type: "options",
        option_count: optionCount,
        block: currentBlock.block,
        user_instruction: input.user_instruction ?? "",
        job_description: target.linked_job?.job_description ?? ""
      },
      user_prompt: `Generate ${optionCount} options for block ${input.block_id}.`
    });

    const output = asRecord(executed.output);
    const outputSuggestions = Array.isArray(output.suggestions)
      ? output.suggestions.map((item) => asRecord(item))
      : [];

    const optionGroupKey = randomUUID();

    const persisted = await this.aiRepository.createSuggestions(
      outputSuggestions.map((variant) => ({
        ai_run_id: executed.ai_run.id,
        user_id: session.appUser.id,
        master_cv_id: target.cv_kind === "master" ? target.cv_id : null,
        tailored_cv_id: target.cv_kind === "tailored" ? target.cv_id : null,
        block_id: input.block_id,
        action_type: "options",
        before_content: asRecord(currentBlock.block),
        suggested_content: asRecord(variant.suggested_block),
        option_group_key: optionGroupKey
      }))
    );

    await this.billingService.recordAiActionUsage(session.appUser.id);

    return {
      ai_run_id: executed.ai_run.id,
      option_group_key: optionGroupKey,
      suggestions: persisted.map((item, index) => ({
        ...this.toSuggestionSummary(item),
        before_content: item.before_content,
        suggested_content: item.suggested_content,
        rationale: String(outputSuggestions[index]?.rationale ?? "")
      }))
    };
  }

  async getSuggestion(session: SessionContext, suggestionId: string): Promise<AiSuggestionDetail> {
    const suggestion = await this.requireSuggestion(session.appUser.id, suggestionId);
    return this.toSuggestionDetail(suggestion);
  }

  async applySuggestion(
    session: SessionContext,
    suggestionId: string
  ): Promise<SuggestionApplyResponse> {
    const suggestion = await this.requireSuggestion(session.appUser.id, suggestionId);

    if (suggestion.status !== "pending") {
      throw new SuggestionNotApplicableError("Only pending suggestions can be applied", {
        suggestion_id: suggestion.id,
        status: suggestion.status
      });
    }

    if (!suggestion.block_id) {
      throw new SuggestionNotApplicableError("Suggestion does not target a block", {
        suggestion_id: suggestion.id
      });
    }

    const target = await this.resolveSuggestionTargetCv(session.appUser.id, suggestion);
    const current = findBlockInCvContent(target.current_content, suggestion.block_id);

    if (suggestion.before_content) {
      const normalizedBefore = normalizeCvBlock(suggestion.before_content, current.block);
      if (stableStringify(normalizedBefore) !== stableStringify(current.block)) {
        throw new SuggestionNotApplicableError(
          "Current block content changed since suggestion generation",
          {
            suggestion_id: suggestion.id,
            block_id: suggestion.block_id
          }
        );
      }
    }

    const suggestedBlock = normalizeCvBlock(suggestion.suggested_content, current.block);
    const replacement = replaceBlockInCvContent(
      target.current_content,
      suggestion.block_id,
      suggestedBlock
    );
    if (target.cv_kind === "tailored") {
      const updatedTailoredCv = await this.tailoredCvRepository.updateById(
        session.appUser.id,
        target.cv_id,
        {
          current_content: replacement.content
        }
      );

      if (!updatedTailoredCv) {
        throw new NotFoundError("Tailored CV was not found");
      }

      await this.cvRevisionsService.createTailoredBlockRevision({
        user_id: session.appUser.id,
        tailored_cv_id: updatedTailoredCv.id,
        block: replacement.updated_block,
        change_source: "ai",
        ai_suggestion_id: suggestion.id,
        created_by_user_id: session.appUser.id
      });
    } else {
      const updatedMasterCv = await this.masterCvRepository.updateById(session.appUser.id, target.cv_id, {
        current_content: replacement.content,
        summary_text: buildCvSummaryText(replacement.content)
      });

      if (!updatedMasterCv) {
        throw new NotFoundError("Master CV was not found");
      }
    }

    const applied = await this.aiRepository.updateSuggestionById(
      session.appUser.id,
      suggestion.id,
      {
        status: "applied",
        applied_at: new Date().toISOString()
      },
      {
        expected_status: "pending"
      }
    );

    if (!applied) {
      throw new SuggestionNotApplicableError("Suggestion could not be marked as applied", {
        suggestion_id: suggestion.id
      });
    }

    return {
      suggestion: this.toSuggestionSummary(applied),
      cv_kind: target.cv_kind,
      master_cv_id: target.cv_kind === "master" ? target.cv_id : null,
      tailored_cv_id: target.cv_kind === "tailored" ? target.cv_id : null,
      updated_block: replacement.updated_block,
      section_id: replacement.section_id
    };
  }

  async rejectSuggestion(session: SessionContext, suggestionId: string): Promise<SuggestionRejectResponse> {
    const suggestion = await this.requireSuggestion(session.appUser.id, suggestionId);

    if (suggestion.status !== "pending") {
      throw new SuggestionNotApplicableError("Only pending suggestions can be rejected", {
        suggestion_id: suggestion.id,
        status: suggestion.status
      });
    }

    const rejected = await this.aiRepository.updateSuggestionById(
      session.appUser.id,
      suggestion.id,
      {
        status: "rejected",
        applied_at: null
      },
      {
        expected_status: "pending"
      }
    );

    if (!rejected) {
      throw new SuggestionNotApplicableError("Suggestion could not be rejected", {
        suggestion_id: suggestion.id
      });
    }

    return {
      suggestion_id: rejected.id,
      status: rejected.status
    };
  }

  async getTailoredCvAiHistory(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<CvAiHistoryResponse> {
    await this.requireTailoredCv(session.appUser.id, tailoredCvId);

    const [runs, suggestions] = await Promise.all([
      this.aiRepository.listRunsByTailoredCv(session.appUser.id, tailoredCvId, 40),
      this.aiRepository.listSuggestionsByTailoredCv(session.appUser.id, tailoredCvId, 60)
    ]);

    return {
      cv_kind: "tailored",
      master_cv_id: null,
      tailored_cv_id: tailoredCvId,
      ai_runs: runs.map((row) => this.toRunSummary(row)),
      suggestions: suggestions.map((row) => this.toSuggestionSummary(row))
    };
  }

  async getMasterCvAiHistory(session: SessionContext, masterCvId: string): Promise<CvAiHistoryResponse> {
    await this.requireMasterCv(session.appUser.id, masterCvId);

    const [runs, suggestions] = await Promise.all([
      this.aiRepository.listRunsByMasterCv(session.appUser.id, masterCvId, 40),
      this.aiRepository.listSuggestionsByMasterCv(session.appUser.id, masterCvId, 60)
    ]);

    return {
      cv_kind: "master",
      master_cv_id: masterCvId,
      tailored_cv_id: null,
      ai_runs: runs.map((row) => this.toRunSummary(row)),
      suggestions: suggestions.map((row) => this.toSuggestionSummary(row))
    };
  }

  async getTailoredCvAiBlockVersions(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<CvAiBlockVersionsResponse> {
    const tailoredCv = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const suggestions = await this.aiRepository.listAppliedSuggestionsByTailoredCv(
      session.appUser.id,
      tailoredCvId
    );

    return {
      cv_kind: "tailored",
      master_cv_id: null,
      tailored_cv_id: tailoredCvId,
      blocks: this.buildBlockVersionChains(suggestions, tailoredCv.current_content)
    };
  }

  async getMasterCvAiBlockVersions(
    session: SessionContext,
    masterCvId: string
  ): Promise<CvAiBlockVersionsResponse> {
    const masterCv = await this.requireMasterCv(session.appUser.id, masterCvId);
    const suggestions = await this.aiRepository.listAppliedSuggestionsByMasterCv(
      session.appUser.id,
      masterCvId
    );

    return {
      cv_kind: "master",
      master_cv_id: masterCvId,
      tailored_cv_id: null,
      blocks: this.buildBlockVersionChains(suggestions, masterCv.current_content)
    };
  }

  private async executeFlow<TOutput>(
    options: ExecuteFlowOptions
  ): Promise<ExecuteFlowResult<TOutput>> {
    const prompt = await this.resolvePromptForFlow({
      flow_type: options.flow_type,
      action_type: options.action_type ?? null,
      user_prompt: options.user_prompt
    });

    const aiRun = await this.aiRepository.createRun({
      user_id: options.user_id,
      flow_type: options.flow_type,
      provider: this.aiProvider.providerName,
      model_name: prompt.model_name,
      master_cv_id: options.master_cv_id ?? null,
      tailored_cv_id: options.tailored_cv_id ?? null,
      job_id: options.job_id ?? null,
      progress_stage: "queued",
      input_payload: {
        flow_input: options.input_payload,
        prompt: {
          prompt_key: prompt.prompt_key,
          prompt_version: prompt.prompt_version,
          provider: this.aiProvider.providerName,
          model_name: prompt.model_name,
          user_prompt: prompt.user_prompt,
          system_prompt: prompt.system_prompt
        }
      }
    });
    try {
      const executed = await this.executeRunFlow({
        user_id: options.user_id,
        ai_run_id: aiRun.id,
        flow_type: options.flow_type,
        prompt,
        input_payload: options.input_payload
      });
      const completed = await this.completeRunWithPayload(
        options.user_id,
        aiRun.id,
        executed.output_payload,
        executed.token_usage
      );

      return {
        ai_run: completed,
        output: executed.output_payload as TOutput,
        provider: executed.provider,
        model_name: executed.model_name,
        prompt_key: prompt.prompt_key,
        prompt_version: prompt.prompt_version
      };
    } catch (error) {
      await this.failRunBestEffort(options.user_id, aiRun.id, error);
      throw error;
    }
  }

  private async executeTailoringJobAnalysisRun(
    userId: string,
    run: AiRunRecord,
    input: JobAnalysisInput,
    prompt: ResolvedPromptSnapshot
  ): Promise<AiRunRecord> {
    const masterCv = await this.requireMasterCv(userId, input.master_cv_id);
    const flowInput = {
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      master_cv_text: buildCvSummaryText(masterCv.current_content, 5000) ?? "",
      master_cv_summary: masterCv.summary_text
    };

    const executed = await this.executeRunFlow({
      user_id: userId,
      ai_run_id: run.id,
      flow_type: "job_analysis",
      prompt,
      input_payload: flowInput
    });

    const resultPayload: JobAnalysisResult = {
      keywords: asStringArray(asRecord(executed.output_payload).keywords),
      requirements: asStringArray(asRecord(executed.output_payload).requirements),
      strengths: asStringArray(asRecord(executed.output_payload).strengths),
      gaps: asStringArray(asRecord(executed.output_payload).gaps),
      summary: String(asRecord(executed.output_payload).summary ?? ""),
      fit_score:
        typeof asRecord(executed.output_payload).fit_score === "number"
          ? Number(asRecord(executed.output_payload).fit_score)
          : null
    };

    return this.completeRunWithPayload(
      userId,
      run.id,
      resultPayload as unknown as Record<string, unknown>,
      executed.token_usage
    );
  }

  private async executeTailoringFollowUpQuestionsRun(
    userId: string,
    run: AiRunRecord,
    input: FollowUpQuestionsInput,
    prompt: ResolvedPromptSnapshot
  ): Promise<AiRunRecord> {
    await this.requireMasterCv(userId, input.master_cv_id);
    const priorAnalysis = asRecord(input.prior_analysis);
    const flowInput = {
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      gap_keywords: asStringArray(priorAnalysis.gaps),
      prior_analysis: input.prior_analysis ?? null
    };

    const executed = await this.executeRunFlow({
      user_id: userId,
      ai_run_id: run.id,
      flow_type: "follow_up_questions",
      prompt,
      input_payload: flowInput
    });

    const resultPayload: FollowUpQuestionsResult = {
      questions: Array.isArray(asRecord(executed.output_payload).questions)
        ? (asRecord(executed.output_payload).questions as FollowUpQuestionsResult["questions"])
        : []
    };

    return this.completeRunWithPayload(
      userId,
      run.id,
      resultPayload as unknown as Record<string, unknown>,
      executed.token_usage
    );
  }

  private async executeTailoringDraftRun(
    userId: string,
    run: AiRunRecord,
    input: TailoredCvDraftInput,
    prompt: ResolvedPromptSnapshot
  ): Promise<AiRunRecord> {
    await this.billingService.assertActionAllowed(userId, "tailored_cv_generation");
    const masterCv = await this.requireMasterCv(userId, input.master_cv_id);

    const persistedRuntime = asRecord(asRecord(run.input_payload).runtime);
    const persistedTemplateId = persistedRuntime.validated_template_id;
    const validatedTemplateId =
      typeof persistedTemplateId === "string" || persistedTemplateId === null
        ? persistedTemplateId
        : input.template_id !== undefined
          ? await this.templatesService.validateAssignableTemplateId(input.template_id)
          : undefined;

    const { tailoredCv, job } = await this.prepareDraftTarget(
      userId,
      masterCv,
      input,
      validatedTemplateId
    );

    await this.aiRepository.updateRunContext(userId, run.id, {
      master_cv_id: masterCv.id,
      tailored_cv_id: tailoredCv.id,
      job_id: job.id
    });

    try {
      const flowInput = {
        master_content: masterCv.current_content,
        master_cv_title: masterCv.title,
        master_cv_summary: masterCv.summary_text,
        job: input.job,
        answers: input.answers,
        language: input.language ?? tailoredCv.language
      };

      const executed = await this.executeRunFlow({
        user_id: userId,
        ai_run_id: run.id,
        flow_type: "tailored_draft",
        prompt,
        input_payload: flowInput
      });

      const output = asRecord(executed.output_payload);
      const normalizedContent = normalizeCvContent(
        asRecord(output.current_content),
        input.language ?? tailoredCv.language
      );

      this.assertTailoredDraftSemanticContent(normalizedContent);

      const updatedTailoredCv = await this.tailoredCvRepository.updateById(userId, tailoredCv.id, {
        current_content: normalizedContent,
        language: normalizedContent.language,
        template_id: validatedTemplateId !== undefined ? validatedTemplateId : tailoredCv.template_id,
        ai_generation_status: "completed",
        job_id: job.id
      });

      if (!updatedTailoredCv) {
        throw new NotFoundError("Tailored CV was not found");
      }

      const linkedJob = await this.ensureJobLinked(userId, updatedTailoredCv.id, job);
      const resultPayload = {
        tailored_cv: this.toTailoredDraftSummary(updatedTailoredCv),
        job: this.toDraftJobSummary(linkedJob),
        generation_metadata: {
          provider: executed.provider,
          model_name: executed.model_name,
          flow_type: "tailored_draft" as const,
          prompt_key: prompt.prompt_key,
          prompt_version: prompt.prompt_version,
          changed_block_ids: asStringArray(output.changed_block_ids),
          generation_summary: String(output.generation_summary ?? "")
        }
      };

      const { run: completed, claimed_completion } = await this.tryCompleteRun(
        userId,
        run.id,
        resultPayload,
        executed.token_usage
      );
      if (claimed_completion) {
        await this.billingService.recordTailoredCvGenerationUsage(userId);
      }
      return completed;
    } catch (error) {
      await this.tailoredCvRepository.updateById(userId, tailoredCv.id, {
        ai_generation_status: "failed"
      });
      throw error;
    }
  }

  private async executeRunFlow(options: RunFlowExecutionOptions): Promise<RunFlowExecutionResult> {
    const definition = AI_FLOW_REGISTRY[options.flow_type];

    await this.updateRunStage(options.user_id, options.ai_run_id, "building_prompt");
    await this.updateRunStage(options.user_id, options.ai_run_id, "calling_model");

    let providerResult;
    try {
      providerResult = await this.aiProvider.generate({
        flow_type: options.flow_type,
        model_name: options.prompt.model_name,
        prompt: {
          prompt_key: options.prompt.prompt_key,
          prompt_version: options.prompt.prompt_version,
          system_prompt: options.prompt.system_prompt,
          user_prompt: options.prompt.user_prompt
        },
        output_schema: definition.output_schema,
        input_payload: options.input_payload,
        onStage: async () => {
          await this.updateRunStage(options.user_id, options.ai_run_id, "parsing_output");
        }
      });
    } catch (error) {
      await this.failRunWithDiagnostics(options.user_id, options.ai_run_id, error);

      if (error instanceof AiProviderError) {
        throw error;
      }

      throw new AiFlowFailedError("AI flow execution failed", { flow_type: options.flow_type });
    }

    const outputPayloadForValidation =
      options.flow_type === "tailored_draft"
        ? coerceTailoredDraftOutputPayload(asRecord(providerResult.output_payload))
        : providerResult.output_payload;

    await this.updateRunStage(options.user_id, options.ai_run_id, "validating_output");
    const parsed = definition.output_schema.safeParse(outputPayloadForValidation);
    if (!parsed.success) {
      const validationDetails = parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join(".") || "root",
        message: issue.message
      }));
      const validationMessage = `Structured output validation failed: ${validationDetails
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`;

      await this.aiRepository.failRun(options.user_id, options.ai_run_id, validationMessage.slice(0, 2000), {
        error_name: "AiFlowFailedError",
        reason: "output_contract_invalid",
        stage: "validating_output",
        flow_type: options.flow_type,
        validation_errors: validationDetails
      });

      throw new AiFlowFailedError("AI output did not match required contract", {
        flow_type: options.flow_type,
        reason: "output_contract_invalid",
        validation_errors: validationDetails
      });
    }

    const serializedOutput = z.record(z.unknown()).parse(parsed.data);
    return {
      output_payload: serializedOutput,
      provider: providerResult.provider,
      model_name: providerResult.model_name,
      token_usage: providerResult.usage ?? null
    };
  }

  private async resolvePromptForFlow(options: {
    flow_type: AiFlowType;
    action_type: AiSuggestionActionType | null;
    user_prompt: string;
  }): Promise<ResolvedPromptSnapshot> {
    const definition = AI_FLOW_REGISTRY[options.flow_type];
    const modelName = this.aiProvider.resolveModelName(options.flow_type);
    const resolvedPrompt = await this.promptResolver.resolve({
      flow_type: options.flow_type,
      provider: this.aiProvider.providerName,
      action_type: options.action_type,
      fallback: {
        prompt_key: definition.prompt_key,
        prompt_version: definition.prompt_version,
        system_prompt: definition.system_prompt,
        model_name: modelName
      }
    });

    return {
      prompt_key: resolvedPrompt.prompt_key,
      prompt_version: resolvedPrompt.prompt_version,
      system_prompt: resolvedPrompt.system_prompt,
      user_prompt: resolvedPrompt.user_prompt_template?.trim() || options.user_prompt,
      model_name: modelName
    };
  }

  private async resolveStoredRunPrompt(
    run: AiRunRecord,
    input: TailoringRunInputPayload
  ): Promise<ResolvedPromptSnapshot> {
    const promptPayload = asRecord(asRecord(run.input_payload).prompt);
    const promptKey =
      typeof promptPayload.prompt_key === "string" ? promptPayload.prompt_key.trim() : "";
    const promptVersion =
      typeof promptPayload.prompt_version === "string" ? promptPayload.prompt_version.trim() : "";
    const systemPrompt =
      typeof promptPayload.system_prompt === "string" ? promptPayload.system_prompt : "";
    const userPrompt = typeof promptPayload.user_prompt === "string" ? promptPayload.user_prompt : "";
    const modelName = typeof promptPayload.model_name === "string" ? promptPayload.model_name : "";

    if (promptKey && promptVersion && systemPrompt && userPrompt && modelName) {
      return {
        prompt_key: promptKey,
        prompt_version: promptVersion,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        model_name: modelName
      };
    }

    return this.resolvePromptForFlow({
      flow_type: run.flow_type,
      action_type: null,
      user_prompt: this.buildTailoringUserPrompt(run.flow_type as TailoringRunFlowType, input)
    });
  }

  private async completeRunWithPayload(
    userId: string,
    runId: string,
    outputPayload: Record<string, unknown>,
    tokenUsage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    } | null = null
  ): Promise<AiRunRecord> {
    const result = await this.tryCompleteRun(userId, runId, outputPayload, tokenUsage);
    return result.run;
  }

  private async tryCompleteRun(
    userId: string,
    runId: string,
    outputPayload: Record<string, unknown>,
    tokenUsage: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    } | null = null
  ): Promise<{ run: AiRunRecord; claimed_completion: boolean }> {
    await this.updateRunStage(userId, runId, "persisting_result");
    const completed = await this.aiRepository.completeRun(userId, runId, outputPayload, tokenUsage);
    if (completed) {
      return { run: completed, claimed_completion: true };
    }

    // Run was no longer pending — watchdog or duplicate execute already finalized it.
    const current = await this.aiRepository.findRunById(userId, runId);
    if (!current) {
      throw new NotFoundError("AI run was not found after completion");
    }
    return { run: current, claimed_completion: false };
  }

  private async failRunWithDiagnostics(
    userId: string,
    runId: string,
    error: unknown
  ): Promise<void> {
    const message = toPersistableAiRunError(error).slice(0, 2000);
    const debugPayload = toPersistableAiRunDebugPayload(error);
    await this.aiRepository.failRun(userId, runId, message, debugPayload);
  }

  private async failRunBestEffort(userId: string, runId: string, error: unknown): Promise<void> {
    try {
      await this.failRunWithDiagnostics(userId, runId, error);
    } catch {
      // Keep the original error path; watchdog will still sweep stale pending runs.
    }
  }

  private assertTailoredDraftSemanticContent(content: TailoredCvRecord["current_content"]): void {
    const semantic = evaluateTailoredDraftSemanticContent(content);
    if (semantic.is_valid) {
      return;
    }

    throw new AiFlowFailedError(
      "The AI could not generate a meaningful tailored CV output from the provided context. Please revise job context or answers and try again.",
      {
        flow_type: "tailored_draft",
        reason: "output_semantically_empty",
        semantic_stats: semantic.stats
      }
    );
  }

  private async updateRunStage(
    userId: string,
    runId: string,
    progressStage: AiRunProgressStage
  ): Promise<void> {
    await this.aiRepository.updateRunProgressStage(userId, runId, progressStage);
  }

  private parseTailoringRunInput(
    flowType: TailoringRunFlowType,
    payload: unknown
  ): TailoringRunInputPayload {
    if (flowType === "job_analysis") {
      const parsed = aiJobAnalysisSchema.safeParse(payload);
      if (parsed.success) {
        return parsed.data;
      }
      throw new InternalServerError("Stored job analysis input is invalid", {
        flow_type: flowType,
        issues: parsed.error.issues
      });
    }

    if (flowType === "follow_up_questions") {
      const parsed = aiFollowUpQuestionsSchema.safeParse(payload);
      if (parsed.success) {
        return parsed.data;
      }
      throw new InternalServerError("Stored follow-up input is invalid", {
        flow_type: flowType,
        issues: parsed.error.issues
      });
    }

    const parsed = aiTailoredDraftSchema.safeParse(payload);
    if (parsed.success) {
      return parsed.data;
    }
    throw new InternalServerError("Stored tailored draft input is invalid", {
      flow_type: flowType,
      issues: parsed.error.issues
    });
  }

  private readRunFlowInput(run: AiRunRecord): Record<string, unknown> {
    const payload = asRecord(run.input_payload);
    const flowInput = asRecord(payload.flow_input);
    if (Object.keys(flowInput).length === 0) {
      throw new InternalServerError("AI run is missing flow input payload", {
        ai_run_id: run.id,
        flow_type: run.flow_type
      });
    }
    return flowInput;
  }

  private extractRunTargetContext(input: TailoringRunInputPayload): {
    master_cv_id: string | null;
    tailored_cv_id: string | null;
    job_id: string | null;
  } {
    if ("master_cv_id" in input) {
      return {
        master_cv_id: input.master_cv_id,
        tailored_cv_id: "tailored_cv_id" in input ? input.tailored_cv_id ?? null : null,
        job_id: null
      };
    }

    return {
      master_cv_id: null,
      tailored_cv_id: null,
      job_id: null
    };
  }

  private async assertTailoringRunInput(
    userId: string,
    flowType: TailoringRunFlowType,
    payload: TailoringRunInputPayload
  ): Promise<{ validated_template_id?: string | null }> {
    if (flowType === "job_analysis") {
      await this.requireMasterCv(userId, (payload as JobAnalysisInput).master_cv_id);
      return {};
    }

    if (flowType === "follow_up_questions") {
      await this.requireMasterCv(userId, (payload as FollowUpQuestionsInput).master_cv_id);
      return {};
    }

    const draftInput = payload as TailoredCvDraftInput;
    await this.billingService.assertActionAllowed(userId, "tailored_cv_generation");
    await this.requireMasterCv(userId, draftInput.master_cv_id);

    if (draftInput.template_id !== undefined) {
      const validatedTemplateId = await this.templatesService.validateAssignableTemplateId(
        draftInput.template_id
      );
      return {
        validated_template_id: validatedTemplateId
      };
    }

    return {};
  }

  private buildTailoringUserPrompt(
    flowType: TailoringRunFlowType,
    payload: TailoringRunInputPayload
  ): string {
    if (flowType === "job_analysis") {
      const input = payload as JobAnalysisInput;
      return `Analyze role fit for ${input.job.job_title} at ${input.job.company_name}.`;
    }

    if (flowType === "follow_up_questions") {
      const input = payload as FollowUpQuestionsInput;
      return `Generate follow-up questions for ${input.job.job_title} at ${input.job.company_name}.`;
    }

    const input = payload as TailoredCvDraftInput;
    return `Generate a tailored draft for ${input.job.job_title} at ${input.job.company_name}.`;
  }

  private async requireTailoringRun(userId: string, aiRunId: string): Promise<AiRunRecord> {
    const run = await this.aiRepository.findRunById(userId, aiRunId);
    if (!run || !TAILORING_FLOW_TYPES.includes(run.flow_type as TailoringRunFlowType)) {
      throw new NotFoundError("Tailoring AI run was not found");
    }
    return run;
  }

  private toTailoringRunExecuteResponse(run: AiRunRecord): TailoringRunExecuteResponse {
    return {
      ai_run_id: run.id,
      flow_type: run.flow_type as TailoringRunFlowType,
      status: run.status,
      progress_stage: run.progress_stage
    };
  }

  private async resolveAiBlockTarget(
    userId: string,
    input: Pick<BlockSuggestInput, "master_cv_id" | "tailored_cv_id">
  ): Promise<AiBlockTargetContext> {
    if (input.master_cv_id) {
      const masterCv = await this.requireMasterCv(userId, input.master_cv_id);
      return {
        cv_kind: "master",
        cv_id: masterCv.id,
        current_content: masterCv.current_content,
        linked_job: null
      };
    }

    if (input.tailored_cv_id) {
      const tailoredCv = await this.requireTailoredCv(userId, input.tailored_cv_id);
      const linkedJob = await this.loadLinkedJob(userId, tailoredCv);
      return {
        cv_kind: "tailored",
        cv_id: tailoredCv.id,
        current_content: tailoredCv.current_content,
        linked_job: linkedJob
      };
    }

    throw new ConflictError("AI block target is missing");
  }

  private async resolveSuggestionTargetCv(
    userId: string,
    suggestion: AiSuggestionRecord
  ): Promise<AiBlockTargetContext> {
    if (suggestion.master_cv_id) {
      const masterCv = await this.requireMasterCv(userId, suggestion.master_cv_id);
      return {
        cv_kind: "master",
        cv_id: masterCv.id,
        current_content: masterCv.current_content,
        linked_job: null
      };
    }

    if (suggestion.tailored_cv_id) {
      const tailoredCv = await this.requireTailoredCv(userId, suggestion.tailored_cv_id);
      const linkedJob = await this.loadLinkedJob(userId, tailoredCv);
      return {
        cv_kind: "tailored",
        cv_id: tailoredCv.id,
        current_content: tailoredCv.current_content,
        linked_job: linkedJob
      };
    }

    throw new SuggestionNotApplicableError("Suggestion target CV is missing", {
      suggestion_id: suggestion.id
    });
  }

  private buildBlockVersionChains(
    appliedSuggestions: AiSuggestionRecord[],
    currentContent: TailoredCvRecord["current_content"] | MasterCvRecord["current_content"]
  ): AiBlockVersionChain[] {
    const byBlock = new Map<string, AiSuggestionRecord[]>();

    for (const suggestion of appliedSuggestions) {
      if (!suggestion.block_id) {
        continue;
      }

      const list = byBlock.get(suggestion.block_id) ?? [];
      list.push(suggestion);
      byBlock.set(suggestion.block_id, list);
    }

    const result: AiBlockVersionChain[] = [];

    for (const [blockId, suggestions] of byBlock.entries()) {
      const versions: AiBlockVersionEntry[] = [];
      let aiVersionCount = 0;

      for (const suggestion of suggestions) {
        const before = suggestion.before_content ? asRecord(suggestion.before_content) : null;
        if (before) {
          if (versions.length === 0) {
            versions.push({
              source: "original",
              label: "Original",
              index: 0,
              created_at: suggestion.created_at,
              ai_suggestion_id: null,
              ai_run_id: null,
              content_snapshot: before
            });
          } else {
            const previous = versions[versions.length - 1];
            if (!snapshotsEqual(previous.content_snapshot, before)) {
              versions.push({
                source: "manual_pre_ai",
                label: "Manual edit",
                index: versions.length,
                created_at: suggestion.created_at,
                ai_suggestion_id: null,
                ai_run_id: null,
                content_snapshot: before
              });
            }
          }
        }

        const suggested = asRecord(suggestion.suggested_content);
        const previous = versions[versions.length - 1];
        if (!previous || !snapshotsEqual(previous.content_snapshot, suggested)) {
          aiVersionCount += 1;
          versions.push({
            source: "ai_applied",
            label: `AI v${aiVersionCount}`,
            index: versions.length,
            created_at: suggestion.created_at,
            ai_suggestion_id: suggestion.id,
            ai_run_id: suggestion.ai_run_id,
            content_snapshot: suggested
          });
        }
      }

      if (versions.length === 0) {
        continue;
      }

      let currentVersionIndex = versions.length - 1;
      try {
        const currentBlock = findBlockInCvContent(currentContent, blockId);
        const resolvedIndex = versions.findIndex((entry) =>
          snapshotsEqual(entry.content_snapshot, currentBlock.block)
        );
        if (resolvedIndex >= 0) {
          currentVersionIndex = resolvedIndex;
        }
      } catch {
        // Keep fallback index when block was removed.
      }

      result.push({
        block_id: blockId,
        current_version_index: currentVersionIndex,
        versions: versions.map((entry, index) => ({
          ...entry,
          index
        }))
      });
    }

    return result.sort((a, b) => a.block_id.localeCompare(b.block_id));
  }

  private async prepareDraftTarget(
    userId: string,
    masterCv: MasterCvRecord,
    input: TailoredCvDraftInput,
    validatedTemplateId?: string | null
  ): Promise<{ tailoredCv: TailoredCvRecord; job: JobRecord }> {
    if (input.tailored_cv_id) {
      const existingTailored = await this.requireTailoredCv(userId, input.tailored_cv_id);

      if (existingTailored.master_cv_id !== masterCv.id) {
        throw new ConflictError("tailored_cv_id does not belong to the provided master_cv_id", {
          tailored_cv_id: existingTailored.id,
          master_cv_id: masterCv.id
        });
      }

      const updatedTailored = await this.tailoredCvRepository.updateById(userId, existingTailored.id, {
        ai_generation_status: "pending",
        template_id:
          validatedTemplateId !== undefined ? validatedTemplateId : existingTailored.template_id,
        language: input.language ?? existingTailored.language
      });

      if (!updatedTailored) {
        throw new NotFoundError("Tailored CV was not found");
      }

      const job = await this.upsertDraftJob(userId, updatedTailored, input.job);

      return {
        tailoredCv: updatedTailored,
        job
      };
    }

    const createdJob = await this.jobsRepository.create({
      user_id: userId,
      tailored_cv_id: null,
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      job_posting_url: input.job.job_posting_url ?? null,
      location_text: input.job.location_text ?? null,
      notes: input.job.notes ?? null,
      status: "saved",
      applied_at: null
    });

    const clonedContent = cloneCvContent(masterCv.current_content);
    clonedContent.language = input.language ?? masterCv.language;

    const createdTailored = await this.tailoredCvRepository.create({
      user_id: userId,
      master_cv_id: masterCv.id,
      job_id: createdJob.id,
      title: `${masterCv.title} - ${input.job.company_name}`,
      language: clonedContent.language,
      template_id: validatedTemplateId !== undefined ? validatedTemplateId : masterCv.template_id,
      current_content: clonedContent,
      status: "draft",
      ai_generation_status: "pending",
      last_exported_at: null
    });

    const linkedJob = await this.jobsRepository.linkTailoredCv(userId, createdJob.id, createdTailored.id);

    return {
      tailoredCv: createdTailored,
      job: linkedJob ?? createdJob
    };
  }

  private async upsertDraftJob(
    userId: string,
    tailoredCv: TailoredCvRecord,
    jobInput: AiTailoredDraftJobPayload
  ) {
    if (!tailoredCv.job_id) {
      const createdJob = await this.jobsRepository.create({
        user_id: userId,
        tailored_cv_id: tailoredCv.id,
        company_name: jobInput.company_name,
        job_title: jobInput.job_title,
        job_description: jobInput.job_description,
        job_posting_url: jobInput.job_posting_url ?? null,
        location_text: jobInput.location_text ?? null,
        notes: jobInput.notes ?? null,
        status: "saved",
        applied_at: null
      });

      const updatedTailoredCv = await this.tailoredCvRepository.updateById(userId, tailoredCv.id, {
        job_id: createdJob.id
      });

      if (!updatedTailoredCv) {
        throw new NotFoundError("Tailored CV was not found");
      }

      return createdJob;
    }

    const updatedJob = await this.jobsRepository.updateById(userId, tailoredCv.job_id, {
      company_name: jobInput.company_name,
      job_title: jobInput.job_title,
      job_description: jobInput.job_description,
      job_posting_url: jobInput.job_posting_url ?? null,
      location_text: jobInput.location_text ?? null,
      notes: jobInput.notes ?? null
    });

    if (!updatedJob) {
      throw new NotFoundError("Linked job was not found");
    }

    return this.ensureJobLinked(userId, tailoredCv.id, updatedJob);
  }

  private async ensureJobLinked(userId: string, tailoredCvId: string, job: JobRecord): Promise<JobRecord> {
    if (job.tailored_cv_id === tailoredCvId) {
      return job;
    }

    const linked = await this.jobsRepository.linkTailoredCv(userId, job.id, tailoredCvId);
    return linked ?? job;
  }

  private async loadLinkedJob(userId: string, tailoredCv: TailoredCvRecord): Promise<JobRecord | null> {
    if (!tailoredCv.job_id) {
      return null;
    }

    return this.jobsRepository.findById(userId, tailoredCv.job_id);
  }

  private async requireMasterCv(userId: string, masterCvId: string): Promise<MasterCvRecord> {
    const masterCv = await this.masterCvRepository.findById(userId, masterCvId);

    if (!masterCv) {
      throw new NotFoundError("Master CV was not found");
    }

    return masterCv;
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string): Promise<TailoredCvRecord> {
    const tailoredCv = await this.tailoredCvRepository.findById(userId, tailoredCvId);

    if (!tailoredCv) {
      throw new NotFoundError("Tailored CV was not found");
    }

    return tailoredCv;
  }

  private async requireSuggestion(userId: string, suggestionId: string): Promise<AiSuggestionRecord> {
    const suggestion = await this.aiRepository.findSuggestionById(userId, suggestionId);

    if (!suggestion) {
      throw new NotFoundError("AI suggestion was not found");
    }

    return suggestion;
  }

  private toRunSummary(row: AiRunRecord): AiRunSummary {
    return {
      id: row.id,
      flow_type: row.flow_type,
      provider: row.provider,
      model_name: row.model_name,
      status: row.status,
      progress_stage: row.progress_stage,
      error_message: row.error_message,
      debug_payload: row.debug_payload,
      started_at: row.started_at,
      completed_at: row.completed_at
    };
  }

  private toSuggestionSummary(row: AiSuggestionRecord): AiSuggestionSummary {
    return {
      id: row.id,
      ai_run_id: row.ai_run_id,
      master_cv_id: row.master_cv_id,
      tailored_cv_id: row.tailored_cv_id,
      block_id: row.block_id,
      action_type: row.action_type,
      option_group_key: row.option_group_key,
      status: row.status,
      applied_at: row.applied_at,
      created_at: row.created_at
    };
  }

  private toSuggestionDetail(row: AiSuggestionRecord): AiSuggestionDetail {
    return {
      ...this.toSuggestionSummary(row),
      before_content: row.before_content,
      suggested_content: row.suggested_content
    };
  }

  private toTailoredDraftSummary(row: TailoredCvRecord): TailoredCvDraftSummary {
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      status: row.status,
      master_cv_id: row.master_cv_id,
      job_id: row.job_id,
      template_id: row.template_id,
      ai_generation_status: row.ai_generation_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      current_content: row.current_content,
      preview: buildCvPreview(row.current_content)
    };
  }

  private toDraftJobSummary(job: JobRecord): TailoredCvDraftJobSummary {
    return {
      id: job.id,
      company_name: job.company_name,
      job_title: job.job_title,
      status: job.status
    };
  }
}
