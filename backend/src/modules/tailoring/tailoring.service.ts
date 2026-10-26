import { randomUUID } from "node:crypto";
import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";
import {
  buildCvSummaryText,
  cloneCvContent,
  findBlockInCvContent,
  replaceBlockInCvContent
} from "../../shared/cv-content/cv-content.utils";
import { addBulletPrefix } from "../../shared/cv-content/bullet-text";
import { documentLanguageName, normalizeDocumentLanguage } from "../../shared/localization/languages";
import {
  AiFlowFailedError,
  AiProviderError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError
} from "../../shared/errors/app-error";
import type { MasterCvRecord, TailoredCvRecord } from "../../shared/types/domain";
import type { AiRepository } from "../ai/ai.repository";
import type { AiService } from "../ai/ai.service";
import type { SessionContext } from "../ai/ai.types";
import type { BillingService } from "../billing/billing.service";
import { reviewTailoring } from "../cv-review/cv-review";
import type { CvRevisionsService } from "../cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../jobs/jobs.repository";
import type { MasterCvRepository } from "../master-cv/master-cv.repository";
import type { PrivacyService } from "../privacy/privacy.service";
import type { TailoredCvRepository } from "../tailored-cv/tailored-cv.repository";
import {
  buildCompactCv,
  firstLine,
  normalizeSectionType,
  PROTECTED_SECTION_TYPES,
  readSkillsField,
  toAnalysisCvPayload,
  type CompactCv
} from "./tailoring-compact-cv";
import {
  computeTailoringScore,
  forbiddenTermsFromAnswers,
  guardGeneratedLines,
  guardSkills,
  normalizeAnalysisOutput,
  answerForRequirement,
  type GeneratedSkill
} from "./tailoring-rules";
import type { CreateTailoringTaskPayload, TailoringRepository } from "./tailoring.repository";
import type {
  CreateTailoringSessionInput,
  CreateTailoringSuggestionPayload,
  RequirementDecision,
  TailoringAdminSessionSummary,
  TailoringAnalysis,
  TailoringAnswerChoice,
  TailoringCostReport,
  TailoringCostRun,
  TailoringPreferences,
  TailoringSessionRecord,
  TailoringSessionView,
  TailoringSuggestionDecisionResponse,
  TailoringSuggestionRecord,
  TailoringSuggestionView,
  TailoringTaskRecord,
  TailoringTaskRunResponse,
  TailoringTaskView
} from "./tailoring.types";

const MAX_TASKS = 16;
const MAX_SKILLS = 25;
const TASK_STALE_AFTER_MS = 3 * 60_000;
const ANALYSIS_STALE_AFTER_MS = 3 * 60_000;
const JOB_DESCRIPTION_MAX_CHARS = 12_000;

export type TailoringRefinement = "shorter" | "more_impact" | "more_keywords";

const REFINEMENT_INSTRUCTIONS: Record<TailoringRefinement, string> = {
  shorter: "Make the lines shorter and tighter; keep the strongest points only.",
  more_impact: "Lead each line with the outcome or impact the facts already show.",
  more_keywords: "Use more of the brief's job terms where the facts support them."
};

const TERMINAL_TASK_STATUSES = new Set(["done", "failed", "skipped"]);

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const normalizeComparable = (value: unknown): string =>
  JSON.stringify(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Sessions reachable through the owner API always belong to a live tailored CV; a session
// whose CV was deleted is detached (tailored_cv_id null), scrubbed and archived by the DB.
type ActiveTailoringSession = TailoringSessionRecord & { tailored_cv_id: string };

// What "Also add to my main CV" wrote, kept in the suggestion meta so undo can revert it.
interface MasterCvUpdate {
  master_cv_id: string;
  master_suggestion_id: string;
  block_id: string;
  field: string;
  previous_value: CvJsonValue | null;
  written_value: CvJsonValue;
  updated_at: string;
  reverted_at: string | null;
  revert_skipped_at: string | null;
}

const readMasterCvUpdate = (meta: Record<string, unknown>): MasterCvUpdate | null => {
  const value = asRecord(meta.master_update);
  return typeof value.master_cv_id === "string" && typeof value.block_id === "string" && typeof value.field === "string"
    ? (value as unknown as MasterCvUpdate)
    : null;
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

// The language the rewritten CV content must be in: the CV's, never the job posting's.
const cvLanguageOf = (tailored: TailoredCvRecord): { code: string; name: string } => {
  const code =
    normalizeDocumentLanguage(tailored.language) ?? normalizeDocumentLanguage(tailored.current_content.language) ?? "en";
  return { code, name: documentLanguageName(code) };
};

const TASK_FAILED_MESSAGE = "Something went wrong while preparing this suggestion. Try again.";
const TASK_MODEL_FAILED_MESSAGE = "The AI could not prepare this suggestion. Try again.";

// ---------------------------------------------------------------------------
// Task planning (pure, exported for tests)
// ---------------------------------------------------------------------------

export const planTailoringTasks = (
  analysis: TailoringAnalysis,
  compact: CompactCv,
  context: { session_id: string; user_id: string }
): CreateTailoringTaskPayload[] => {
  const blocksById = new Map(compact.blocks.map((block) => [block.block_id, block]));
  const questionsForBlock = (blockId: string | null) =>
    analysis.questions.filter((question) => question.target_block_id === blockId).map((question) => question.id);
  const gapQuestionIds = analysis.questions.filter((question) => question.kind === "gap").map((question) => question.id);

  const tasks: CreateTailoringTaskPayload[] = [];
  const base = { session_id: context.session_id, user_id: context.user_id };
  const push = (task: Omit<CreateTailoringTaskPayload, "session_id" | "user_id" | "status">) => {
    tasks.push({ ...base, ...task, status: task.depends_on_question_ids.length > 0 ? "waiting" : "ready" });
  };

  const summaryBlock = compact.blocks.find((block) => block.kind === "summary");
  const itemBlockIds = new Set<string>();
  for (const brief of analysis.block_briefs) {
    const block = blocksById.get(brief.block_id);
    if (block?.kind === "item") itemBlockIds.add(block.block_id);
  }
  // A question aimed at a block means the candidate's answer belongs there.
  for (const question of analysis.questions) {
    const block = question.target_block_id ? blocksById.get(question.target_block_id) : null;
    if (block?.kind === "item") itemBlockIds.add(block.block_id);
  }

  push({
    kind: "summary",
    block_id: summaryBlock?.block_id ?? null,
    section_id: summaryBlock?.section_id ?? null,
    depends_on_question_ids: [
      ...new Set([
        ...analysis.questions
          .filter((question) => question.kind === "gap" && question.target_block_id === null)
          .map((question) => question.id),
        ...(summaryBlock ? questionsForBlock(summaryBlock.block_id) : [])
      ])
    ],
    brief: analysis.block_briefs.find((brief) => brief.block_id === summaryBlock?.block_id) ?? {}
  });

  for (const blockId of itemBlockIds) {
    if (tasks.length >= MAX_TASKS - 2) break;
    const block = blocksById.get(blockId)!;
    push({
      kind: "block",
      block_id: block.block_id,
      section_id: block.section_id,
      depends_on_question_ids: questionsForBlock(block.block_id),
      brief: analysis.block_briefs.find((brief) => brief.block_id === block.block_id) ?? {}
    });
  }

  const skillsBlock = compact.blocks.find((block) => block.kind === "skills");
  push({
    kind: "skills",
    block_id: skillsBlock?.block_id ?? null,
    section_id: skillsBlock?.section_id ?? null,
    depends_on_question_ids: gapQuestionIds,
    brief: {}
  });

  if (compact.sections.length > 1) {
    push({ kind: "structure", block_id: null, section_id: null, depends_on_question_ids: [], brief: {} });
  }

  return tasks;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TailoringService {
  constructor(
    private readonly repository: TailoringRepository,
    private readonly aiService: AiService,
    private readonly aiRepository: AiRepository,
    private readonly masterCvRepository: MasterCvRepository,
    private readonly tailoredCvRepository: TailoredCvRepository,
    private readonly jobsRepository: JobsRepository,
    private readonly cvRevisionsService: CvRevisionsService,
    private readonly billingService: BillingService,
    private readonly options: { adminEmails?: string[]; privacy?: PrivacyService } = {}
  ) {}

  isAdmin(session: SessionContext): boolean {
    const email = session.appUser.email?.trim().toLowerCase();
    return Boolean(email) && (this.options.adminEmails ?? []).includes(email);
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  async createSession(session: SessionContext, input: CreateTailoringSessionInput): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    await this.options.privacy?.assertAi(userId);
    await this.billingService.assertActionAllowed(userId, "tailored_cv_generation");

    const job = {
      job_title: input.job.job_title.trim(),
      company_name: input.job.company_name?.trim() ?? "",
      job_description: input.job.job_description.trim()
    };

    const master = await this.masterCvRepository.findById(userId, input.cv_id);
    const tailored = master
      ? await this.createTailoredCopy(userId, master, job)
      : await this.retargetTailoredCv(userId, input.cv_id, job);

    await this.repository.archiveActiveSessions(userId, tailored.id);
    const created = await this.repository.createSession({
      user_id: userId,
      tailored_cv_id: tailored.id,
      job_id: tailored.job_id,
      job_snapshot: job,
      base_snapshot: tailored.current_content
    });

    return this.buildView(session, created);
  }

  private async createTailoredCopy(
    userId: string,
    master: MasterCvRecord,
    job: TailoringSessionRecord["job_snapshot"]
  ): Promise<TailoredCvRecord> {
    if (master.module_type !== "standard") {
      throw new ValidationError("Tailoring is available for standard CVs only.");
    }

    const createdJob = await this.jobsRepository.create({
      user_id: userId,
      tailored_cv_id: null,
      company_name: job.company_name,
      job_title: job.job_title,
      job_description: job.job_description,
      job_posting_url: null,
      location_text: null,
      notes: null,
      status: "saved",
      applied_at: null
    });

    const tailored = await this.tailoredCvRepository.create({
      user_id: userId,
      master_cv_id: master.id,
      job_id: createdJob.id,
      title: `${master.title} - ${job.company_name || job.job_title}`,
      language: master.language,
      template_id: master.template_id,
      module_type: master.module_type,
      current_content: cloneCvContent(master.current_content),
      status: "draft",
      ai_generation_status: null,
      last_exported_at: null
    });

    await this.jobsRepository.linkTailoredCv(userId, createdJob.id, tailored.id);
    return tailored;
  }

  // Re-tailoring rebases the existing tailored CV onto a (possibly new) job.
  private async retargetTailoredCv(
    userId: string,
    tailoredCvId: string,
    job: TailoringSessionRecord["job_snapshot"]
  ): Promise<TailoredCvRecord> {
    const tailored = await this.tailoredCvRepository.findById(userId, tailoredCvId);
    if (!tailored) {
      throw new NotFoundError("CV was not found");
    }

    const linkedJob = tailored.job_id ? await this.jobsRepository.findById(userId, tailored.job_id) : null;
    const sameJob =
      linkedJob !== null &&
      linkedJob.job_description.trim() === job.job_description &&
      linkedJob.job_title.trim() === job.job_title;

    if (linkedJob && sameJob) {
      await this.jobsRepository.updateById(userId, linkedJob.id, { company_name: job.company_name });
      return tailored;
    }

    const createdJob = await this.jobsRepository.create({
      user_id: userId,
      tailored_cv_id: null,
      company_name: job.company_name,
      job_title: job.job_title,
      job_description: job.job_description,
      job_posting_url: null,
      location_text: null,
      notes: null,
      status: "saved",
      applied_at: null
    });
    if (linkedJob) {
      await this.repository.unlinkJobFromTailoredCv(userId, linkedJob.id);
    }
    await this.jobsRepository.linkTailoredCv(userId, createdJob.id, tailored.id);
    const updated = await this.tailoredCvRepository.updateById(userId, tailored.id, { job_id: createdJob.id });
    return updated ?? { ...tailored, job_id: createdJob.id };
  }

  async getSession(session: SessionContext, sessionId: string): Promise<TailoringSessionView> {
    return this.buildView(session, await this.requireSession(session.appUser.id, sessionId));
  }

  async getActiveSessionForCv(session: SessionContext, tailoredCvId: string): Promise<TailoringSessionView | null> {
    const active = await this.repository.findActiveSessionByTailoredCv(session.appUser.id, tailoredCvId);
    return active ? this.buildView(session, active) : null;
  }

  async analyze(session: SessionContext, sessionId: string): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    const staleAnalysis =
      current.status === "analyzing" && Date.parse(current.updated_at) < Date.now() - ANALYSIS_STALE_AFTER_MS;
    const claimed = await this.repository.claimSessionStatus(
      userId,
      sessionId,
      staleAnalysis ? ["analyzing"] : ["draft"],
      "analyzing"
    );
    if (!claimed) {
      // Another request is analyzing, or the analysis already finished.
      return this.buildView(session, current);
    }

    // Once the analysis and its tasks are saved the session has moved on; a later failure
    // (e.g. usage recording) must not reset it to draft and invite a second analysis.
    let analysisSaved = false;
    try {
      const tailored = await this.requireTailoredCv(userId, claimed.tailored_cv_id);
      const compact = buildCompactCv(tailored.current_content);
      if (compact.blocks.length === 0) {
        throw new ValidationError("Add your experience to the CV before tailoring it for a job.");
      }

      const { ai_run, output } = await this.aiService.runTailoringSessionFlow<TailoringAnalysis>({
        user_id: userId,
        flow_type: "tailoring_analysis",
        tailored_cv_id: tailored.id,
        job_id: claimed.job_id,
        tailoring_session_id: claimed.id,
        user_prompt: `Analyze the CV against the job "${claimed.job_snapshot.job_title}" and plan the tailoring.`,
        input_payload: {
          job: {
            role: claimed.job_snapshot.job_title,
            company: claimed.job_snapshot.company_name,
            description: claimed.job_snapshot.job_description.slice(0, JOB_DESCRIPTION_MAX_CHARS)
          },
          cv: toAnalysisCvPayload(compact)
        }
      });

      const analysis = normalizeAnalysisOutput(output, compact);
      const hasQuestions = analysis.questions.length > 0;
      // Only the first successful analysis of a session counts as a tailoring.
      const firstAnalysis = claimed.analysis === null;

      // A retried analysis replaces the tasks of an earlier attempt instead of adding to them.
      await this.repository.deleteTasks(userId, claimed.id);
      await this.repository.createTasks(
        planTailoringTasks(analysis, compact, { session_id: claimed.id, user_id: userId })
      );
      const updated = await this.repository.updateSession(userId, claimed.id, {
        analysis,
        analysis_run_id: ai_run.id,
        status: hasQuestions ? "answering" : "generating",
        questions_completed: !hasQuestions,
        error_message: null
      });
      analysisSaved = true;

      if (firstAnalysis) {
        await this.billingService.recordTailoredCvGenerationUsage(userId);
      }

      return this.buildView(session, updated ?? claimed);
    } catch (error) {
      if (!analysisSaved) {
        // Back to job input with a retry; tasks of this attempt are replaced on the retry.
        await this.repository.updateSession(userId, claimed.id, {
          status: "draft",
          error_message:
            error instanceof ValidationError ? error.message : "The job analysis could not be completed. Please try again."
        });
      }
      throw error;
    }
  }

  async setRequirementDecision(
    session: SessionContext,
    sessionId: string,
    requirementId: string,
    decision: RequirementDecision
  ): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    if (!current.analysis?.requirements.some((requirement) => requirement.id === requirementId)) {
      throw new NotFoundError("Requirement was not found");
    }
    const updated = await this.repository.mergeSessionJson(userId, sessionId, "requirement_decisions", {
      [requirementId]: decision
    });
    return this.buildView(session, updated ?? current);
  }

  async answerQuestion(
    session: SessionContext,
    sessionId: string,
    questionId: string,
    input: { answer: TailoringAnswerChoice | null; detail: string | null; add_to_main: boolean }
  ): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    if (!current.analysis?.questions.some((question) => question.id === questionId)) {
      throw new NotFoundError("Question was not found");
    }

    const updated =
      (await this.repository.mergeSessionJson(userId, sessionId, "answers", {
        [questionId]: {
          answer: input.answer,
          detail: input.detail?.trim() || null,
          add_to_main: input.add_to_main,
          answered_at: new Date().toISOString()
        }
      })) ?? current;

    // Tasks waiting only on answered questions can start now.
    const tasks = await this.repository.listTasks(userId, sessionId);
    const unlocked = tasks
      .filter((task) => task.status === "waiting")
      .filter((task) => task.depends_on_question_ids.every((id) => updated.answers[id]))
      .map((task) => task.id);
    await this.repository.markTasksReady(userId, sessionId, unlocked);

    return this.buildView(session, updated);
  }

  async completeQuestions(session: SessionContext, sessionId: string): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    if (!current.analysis) {
      throw new ConflictError("Analyze the job before continuing.");
    }

    const tasks = await this.repository.listTasks(userId, sessionId);
    await this.repository.markTasksReady(
      userId,
      sessionId,
      tasks.filter((task) => task.status === "waiting").map((task) => task.id)
    );
    const updated = await this.repository.updateSession(userId, sessionId, {
      questions_completed: true,
      ...(current.status === "answering" ? { status: "generating" as const } : {})
    });
    await this.advanceWhenTasksSettled(userId, sessionId);
    return this.getSession(session, (updated ?? current).id);
  }

  async finish(session: SessionContext, sessionId: string): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    if (!current.analysis) {
      throw new ConflictError("Analyze the job before finishing.");
    }

    const tailored = await this.requireTailoredCv(userId, current.tailored_cv_id);
    const keywords = current.analysis.requirements.flatMap((requirement) => requirement.keywords);
    await this.tailoredCvRepository.updateById(userId, tailored.id, {
      ai_generation_status: "completed",
      tailoring_review: reviewTailoring(
        current.base_snapshot,
        tailored.current_content,
        { job_title: current.job_snapshot.job_title, job_description: current.job_snapshot.job_description },
        keywords
      )
    });

    const updated = await this.repository.updateSession(userId, sessionId, {
      status: "ready",
      finished_at: new Date().toISOString()
    });
    return this.buildView(session, updated ?? current);
  }

  async updatePreferences(session: SessionContext, patch: Partial<TailoringPreferences>): Promise<TailoringPreferences> {
    return this.repository.updatePreferences(session.appUser.id, patch);
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  async runTask(
    session: SessionContext,
    sessionId: string,
    taskId: string,
    options: { regenerate?: boolean; refinement?: TailoringRefinement | null } = {}
  ): Promise<TailoringTaskRunResponse> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    if (!current.analysis) {
      throw new ConflictError("Analyze the job before generating suggestions.");
    }

    const regenerate = Boolean(options.regenerate || options.refinement);
    const claimed = await this.repository.claimTask(
      userId,
      sessionId,
      taskId,
      new Date(Date.now() - TASK_STALE_AFTER_MS).toISOString(),
      regenerate
    );

    if (!claimed) {
      const task = await this.repository.findTask(userId, sessionId, taskId);
      if (!task) {
        throw new NotFoundError("Tailoring task was not found");
      }
      if (task.status === "waiting") {
        throw new ConflictError("Answer the related questions before generating this suggestion.");
      }
      return this.buildTaskResponse(userId, current, task);
    }

    let finished: TailoringTaskRecord | null = null;
    let failure: unknown = null;
    try {
      const tailored = await this.requireTailoredCv(userId, current.tailored_cv_id);
      const generated = await this.generateTaskSuggestions(userId, current, claimed, tailored, options.refinement ?? null);
      // Earlier pending cards of this task are replaced only once the new ones exist, so a
      // failed regenerate keeps them; a re-run of a stale task cannot duplicate them either.
      const created = await this.repository.createSuggestions(generated.suggestions);
      await this.repository.expirePendingTaskSuggestions(
        userId,
        claimed.id,
        created.map((suggestion) => suggestion.id)
      );
      finished = await this.repository.updateTask(userId, claimed.id, {
        status: generated.skipped ? "skipped" : "done",
        ai_run_id: generated.ai_run_id,
        error_message: null,
        completed_at: new Date().toISOString()
      });
    } catch (error) {
      // Model failures stay on the card (with retry) instead of failing the whole panel;
      // other errors are rethrown, but only after the task is failed and the session settled.
      const modelFailure = error instanceof AiProviderError || error instanceof AiFlowFailedError;
      if (!modelFailure) {
        failure = error;
      }
      try {
        finished = await this.repository.updateTask(userId, claimed.id, {
          status: "failed",
          error_message: modelFailure ? TASK_MODEL_FAILED_MESSAGE : TASK_FAILED_MESSAGE,
          completed_at: new Date().toISOString()
        });
      } catch (updateError) {
        // The task stays "running" and becomes claimable again once it is stale.
        failure ??= updateError;
      }
    }

    try {
      await this.advanceWhenTasksSettled(userId, sessionId);
    } catch (advanceError) {
      failure ??= advanceError;
    }
    if (failure) {
      throw failure;
    }

    const refreshed = (await this.repository.findSessionById(userId, sessionId)) ?? current;
    return this.buildTaskResponse(userId, refreshed, finished ?? claimed);
  }

  private async advanceWhenTasksSettled(userId: string, sessionId: string): Promise<void> {
    const tasks = await this.repository.listTasks(userId, sessionId);
    if (tasks.length > 0 && tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) {
      await this.repository.claimSessionStatus(userId, sessionId, ["generating"], "reviewing");
    }
  }

  private async generateTaskSuggestions(
    userId: string,
    session: TailoringSessionRecord,
    task: TailoringTaskRecord,
    tailored: TailoredCvRecord,
    refinement: TailoringRefinement | null
  ): Promise<{ suggestions: CreateTailoringSuggestionPayload[]; ai_run_id: string | null; skipped: boolean }> {
    const content = tailored.current_content;
    const compact = buildCompactCv(content);
    const analysis = session.analysis!;
    const relevantRequirements = analysis.requirements
      .filter((requirement) => session.requirement_decisions[requirement.id] !== "not_relevant")
      .map((requirement) => ({
        id: requirement.id,
        text: requirement.text,
        importance: requirement.importance,
        status: requirement.status,
        keywords: requirement.keywords
      }));
    const job = {
      role: session.job_snapshot.job_title,
      company: session.job_snapshot.company_name,
      role_summary: analysis.role_summary
    };
    const cvLanguage = cvLanguageOf(tailored);
    const forbidden = forbiddenTermsFromAnswers(analysis, session.answers);
    const knownRequirementIds = new Set(analysis.requirements.map((requirement) => requirement.id));
    const base = {
      user_id: userId,
      tailored_cv_id: tailored.id,
      tailoring_session_id: session.id,
      tailoring_task_id: task.id
    };

    if (task.kind === "structure") {
      return this.generateStructureSuggestions(userId, session, compact, content, job, relevantRequirements, base);
    }
    if (task.kind === "skills") {
      return this.generateSkillsSuggestions(userId, session, task, compact, content, job, cvLanguage, relevantRequirements, forbidden, knownRequirementIds, base);
    }

    // Narrative: an item block, the existing summary, or a new summary.
    let block: CvBlock | null = null;
    if (task.block_id) {
      try {
        block = findBlockInCvContent(content, task.block_id).block;
      } catch {
        return { suggestions: [], ai_run_id: null, skipped: true };
      }
    }

    const info = task.block_id ? compact.blocks.find((item) => item.block_id === task.block_id) : undefined;
    const kind = task.kind === "summary" ? (block ? "summary" : "new_summary") : "item";
    const field = kind === "item" ? "description" : "text";
    const currentText = block ? String(block.fields[field] ?? "").trim() : "";

    const relatedQuestions = analysis.questions.filter((question) =>
      task.kind === "summary"
        ? question.target_block_id === task.block_id || (question.kind === "gap" && question.target_block_id === null)
        : question.target_block_id === task.block_id
    );
    const confirmedFacts = relatedQuestions.flatMap((question) => {
      const answer = session.answers[question.id];
      if (!answer || answer.answer === "no" || (!answer.answer && !answer.detail)) return [];
      return [{ question: question.text, answer: answer.answer, detail: answer.detail }];
    });
    const addToMain = relatedQuestions.some((question) => session.answers[question.id]?.add_to_main === true);

    const otherBlocks = compact.blocks
      .filter((item) => item.block_id !== task.block_id && item.kind !== "skills")
      .slice(0, 24)
      .map((item) => ({ title: item.title, subtitle: item.subtitle, first_line: firstLine(item.text) }));

    const { ai_run, output } = await this.aiService.runTailoringSessionFlow<{
      changed: boolean;
      lines: string[];
      rationale: string;
      requirement_ids: string[];
    }>({
      user_id: userId,
      flow_type: "tailoring_block",
      tailored_cv_id: tailored.id,
      job_id: session.job_id,
      tailoring_session_id: session.id,
      parent_run_id: session.analysis_run_id,
      user_prompt:
        kind === "item"
          ? `Tailor this CV block for the "${job.role}" role.`
          : `Write the professional summary for the "${job.role}" role.`,
      input_payload: {
        cv_language: cvLanguage,
        job,
        requirements: relevantRequirements,
        block: {
          kind,
          title: info?.title ?? "",
          subtitle: info?.subtitle ?? "",
          current_text: currentText
        },
        brief: Object.keys(task.brief).length > 0 ? task.brief : null,
        confirmed_facts: confirmedFacts,
        other_blocks: otherBlocks,
        ...(kind === "new_summary" ? { cv_overview: toAnalysisCvPayload(compact) } : {}),
        ...(refinement ? { refinement: REFINEMENT_INSTRUCTIONS[refinement] } : {})
      }
    });

    if (!output.changed || output.lines.length === 0) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    // Summaries may restate figures from anywhere in the CV; item blocks only their own.
    const sourceTexts =
      kind === "item"
        ? [info?.title ?? "", info?.subtitle ?? "", currentText]
        : compact.blocks.map((item) => [item.title, item.subtitle, item.text].join("\n"));
    sourceTexts.push(...confirmedFacts.map((fact) => fact.detail ?? ""));
    const guarded = guardGeneratedLines(output.lines, { source_texts: sourceTexts, forbidden_terms: forbidden });
    if (guarded.lines.length === 0) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    const value =
      kind === "item"
        ? guarded.lines.map((line) => addBulletPrefix(line)).join("\n")
        : guarded.lines.join(" ").trim();
    if (normalizeComparable(value) === normalizeComparable(currentText)) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    const requirementIds = output.requirement_ids.filter((id) => knownRequirementIds.has(id));
    const meta = { guard_notes: guarded.notes, add_to_main: addToMain, section_id: task.section_id };

    if (kind === "new_summary") {
      const section: CvSection = {
        id: `summary-section-${randomUUID()}`,
        type: "summary",
        title: "Professional Summary",
        order: 0,
        blocks: [
          {
            id: `summary-block-${randomUUID()}`,
            type: "summary",
            order: 0,
            visibility: "visible",
            fields: { text: value },
            meta: {}
          }
        ],
        meta: {}
      };
      return {
        ai_run_id: ai_run.id,
        skipped: false,
        suggestions: [
          {
            ...base,
            ai_run_id: ai_run.id,
            kind: "new_section",
            block_id: null,
            before_content: null,
            suggested_content: { section, position: "first" },
            rationale: output.rationale,
            requirement_ids: requirementIds,
            meta: { ...meta, add_to_main: false }
          }
        ]
      };
    }

    return {
      ai_run_id: ai_run.id,
      skipped: false,
      suggestions: [
        {
          ...base,
          ai_run_id: ai_run.id,
          kind: "rewrite",
          block_id: task.block_id,
          before_content: { field, value: currentText },
          suggested_content: { field, value },
          rationale: output.rationale,
          requirement_ids: requirementIds,
          meta
        }
      ]
    };
  }

  private async generateSkillsSuggestions(
    userId: string,
    session: TailoringSessionRecord,
    task: TailoringTaskRecord,
    compact: CompactCv,
    content: CvContent,
    job: Record<string, string>,
    cvLanguage: { code: string; name: string },
    requirements: Array<Record<string, unknown>>,
    forbidden: string[],
    knownRequirementIds: Set<string>,
    base: Pick<CreateTailoringSuggestionPayload, "user_id" | "tailored_cv_id" | "tailoring_session_id" | "tailoring_task_id">
  ) {
    const analysis = session.analysis!;
    let currentSkills: string[] = [];
    if (task.block_id) {
      try {
        currentSkills = readSkillsField(findBlockInCvContent(content, task.block_id).block.fields);
      } catch {
        return { suggestions: [], ai_run_id: null, skipped: true };
      }
    }

    const currentKeys = new Set(currentSkills.map((skill) => skill.toLowerCase()));
    // A requirement's terms may be added when the CV shows it or the candidate confirmed it.
    const allowedNewSkills = [
      ...new Set(
        analysis.requirements
          .filter((requirement) => session.requirement_decisions[requirement.id] !== "not_relevant")
          .filter((requirement) => {
            const answer = answerForRequirement(analysis, session.answers, requirement.id)?.answer;
            if (answer === "no") return false;
            return requirement.status !== "missing" || answer === "yes" || answer === "some";
          })
          .flatMap((requirement) => requirement.keywords)
          .filter((keyword) => keyword.split(/\s+/).length <= 4 && !currentKeys.has(keyword.toLowerCase()))
      )
    ];

    if (currentSkills.length === 0 && allowedNewSkills.length === 0) {
      return { suggestions: [], ai_run_id: null, skipped: true };
    }

    const { ai_run, output } = await this.aiService.runTailoringSessionFlow<{
      changed: boolean;
      skills: GeneratedSkill[];
      rationale: string;
      requirement_ids: string[];
    }>({
      user_id: userId,
      flow_type: "tailoring_skills",
      tailored_cv_id: base.tailored_cv_id,
      job_id: session.job_id,
      tailoring_session_id: session.id,
      parent_run_id: session.analysis_run_id,
      user_prompt: `Prepare the skills list for the "${job.role}" role.`,
      input_payload: {
        cv_language: cvLanguage,
        job,
        requirements,
        current_skills: currentSkills,
        allowed_new_skills: allowedNewSkills
      }
    });

    if (!output.changed) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    const cvText = compact.blocks.map((block) => [block.title, block.subtitle, block.text].join("\n")).join("\n");
    const guarded = guardSkills(output.skills, {
      current_skills: currentSkills,
      allowed_new_skills: allowedNewSkills,
      cv_text: cvText,
      forbidden_terms: forbidden,
      max_skills: MAX_SKILLS
    });
    if (guarded.lines.length === 0 || normalizeComparable(guarded.lines) === normalizeComparable(currentSkills)) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    const requirementIds = output.requirement_ids.filter((id) => knownRequirementIds.has(id));
    const meta = { guard_notes: guarded.notes, add_to_main: false, section_id: task.section_id };

    if (!task.block_id) {
      const section: CvSection = {
        id: `skills-section-${randomUUID()}`,
        type: "skills",
        title: "Skills",
        order: 0,
        blocks: [
          {
            id: `skills-block-${randomUUID()}`,
            type: "skills",
            order: 0,
            visibility: "visible",
            fields: { skills: guarded.lines as CvJsonValue[] },
            meta: {}
          }
        ],
        meta: {}
      };
      return {
        ai_run_id: ai_run.id,
        skipped: false,
        suggestions: [
          {
            ...base,
            ai_run_id: ai_run.id,
            kind: "new_section" as const,
            block_id: null,
            before_content: null,
            suggested_content: { section, position: "last" },
            rationale: output.rationale,
            requirement_ids: requirementIds,
            meta
          }
        ]
      };
    }

    return {
      ai_run_id: ai_run.id,
      skipped: false,
      suggestions: [
        {
          ...base,
          ai_run_id: ai_run.id,
          kind: "skills" as const,
          block_id: task.block_id,
          before_content: { field: "skills", value: currentSkills },
          suggested_content: { field: "skills", value: guarded.lines },
          rationale: output.rationale,
          requirement_ids: requirementIds,
          meta
        }
      ]
    };
  }

  private async generateStructureSuggestions(
    userId: string,
    session: TailoringSessionRecord,
    compact: CompactCv,
    content: CvContent,
    job: Record<string, string>,
    requirements: Array<Record<string, unknown>>,
    base: Pick<CreateTailoringSuggestionPayload, "user_id" | "tailored_cv_id" | "tailoring_session_id" | "tailoring_task_id">
  ) {
    if (compact.sections.length < 2) {
      return { suggestions: [], ai_run_id: null, skipped: true };
    }

    const { ai_run, output } = await this.aiService.runTailoringSessionFlow<{
      changed: boolean;
      section_order: string[];
      hide_section_ids: string[];
      rationale: string;
    }>({
      user_id: userId,
      flow_type: "tailoring_structure",
      tailored_cv_id: base.tailored_cv_id,
      job_id: session.job_id,
      tailoring_session_id: session.id,
      parent_run_id: session.analysis_run_id,
      user_prompt: `Suggest the section order for the "${job.role}" role.`,
      input_payload: {
        job,
        requirements,
        sections: compact.sections.map((section) => ({
          id: section.alias,
          type: section.type,
          title: section.title,
          block_count: section.block_count,
          preview: section.preview
        }))
      }
    });

    if (!output.changed) {
      return { suggestions: [], ai_run_id: ai_run.id, skipped: false };
    }

    const currentOrder = compact.sections.map((section) => section.section_id);
    const proposed = [
      ...new Set(
        output.section_order
          .map((alias) => compact.alias_to_section_id[alias.trim()])
          .filter((id): id is string => Boolean(id))
      )
    ];
    // Sections the model forgot keep their relative order at the end; summary stays first.
    const completed = [...proposed, ...currentOrder.filter((id) => !proposed.includes(id))];
    const typeOf = new Map(compact.sections.map((section) => [section.section_id, section.type]));
    const summaryFirst = [
      ...completed.filter((id) => typeOf.get(id) === "summary"),
      ...completed.filter((id) => typeOf.get(id) !== "summary")
    ];

    const suggestions: CreateTailoringSuggestionPayload[] = [];
    const meta = { guard_notes: [], add_to_main: false, section_id: null };
    if (summaryFirst.join("|") !== currentOrder.join("|")) {
      suggestions.push({
        ...base,
        ai_run_id: ai_run.id,
        kind: "reorder",
        block_id: null,
        before_content: { section_order: currentOrder },
        suggested_content: { section_order: summaryFirst },
        rationale: output.rationale,
        requirement_ids: [],
        meta
      });
    }

    for (const alias of output.hide_section_ids) {
      const sectionId = compact.alias_to_section_id[alias.trim()];
      const section = content.sections.find((item) => item.id === sectionId);
      if (!sectionId || !section || PROTECTED_SECTION_TYPES.has(normalizeSectionType(section.type))) continue;
      suggestions.push({
        ...base,
        ai_run_id: ai_run.id,
        kind: "hide_section",
        block_id: null,
        before_content: { section_id: sectionId },
        suggested_content: { section_id: sectionId, title: section.title ?? section.type },
        rationale: output.rationale,
        requirement_ids: [],
        meta: { ...meta, section_id: sectionId }
      });
    }

    return { suggestions, ai_run_id: ai_run.id, skipped: false };
  }

  // -------------------------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------------------------

  async decideSuggestion(
    session: SessionContext,
    sessionId: string,
    suggestionId: string,
    input: { decision: "accept" | "reject" | "undo"; edited_value?: string | string[] | null }
  ): Promise<TailoringSuggestionDecisionResponse> {
    const userId = session.appUser.id;
    const current = await this.requireSession(userId, sessionId);
    const suggestion = await this.repository.findSuggestion(userId, sessionId, suggestionId);
    if (!suggestion) {
      throw new NotFoundError("Suggestion was not found");
    }

    let suggestedContent: Record<string, unknown> | undefined;
    if (input.decision === "accept" && input.edited_value !== undefined && input.edited_value !== null) {
      if (suggestion.kind === "rewrite") {
        if (typeof input.edited_value !== "string") {
          throw new ValidationError("Edit this suggestion as text.");
        }
      } else if (suggestion.kind === "skills") {
        if (!Array.isArray(input.edited_value)) {
          throw new ValidationError("Edit this suggestion as a list of skills.");
        }
      } else {
        throw new ValidationError("Only text and skills suggestions can be edited.");
      }
      suggestedContent = { ...suggestion.suggested_content, value: input.edited_value, edited: true };
    }

    const transition =
      input.decision === "accept"
        ? { from: ["pending", "rejected"] as const, to: "applied" as const }
        : input.decision === "reject"
          ? { from: ["pending"] as const, to: "rejected" as const }
          : { from: ["applied", "rejected"] as const, to: "pending" as const };

    let updated = await this.repository.updateSuggestionStatus(
      userId,
      suggestion.id,
      [...transition.from],
      transition.to,
      suggestedContent
    );
    if (!updated) {
      throw new ConflictError("This suggestion was already updated.", { status: suggestion.status });
    }

    // The main CV is a secondary write: the card decision above already stands, so a failure
    // here is reported through the flags below instead of failing the request.
    let masterCvUpdated = false;
    let masterCvReverted = false;
    let masterCvRevertSkipped = false;
    if (input.decision === "accept" && updated.kind === "rewrite" && updated.meta.add_to_main === true) {
      const masterUpdate = await this.applyToMasterCv(userId, current.tailored_cv_id, updated).catch(() => null);
      if (masterUpdate) {
        masterCvUpdated = true;
        updated =
          (await this.repository.updateSuggestionMeta(userId, updated.id, { ...updated.meta, master_update: masterUpdate })) ??
          updated;
      }
    } else if (input.decision === "undo" && suggestion.status === "applied") {
      const masterUpdate = readMasterCvUpdate(updated.meta);
      if (masterUpdate && !masterUpdate.reverted_at && !masterUpdate.revert_skipped_at) {
        const outcome = await this.revertMasterCv(userId, masterUpdate).catch(() => null);
        if (outcome) {
          masterCvReverted = outcome === "reverted";
          masterCvRevertSkipped = outcome === "skipped";
          const at = new Date().toISOString();
          updated =
            (await this.repository.updateSuggestionMeta(userId, updated.id, {
              ...updated.meta,
              master_update: {
                ...masterUpdate,
                reverted_at: masterCvReverted ? at : null,
                revert_skipped_at: masterCvRevertSkipped ? at : null
              }
            })) ?? updated;
        }
      }
    }

    const suggestions = await this.repository.listSuggestions(userId, sessionId);
    return {
      suggestion: this.toSuggestionView(updated),
      score: computeTailoringScore(current.analysis, current.requirement_decisions, current.answers, suggestions),
      master_cv_updated: masterCvUpdated,
      master_cv_reverted: masterCvReverted,
      master_cv_revert_skipped: masterCvRevertSkipped
    };
  }

  // "Also add to my main CV": the tailored copy keeps master block ids, so the accepted
  // rewrite is applied to the same block of the source CV when it still exists. Recorded
  // like an applied block suggestion on the main CV (an applied ai_suggestions row with the
  // full before/after block, which feeds its block version history, plus an "ai" block
  // revision linked to it), so the previous version stays restorable from block history.
  private async applyToMasterCv(
    userId: string,
    tailoredCvId: string,
    suggestion: TailoringSuggestionRecord
  ): Promise<MasterCvUpdate | null> {
    const tailored = await this.tailoredCvRepository.findById(userId, tailoredCvId);
    const master = tailored ? await this.masterCvRepository.findById(userId, tailored.master_cv_id) : null;
    if (!master || !suggestion.block_id) {
      return null;
    }

    let lookup;
    try {
      lookup = findBlockInCvContent(master.current_content, suggestion.block_id);
    } catch {
      return null;
    }

    const field = String(suggestion.suggested_content.field ?? "");
    const value = suggestion.suggested_content.value as CvJsonValue | undefined;
    if (!field || value === undefined) {
      return null;
    }
    const previousValue = lookup.block.fields[field] ?? null;
    if (sameJson(previousValue, value)) {
      return null;
    }

    const nextBlock: CvBlock = { ...lookup.block, fields: { ...lookup.block.fields, [field]: value } };
    const replacement = replaceBlockInCvContent(master.current_content, suggestion.block_id, nextBlock);
    const updated = await this.masterCvRepository.updateById(userId, master.id, {
      current_content: replacement.content,
      summary_text: buildCvSummaryText(replacement.content)
    });
    if (!updated) {
      return null;
    }

    const appliedAt = new Date().toISOString();
    const [masterSuggestion] = await this.aiRepository.createSuggestions([
      {
        ai_run_id: suggestion.ai_run_id,
        user_id: userId,
        master_cv_id: master.id,
        tailored_cv_id: null,
        block_id: suggestion.block_id,
        action_type: "tailor",
        before_content: asRecord(lookup.block),
        suggested_content: asRecord(replacement.updated_block),
        option_group_key: null,
        status: "applied",
        applied_at: appliedAt
      }
    ]);
    if (!masterSuggestion) {
      throw new InternalServerError("AI suggestion could not be persisted after updating the main CV");
    }

    await this.cvRevisionsService.createMasterBlockRevision({
      user_id: userId,
      master_cv_id: master.id,
      block: replacement.updated_block,
      change_source: "ai",
      ai_suggestion_id: masterSuggestion.id,
      created_by_user_id: userId
    });

    return {
      master_cv_id: master.id,
      master_suggestion_id: masterSuggestion.id,
      block_id: suggestion.block_id,
      field,
      previous_value: previousValue,
      written_value: replacement.updated_block.fields[field] ?? value,
      updated_at: appliedAt,
      reverted_at: null,
      revert_skipped_at: null
    };
  }

  // Undo of a card that also updated the main CV: restore the main CV block field only while
  // it still holds what we wrote; a later edit by the user is kept ("skipped").
  private async revertMasterCv(userId: string, update: MasterCvUpdate): Promise<"reverted" | "skipped"> {
    const master = await this.masterCvRepository.findById(userId, update.master_cv_id);
    if (!master) {
      return "skipped";
    }

    let lookup;
    try {
      lookup = findBlockInCvContent(master.current_content, update.block_id);
    } catch {
      return "skipped";
    }
    if (!sameJson(lookup.block.fields[update.field], update.written_value)) {
      return "skipped";
    }

    const fields = { ...lookup.block.fields };
    if (update.previous_value === null) {
      delete fields[update.field];
    } else {
      fields[update.field] = update.previous_value;
    }
    const replacement = replaceBlockInCvContent(master.current_content, update.block_id, { ...lookup.block, fields });
    const updated = await this.masterCvRepository.updateById(userId, master.id, {
      current_content: replacement.content,
      summary_text: buildCvSummaryText(replacement.content)
    });
    if (!updated) {
      return "skipped";
    }

    // The undone AI version leaves the main CV's block version history (as a rejected
    // suggestion would), and the restore itself is recorded like a revision restore.
    await this.aiRepository.updateSuggestionById(
      userId,
      update.master_suggestion_id,
      { status: "rejected", applied_at: null },
      { expected_status: "applied" }
    );
    await this.cvRevisionsService.createMasterBlockRevision({
      user_id: userId,
      master_cv_id: master.id,
      block: replacement.updated_block,
      change_source: "restore",
      ai_suggestion_id: null,
      created_by_user_id: userId
    });
    return "reverted";
  }

  // -------------------------------------------------------------------------
  // Admin cost reporting
  // -------------------------------------------------------------------------

  async listAdminSessions(limit: number): Promise<TailoringAdminSessionSummary[]> {
    const rows = await this.repository.listRecentSessionsUnscoped(limit);
    const costRows = await this.repository.listRunCostRowsBySessions(rows.map((row) => row.session.id));

    return rows.map(({ session, user_email }) => {
      const runs = costRows.filter((row) => row.tailoring_session_id === session.id);
      const known = runs.filter((row) => row.cost_usd !== null);
      return {
        session_id: session.id,
        user_email,
        job_title: session.job_snapshot.job_title,
        company_name: session.job_snapshot.company_name,
        status: session.status,
        created_at: session.created_at,
        run_count: runs.length,
        total_tokens: runs.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0),
        cost_usd: known.length > 0 ? roundUsd(known.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)) : null,
        cost_complete: known.length === runs.length
      };
    });
  }

  async getCostReport(sessionId: string): Promise<TailoringCostReport> {
    const row = await this.repository.findSessionByIdUnscoped(sessionId);
    if (!row) {
      throw new NotFoundError("Tailoring session was not found");
    }

    const runs = (await this.aiRepository.listRunsByTailoringSession?.(sessionId)) ?? [];
    const costRuns: TailoringCostRun[] = runs.map((run) => {
      const flowInput = asRecord(asRecord(run.input_payload).flow_input);
      return {
        ai_run_id: run.id,
        flow_type: run.flow_type,
        step: describeRunStep(run.flow_type, flowInput),
        status: run.status,
        model_name: run.model_name,
        input_tokens: run.input_tokens ?? 0,
        cached_input_tokens: run.cached_input_tokens ?? 0,
        output_tokens: run.output_tokens ?? 0,
        reasoning_tokens: run.reasoning_tokens ?? 0,
        total_tokens: run.total_tokens ?? 0,
        cost_usd: run.cost_usd ?? null,
        duration_ms: run.completed_at ? Date.parse(run.completed_at) - Date.parse(run.started_at) : null,
        started_at: run.started_at
      };
    });

    const known = costRuns.filter((run) => run.cost_usd !== null);
    const sum = (key: keyof Pick<TailoringCostRun, "input_tokens" | "cached_input_tokens" | "output_tokens" | "reasoning_tokens" | "total_tokens">) =>
      costRuns.reduce((total, run) => total + run[key], 0);

    const steps = new Map<string, { step: string; run_count: number; total_tokens: number; costs: Array<number | null> }>();
    for (const run of costRuns) {
      const stepKey = stepGroup(run.flow_type, run.step);
      const entry = steps.get(stepKey) ?? { step: stepKey, run_count: 0, total_tokens: 0, costs: [] };
      entry.run_count += 1;
      entry.total_tokens += run.total_tokens;
      entry.costs.push(run.cost_usd);
      steps.set(stepKey, entry);
    }

    return {
      session_id: row.session.id,
      user_email: row.user_email,
      job_title: row.session.job_snapshot.job_title,
      status: row.session.status,
      created_at: row.session.created_at,
      totals: {
        run_count: costRuns.length,
        failed_run_count: costRuns.filter((run) => run.status === "failed").length,
        input_tokens: sum("input_tokens"),
        cached_input_tokens: sum("cached_input_tokens"),
        output_tokens: sum("output_tokens"),
        reasoning_tokens: sum("reasoning_tokens"),
        total_tokens: sum("total_tokens"),
        cost_usd: known.length > 0 ? roundUsd(known.reduce((total, run) => total + (run.cost_usd ?? 0), 0)) : null,
        cost_complete: known.length === costRuns.length
      },
      by_step: [...steps.values()].map((entry) => ({
        step: entry.step,
        run_count: entry.run_count,
        total_tokens: entry.total_tokens,
        cost_usd: entry.costs.some((cost) => cost !== null)
          ? roundUsd(entry.costs.reduce<number>((total, cost) => total + (cost ?? 0), 0))
          : null
      })),
      runs: costRuns
    };
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  private async buildView(session: SessionContext, record: TailoringSessionRecord): Promise<TailoringSessionView> {
    const userId = session.appUser.id;
    const tailoredCvId = record.tailored_cv_id;
    if (tailoredCvId === null) {
      throw new NotFoundError("Tailoring session was not found");
    }
    const [tasks, suggestions, preferences] = await Promise.all([
      this.repository.listTasks(userId, record.id),
      this.repository.listSuggestions(userId, record.id),
      this.repository.getPreferences(userId)
    ]);

    return {
      session: {
        id: record.id,
        tailored_cv_id: tailoredCvId,
        job_id: record.job_id,
        status: record.status,
        job: record.job_snapshot,
        analysis: record.analysis,
        requirement_decisions: record.requirement_decisions,
        answers: record.answers,
        questions_completed: record.questions_completed,
        error_message: record.error_message,
        created_at: record.created_at,
        finished_at: record.finished_at
      },
      tasks: tasks.map((task) => this.toTaskView(task)),
      suggestions: suggestions.map((suggestion) => this.toSuggestionView(suggestion)),
      score: computeTailoringScore(record.analysis, record.requirement_decisions, record.answers, suggestions),
      preferences,
      viewer: { is_admin: this.isAdmin(session) }
    };
  }

  private async buildTaskResponse(
    userId: string,
    session: TailoringSessionRecord,
    task: TailoringTaskRecord
  ): Promise<TailoringTaskRunResponse> {
    const suggestions = await this.repository.listSuggestions(userId, session.id);
    return {
      task: this.toTaskView(task),
      suggestions: suggestions
        .filter((suggestion) => suggestion.tailoring_task_id === task.id)
        .map((suggestion) => this.toSuggestionView(suggestion)),
      session_status: session.status,
      score: computeTailoringScore(session.analysis, session.requirement_decisions, session.answers, suggestions)
    };
  }

  private toTaskView(task: TailoringTaskRecord): TailoringTaskView {
    return {
      id: task.id,
      kind: task.kind,
      block_id: task.block_id,
      section_id: task.section_id,
      status: task.status,
      depends_on_question_ids: task.depends_on_question_ids,
      error_message: task.error_message,
      updated_at: task.updated_at
    };
  }

  private toSuggestionView(suggestion: TailoringSuggestionRecord): TailoringSuggestionView {
    return {
      id: suggestion.id,
      task_id: suggestion.tailoring_task_id,
      kind: suggestion.kind,
      block_id: suggestion.block_id,
      section_id: typeof suggestion.meta.section_id === "string" ? suggestion.meta.section_id : null,
      before: suggestion.before_content,
      suggested: suggestion.suggested_content,
      rationale: suggestion.rationale,
      requirement_ids: suggestion.requirement_ids,
      add_to_main: suggestion.meta.add_to_main === true,
      guard_notes: asStringArray(suggestion.meta.guard_notes),
      status: suggestion.status,
      created_at: suggestion.created_at
    };
  }

  private async requireSession(userId: string, sessionId: string): Promise<ActiveTailoringSession> {
    const record = await this.repository.findSessionById(userId, sessionId);
    if (!record || record.status === "archived" || record.tailored_cv_id === null) {
      throw new NotFoundError("Tailoring session was not found");
    }
    return record as ActiveTailoringSession;
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string | null): Promise<TailoredCvRecord> {
    const tailored = tailoredCvId ? await this.tailoredCvRepository.findById(userId, tailoredCvId) : null;
    if (!tailored) {
      throw new NotFoundError("Tailored CV was not found");
    }
    return tailored;
  }
}

const roundUsd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const describeRunStep = (flowType: string, flowInput: Record<string, unknown>): string => {
  switch (flowType) {
    case "tailoring_analysis":
      return "Match analysis";
    case "tailoring_skills":
      return "Skills";
    case "tailoring_structure":
      return "Section order";
    case "tailoring_block": {
      const block = asRecord(flowInput.block);
      const refined = typeof flowInput.refinement === "string" ? " (quick fix)" : "";
      if (block.kind === "summary" || block.kind === "new_summary") return `Summary${refined}`;
      const title = [block.title, block.subtitle].filter((part) => typeof part === "string" && part).join(" · ");
      return `Block: ${title || "untitled"}${refined}`;
    }
    default:
      return flowType;
  }
};

const stepGroup = (flowType: string, step: string): string => {
  if (flowType === "tailoring_block") {
    if (step.endsWith("(quick fix)")) return "Quick fixes";
    return step.startsWith("Summary") ? "Summary" : "Block rewrites";
  }
  return step;
};

