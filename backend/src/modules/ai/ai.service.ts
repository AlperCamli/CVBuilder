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
  NotFoundError,
  SuggestionNotApplicableError
} from "../../shared/errors/app-error";
import type {
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
  ImportImproveInput,
  ImportImproveResponse,
  JobAnalysisInput,
  SessionContext,
  SuggestionApplyResponse,
  SuggestionRejectResponse,
  TailoredCvDraftInput,
  TailoredCvDraftJobSummary,
  TailoredCvDraftSummary
} from "./ai.types";
import type { AiRepository } from "./ai.repository";
import type { AiPromptResolver } from "./prompts/prompt-resolver";
import type { AiProvider } from "./provider/ai-provider";

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
    const definition = AI_FLOW_REGISTRY[options.flow_type];
    const resolvedPrompt = await this.promptResolver.resolve({
      flow_type: options.flow_type,
      provider: this.aiProvider.providerName,
      action_type: options.action_type ?? null,
      fallback: {
        prompt_key: definition.prompt_key,
        prompt_version: definition.prompt_version,
        system_prompt: definition.system_prompt,
        model_name: this.aiProvider.resolveModelName(options.flow_type)
      }
    });
    const resolvedUserPrompt = resolvedPrompt.user_prompt_template?.trim() || options.user_prompt;

    const aiRun = await this.aiRepository.createRun({
      user_id: options.user_id,
      flow_type: options.flow_type,
      provider: this.aiProvider.providerName,
      model_name: resolvedPrompt.model_name,
      master_cv_id: options.master_cv_id ?? null,
      tailored_cv_id: options.tailored_cv_id ?? null,
      job_id: options.job_id ?? null,
      input_payload: {
        flow_input: options.input_payload,
        prompt: {
          prompt_key: resolvedPrompt.prompt_key,
          prompt_version: resolvedPrompt.prompt_version,
          provider: this.aiProvider.providerName,
          model_name: resolvedPrompt.model_name,
          user_prompt: resolvedUserPrompt,
          system_prompt: resolvedPrompt.system_prompt
        }
      }
    });

    try {
      const providerResult = await this.aiProvider.generate({
        flow_type: options.flow_type,
        model_name: resolvedPrompt.model_name,
        prompt: {
          prompt_key: resolvedPrompt.prompt_key,
          prompt_version: resolvedPrompt.prompt_version,
          user_prompt: resolvedUserPrompt,
          system_prompt: resolvedPrompt.system_prompt
        },
        output_schema: definition.output_schema,
        input_payload: options.input_payload
      });

      const parsed = definition.output_schema.safeParse(providerResult.output_payload);
      if (!parsed.success) {
        await this.aiRepository.failRun(
          options.user_id,
          aiRun.id,
          `Structured output validation failed: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
            .join("; ")}`
        );

        throw new AiFlowFailedError("AI output did not match required contract", {
          flow_type: options.flow_type
        });
      }

      const serializedOutput = z.record(z.unknown()).parse(parsed.data);

      const completed = await this.aiRepository.completeRun(options.user_id, aiRun.id, serializedOutput);
      if (!completed) {
        throw new NotFoundError("AI run was not found after completion");
      }

      return {
        ai_run: completed,
        output: serializedOutput as TOutput,
        provider: providerResult.provider,
        model_name: providerResult.model_name,
        prompt_key: resolvedPrompt.prompt_key,
        prompt_version: resolvedPrompt.prompt_version
      };
    } catch (error) {
      if (error instanceof AiFlowFailedError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unknown AI flow error";
      await this.aiRepository.failRun(options.user_id, aiRun.id, message.slice(0, 2000));

      if (error instanceof AiProviderError) {
        throw error;
      }

      throw new AiFlowFailedError("AI flow execution failed", { flow_type: options.flow_type });
    }
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
      error_message: row.error_message,
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
