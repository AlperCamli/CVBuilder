import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type {
  CreateTailoringSuggestionPayload,
  TailoringAnalysis,
  TailoringJobSnapshot,
  TailoringPreferences,
  TailoringSessionRecord,
  TailoringSessionStatus,
  TailoringSuggestionRecord,
  TailoringSuggestionStatus,
  TailoringTaskRecord,
  TailoringTaskStatus
} from "./tailoring.types";

export interface CreateTailoringSessionPayload {
  user_id: string;
  tailored_cv_id: string;
  job_id: string | null;
  job_snapshot: TailoringJobSnapshot;
  base_snapshot: CvContent;
}

export interface UpdateTailoringSessionPayload {
  status?: TailoringSessionStatus;
  analysis?: TailoringAnalysis | null;
  analysis_run_id?: string | null;
  questions_completed?: boolean;
  error_message?: string | null;
  finished_at?: string | null;
}

export type CreateTailoringTaskPayload = Pick<
  TailoringTaskRecord,
  "session_id" | "user_id" | "kind" | "block_id" | "section_id" | "status" | "depends_on_question_ids" | "brief"
>;

export interface UpdateTailoringTaskPayload {
  status?: TailoringTaskStatus;
  ai_run_id?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface TailoringAdminSessionRow {
  session: TailoringSessionRecord;
  user_email: string | null;
}

export interface TailoringRepository {
  createSession(payload: CreateTailoringSessionPayload): Promise<TailoringSessionRecord>;
  findSessionById(userId: string, sessionId: string): Promise<TailoringSessionRecord | null>;
  findActiveSessionByTailoredCv(userId: string, tailoredCvId: string): Promise<TailoringSessionRecord | null>;
  updateSession(userId: string, sessionId: string, payload: UpdateTailoringSessionPayload): Promise<TailoringSessionRecord | null>;
  // Moves the session to `to` only while it is in one of `from` (single-flight guard).
  claimSessionStatus(userId: string, sessionId: string, from: TailoringSessionStatus[], to: TailoringSessionStatus): Promise<TailoringSessionRecord | null>;
  mergeSessionJson(userId: string, sessionId: string, column: "answers" | "requirement_decisions", patch: Record<string, unknown>): Promise<TailoringSessionRecord | null>;
  archiveActiveSessions(userId: string, tailoredCvId: string): Promise<void>;

  createTasks(payloads: CreateTailoringTaskPayload[]): Promise<TailoringTaskRecord[]>;
  // Removes every task of the session (a retried analysis replaces them).
  deleteTasks(userId: string, sessionId: string): Promise<void>;
  listTasks(userId: string, sessionId: string): Promise<TailoringTaskRecord[]>;
  findTask(userId: string, sessionId: string, taskId: string): Promise<TailoringTaskRecord | null>;
  // Claims a runnable task: ready/failed, done/skipped when allowDone (regenerate), or
  // running but started before staleBeforeIso. Clears rerun_for_answer (the run uses the answers).
  claimTask(userId: string, sessionId: string, taskId: string, staleBeforeIso: string, allowDone: boolean): Promise<TailoringTaskRecord | null>;
  updateTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload): Promise<TailoringTaskRecord | null>;
  // Ends a run with `payload`, unless an answer re-queued the task while it ran
  // (rerun_for_answer set again): then the task goes back to "ready" for another run.
  completeTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload): Promise<TailoringTaskRecord | null>;
  markTasksReady(userId: string, sessionId: string, taskIds: string[]): Promise<void>;
  // An answer changed: finished tasks (done/failed/skipped) go back to "ready" with
  // rerun_for_answer; running ones only get the flag (completeTask re-queues them).
  // Returns the ids that were moved back to "ready".
  requeueTasksForAnswer(userId: string, sessionId: string, taskIds: string[]): Promise<string[]>;

  createSuggestions(payloads: CreateTailoringSuggestionPayload[]): Promise<TailoringSuggestionRecord[]>;
  listSuggestions(userId: string, sessionId: string): Promise<TailoringSuggestionRecord[]>;
  findSuggestion(userId: string, sessionId: string, suggestionId: string): Promise<TailoringSuggestionRecord | null>;
  // Moves the status only from `from`; suggestedContent replaces the card value (inline edit).
  updateSuggestionStatus(
    userId: string,
    suggestionId: string,
    from: TailoringSuggestionStatus[],
    to: TailoringSuggestionStatus,
    suggestedContent?: Record<string, unknown>
  ): Promise<TailoringSuggestionRecord | null>;
  // Expires the task's pending cards except keepIds (the cards that replace them).
  expirePendingTaskSuggestions(userId: string, taskId: string, keepIds?: string[]): Promise<void>;
  updateSuggestionMeta(userId: string, suggestionId: string, meta: Record<string, unknown>): Promise<TailoringSuggestionRecord | null>;

  getPreferences(userId: string): Promise<TailoringPreferences>;
  updatePreferences(userId: string, patch: Partial<TailoringPreferences>): Promise<TailoringPreferences>;

  unlinkJobFromTailoredCv(userId: string, jobId: string): Promise<void>;

  // Admin (not owner-scoped).
  findSessionByIdUnscoped(sessionId: string): Promise<TailoringAdminSessionRow | null>;
  listRecentSessionsUnscoped(limit: number): Promise<TailoringAdminSessionRow[]>;
  listRunCostRowsBySessions(sessionIds: string[]): Promise<TailoringRunCostRow[]>;
}

export interface TailoringRunCostRow {
  tailoring_session_id: string;
  total_tokens: number | null;
  cost_usd: number | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const toSessionRecord = (row: Record<string, unknown>): TailoringSessionRecord => ({
  id: String(row.id),
  user_id: String(row.user_id),
  tailored_cv_id: (row.tailored_cv_id as string | null) ?? null,
  job_id: (row.job_id as string | null) ?? null,
  status: row.status as TailoringSessionStatus,
  job_snapshot: {
    job_title: String(asRecord(row.job_snapshot).job_title ?? ""),
    company_name: String(asRecord(row.job_snapshot).company_name ?? ""),
    job_description: String(asRecord(row.job_snapshot).job_description ?? "")
  },
  analysis: (row.analysis as TailoringAnalysis | null) ?? null,
  analysis_run_id: (row.analysis_run_id as string | null) ?? null,
  requirement_decisions: asRecord(row.requirement_decisions) as TailoringSessionRecord["requirement_decisions"],
  answers: asRecord(row.answers) as TailoringSessionRecord["answers"],
  questions_completed: Boolean(row.questions_completed),
  base_snapshot: row.base_snapshot as CvContent,
  error_message: (row.error_message as string | null) ?? null,
  finished_at: (row.finished_at as string | null) ?? null,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const toTaskRecord = (row: Record<string, unknown>): TailoringTaskRecord => ({
  id: String(row.id),
  session_id: String(row.session_id),
  user_id: String(row.user_id),
  kind: row.kind as TailoringTaskRecord["kind"],
  block_id: (row.block_id as string | null) ?? null,
  section_id: (row.section_id as string | null) ?? null,
  status: row.status as TailoringTaskStatus,
  depends_on_question_ids: Array.isArray(row.depends_on_question_ids) ? (row.depends_on_question_ids as string[]) : [],
  brief: asRecord(row.brief) as TailoringTaskRecord["brief"],
  ai_run_id: (row.ai_run_id as string | null) ?? null,
  attempts: Number(row.attempts ?? 0),
  rerun_for_answer: row.rerun_for_answer === true,
  error_message: (row.error_message as string | null) ?? null,
  started_at: (row.started_at as string | null) ?? null,
  completed_at: (row.completed_at as string | null) ?? null,
  created_at: String(row.created_at),
  updated_at: String(row.updated_at)
});

const toSuggestionRecord = (row: Record<string, unknown>): TailoringSuggestionRecord => ({
  id: String(row.id),
  ai_run_id: String(row.ai_run_id),
  user_id: String(row.user_id),
  tailored_cv_id: String(row.tailored_cv_id),
  tailoring_session_id: String(row.tailoring_session_id),
  tailoring_task_id: (row.tailoring_task_id as string | null) ?? null,
  kind: row.kind as TailoringSuggestionRecord["kind"],
  block_id: (row.block_id as string | null) ?? null,
  before_content: (row.before_content as Record<string, unknown> | null) ?? null,
  suggested_content: asRecord(row.suggested_content),
  rationale: String(row.rationale ?? ""),
  requirement_ids: Array.isArray(row.requirement_ids) ? (row.requirement_ids as string[]) : [],
  meta: asRecord(row.meta),
  status: row.status as TailoringSuggestionStatus,
  applied_at: (row.applied_at as string | null) ?? null,
  created_at: String(row.created_at)
});

const fail = (message: string, reason: string): never => {
  throw new InternalServerError(message, { reason });
};

export class SupabaseTailoringRepository implements TailoringRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createSession(payload: CreateTailoringSessionPayload): Promise<TailoringSessionRecord> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .insert({ ...payload, status: "draft" })
      .select("*")
      .single();
    if (error) fail("Failed to create tailoring session", error.message);
    return toSessionRecord(data as Record<string, unknown>);
  }

  async findSessionById(userId: string, sessionId: string): Promise<TailoringSessionRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("Failed to load tailoring session", error.message);
    return data ? toSessionRecord(data as Record<string, unknown>) : null;
  }

  async findActiveSessionByTailoredCv(userId: string, tailoredCvId: string): Promise<TailoringSessionRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .neq("status", "archived")
      .maybeSingle();
    if (error) fail("Failed to load tailoring session", error.message);
    return data ? toSessionRecord(data as Record<string, unknown>) : null;
  }

  async updateSession(userId: string, sessionId: string, payload: UpdateTailoringSessionPayload): Promise<TailoringSessionRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .update(payload)
      .eq("id", sessionId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring session", error.message);
    return data ? toSessionRecord(data as Record<string, unknown>) : null;
  }

  async claimSessionStatus(
    userId: string,
    sessionId: string,
    from: TailoringSessionStatus[],
    to: TailoringSessionStatus
  ): Promise<TailoringSessionRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .update({ status: to, error_message: null })
      .eq("id", sessionId)
      .eq("user_id", userId)
      .in("status", from)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring session status", error.message);
    return data ? toSessionRecord(data as Record<string, unknown>) : null;
  }

  async mergeSessionJson(
    userId: string,
    sessionId: string,
    column: "answers" | "requirement_decisions",
    patch: Record<string, unknown>
  ): Promise<TailoringSessionRecord | null> {
    const { data, error } = await this.db
      .rpc("tailoring_merge_session_json", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_column: column,
        p_patch: patch
      })
      .maybeSingle();
    if (error) fail("Failed to update tailoring session", error.message);
    const row = data as Record<string, unknown> | null;
    return row?.id ? toSessionRecord(row) : null;
  }

  async archiveActiveSessions(userId: string, tailoredCvId: string): Promise<void> {
    const { error } = await this.db
      .from("tailoring_sessions")
      .update({ status: "archived" })
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .neq("status", "archived");
    if (error) fail("Failed to archive tailoring session", error.message);
  }

  async createTasks(payloads: CreateTailoringTaskPayload[]): Promise<TailoringTaskRecord[]> {
    if (payloads.length === 0) return [];
    const { data, error } = await this.db.from("tailoring_session_tasks").insert(payloads).select("*");
    if (error) fail("Failed to create tailoring tasks", error.message);
    return (data ?? []).map((row) => toTaskRecord(row as Record<string, unknown>));
  }

  async deleteTasks(userId: string, sessionId: string): Promise<void> {
    const { error } = await this.db
      .from("tailoring_session_tasks")
      .delete()
      .eq("user_id", userId)
      .eq("session_id", sessionId);
    if (error) fail("Failed to reset tailoring tasks", error.message);
  }

  async listTasks(userId: string, sessionId: string): Promise<TailoringTaskRecord[]> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .select("*")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) fail("Failed to list tailoring tasks", error.message);
    return (data ?? []).map((row) => toTaskRecord(row as Record<string, unknown>));
  }

  async findTask(userId: string, sessionId: string, taskId: string): Promise<TailoringTaskRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("Failed to load tailoring task", error.message);
    return data ? toTaskRecord(data as Record<string, unknown>) : null;
  }

  async claimTask(
    userId: string,
    sessionId: string,
    taskId: string,
    staleBeforeIso: string,
    allowDone: boolean
  ): Promise<TailoringTaskRecord | null> {
    const current = await this.findTask(userId, sessionId, taskId);
    if (!current) return null;
    const runnable =
      current.status === "ready" ||
      current.status === "failed" ||
      (allowDone && (current.status === "done" || current.status === "skipped")) ||
      (current.status === "running" && (current.started_at ?? "") < staleBeforeIso);
    if (!runnable) return null;

    // Compare-and-set on the status/attempts we read, so two requests cannot both claim it.
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .update({
        status: "running",
        attempts: current.attempts + 1,
        started_at: new Date().toISOString(),
        error_message: null,
        rerun_for_answer: false
      })
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("status", current.status)
      .eq("attempts", current.attempts)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to claim tailoring task", error.message);
    return data ? toTaskRecord(data as Record<string, unknown>) : null;
  }

  async updateTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload): Promise<TailoringTaskRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .update(payload)
      .eq("id", taskId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring task", error.message);
    return data ? toTaskRecord(data as Record<string, unknown>) : null;
  }

  async completeTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload): Promise<TailoringTaskRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .update(payload)
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("status", "running")
      .eq("rerun_for_answer", false)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring task", error.message);
    if (data) return toTaskRecord(data as Record<string, unknown>);

    // Re-queued by an answer during the run (or no longer running): keep the flag and let
    // the runner pick it up again.
    const current = await this.updateTaskWhere(userId, taskId, { ...payload, status: "ready" }, { status: "running", rerun_for_answer: true });
    return current ?? this.findTaskById(userId, taskId);
  }

  private async updateTaskWhere(
    userId: string,
    taskId: string,
    payload: UpdateTailoringTaskPayload,
    where: { status: TailoringTaskStatus; rerun_for_answer: boolean }
  ): Promise<TailoringTaskRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .update(payload)
      .eq("id", taskId)
      .eq("user_id", userId)
      .eq("status", where.status)
      .eq("rerun_for_answer", where.rerun_for_answer)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring task", error.message);
    return data ? toTaskRecord(data as Record<string, unknown>) : null;
  }

  private async findTaskById(userId: string, taskId: string): Promise<TailoringTaskRecord | null> {
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("Failed to load tailoring task", error.message);
    return data ? toTaskRecord(data as Record<string, unknown>) : null;
  }

  async requeueTasksForAnswer(userId: string, sessionId: string, taskIds: string[]): Promise<string[]> {
    if (taskIds.length === 0) return [];
    const { data, error } = await this.db
      .from("tailoring_session_tasks")
      .update({ status: "ready", rerun_for_answer: true, error_message: null })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .in("status", ["done", "failed", "skipped"])
      .in("id", taskIds)
      .select("id");
    if (error) fail("Failed to re-queue tailoring tasks", error.message);

    const { error: runningError } = await this.db
      .from("tailoring_session_tasks")
      .update({ rerun_for_answer: true })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("status", "running")
      .in("id", taskIds);
    if (runningError) fail("Failed to re-queue tailoring tasks", runningError.message);

    return (data ?? []).map((row) => String((row as Record<string, unknown>).id));
  }

  async markTasksReady(userId: string, sessionId: string, taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    const { error } = await this.db
      .from("tailoring_session_tasks")
      .update({ status: "ready" })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("status", "waiting")
      .in("id", taskIds);
    if (error) fail("Failed to update tailoring tasks", error.message);
  }

  async createSuggestions(payloads: CreateTailoringSuggestionPayload[]): Promise<TailoringSuggestionRecord[]> {
    if (payloads.length === 0) return [];
    const { data, error } = await this.db
      .from("ai_suggestions")
      .insert(payloads.map((payload) => ({ ...payload, action_type: "tailor", status: "pending" })))
      .select("*");
    if (error) fail("Failed to save tailoring suggestions", error.message);
    return (data ?? []).map((row) => toSuggestionRecord(row as Record<string, unknown>));
  }

  async listSuggestions(userId: string, sessionId: string): Promise<TailoringSuggestionRecord[]> {
    const { data, error } = await this.db
      .from("ai_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("tailoring_session_id", sessionId)
      .neq("status", "expired")
      .order("created_at", { ascending: true });
    if (error) fail("Failed to list tailoring suggestions", error.message);
    return (data ?? []).map((row) => toSuggestionRecord(row as Record<string, unknown>));
  }

  async findSuggestion(userId: string, sessionId: string, suggestionId: string): Promise<TailoringSuggestionRecord | null> {
    const { data, error } = await this.db
      .from("ai_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .eq("user_id", userId)
      .eq("tailoring_session_id", sessionId)
      .maybeSingle();
    if (error) fail("Failed to load tailoring suggestion", error.message);
    return data ? toSuggestionRecord(data as Record<string, unknown>) : null;
  }

  async updateSuggestionStatus(
    userId: string,
    suggestionId: string,
    from: TailoringSuggestionStatus[],
    to: TailoringSuggestionStatus,
    suggestedContent?: Record<string, unknown>
  ): Promise<TailoringSuggestionRecord | null> {
    const { data, error } = await this.db
      .from("ai_suggestions")
      .update({
        status: to,
        applied_at: to === "applied" ? new Date().toISOString() : null,
        ...(suggestedContent ? { suggested_content: suggestedContent } : {})
      })
      .eq("id", suggestionId)
      .eq("user_id", userId)
      .in("status", from)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring suggestion", error.message);
    return data ? toSuggestionRecord(data as Record<string, unknown>) : null;
  }

  async expirePendingTaskSuggestions(userId: string, taskId: string, keepIds: string[] = []): Promise<void> {
    let query = this.db
      .from("ai_suggestions")
      .update({ status: "expired", applied_at: null })
      .eq("user_id", userId)
      .eq("tailoring_task_id", taskId)
      .eq("status", "pending");
    if (keepIds.length > 0) {
      query = query.not("id", "in", `(${keepIds.join(",")})`);
    }
    const { error } = await query;
    if (error) fail("Failed to expire tailoring suggestions", error.message);
  }

  async updateSuggestionMeta(
    userId: string,
    suggestionId: string,
    meta: Record<string, unknown>
  ): Promise<TailoringSuggestionRecord | null> {
    const { data, error } = await this.db
      .from("ai_suggestions")
      .update({ meta })
      .eq("id", suggestionId)
      .eq("user_id", userId)
      .not("tailoring_session_id", "is", null)
      .select("*")
      .maybeSingle();
    if (error) fail("Failed to update tailoring suggestion", error.message);
    return data ? toSuggestionRecord(data as Record<string, unknown>) : null;
  }

  async getPreferences(userId: string): Promise<TailoringPreferences> {
    const { data, error } = await this.db.from("users").select("preferences").eq("id", userId).maybeSingle();
    if (error) fail("Failed to load preferences", error.message);
    const preferences = asRecord(asRecord(data).preferences);
    return { auto_apply: preferences.tailoring_auto_apply === true };
  }

  async updatePreferences(userId: string, patch: Partial<TailoringPreferences>): Promise<TailoringPreferences> {
    const { data, error } = await this.db.from("users").select("preferences").eq("id", userId).maybeSingle();
    if (error) fail("Failed to load preferences", error.message);
    const next = {
      ...asRecord(asRecord(data).preferences),
      ...(patch.auto_apply !== undefined ? { tailoring_auto_apply: patch.auto_apply } : {})
    };
    const { error: updateError } = await this.db.from("users").update({ preferences: next }).eq("id", userId);
    if (updateError) fail("Failed to save preferences", updateError.message);
    return { auto_apply: next.tailoring_auto_apply === true };
  }

  async unlinkJobFromTailoredCv(userId: string, jobId: string): Promise<void> {
    const { error } = await this.db
      .from("jobs")
      .update({ tailored_cv_id: null })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (error) fail("Failed to unlink job", error.message);
  }

  async findSessionByIdUnscoped(sessionId: string): Promise<TailoringAdminSessionRow | null> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .select("*, users(email)")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) fail("Failed to load tailoring session", error.message);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return { session: toSessionRecord(row), user_email: (asRecord(row.users).email as string | undefined) ?? null };
  }

  async listRecentSessionsUnscoped(limit: number): Promise<TailoringAdminSessionRow[]> {
    const { data, error } = await this.db
      .from("tailoring_sessions")
      .select("*, users(email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("Failed to list tailoring sessions", error.message);
    return (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return { session: toSessionRecord(row), user_email: (asRecord(row.users).email as string | undefined) ?? null };
    });
  }

  async listRunCostRowsBySessions(sessionIds: string[]): Promise<TailoringRunCostRow[]> {
    if (sessionIds.length === 0) return [];
    const { data, error } = await this.db
      .from("ai_runs")
      .select("tailoring_session_id,total_tokens,cost_usd")
      .in("tailoring_session_id", sessionIds);
    if (error) fail("Failed to load tailoring run costs", error.message);
    return (data ?? []).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        tailoring_session_id: String(row.tailoring_session_id),
        total_tokens: (row.total_tokens as number | null) ?? null,
        cost_usd: row.cost_usd == null ? null : Number(row.cost_usd)
      };
    });
  }
}
