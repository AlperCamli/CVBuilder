import { randomUUID } from "node:crypto";
import type {
  CreateTailoringSessionPayload,
  CreateTailoringTaskPayload,
  TailoringAdminSessionRow,
  TailoringRepository,
  TailoringRunCostRow,
  UpdateTailoringSessionPayload,
  UpdateTailoringTaskPayload
} from "../../src/modules/tailoring/tailoring.repository";
import type {
  CreateTailoringSuggestionPayload,
  TailoringPreferences,
  TailoringSessionRecord,
  TailoringSessionStatus,
  TailoringSuggestionRecord,
  TailoringSuggestionStatus,
  TailoringTaskRecord
} from "../../src/modules/tailoring/tailoring.types";

const now = () => new Date().toISOString();

export class InMemoryTailoringRepository implements TailoringRepository {
  sessions = new Map<string, TailoringSessionRecord>();
  tasks = new Map<string, TailoringTaskRecord>();
  suggestions = new Map<string, TailoringSuggestionRecord>();
  preferences = new Map<string, TailoringPreferences>();
  unlinkedJobIds: string[] = [];
  runCostRows: TailoringRunCostRow[] = [];
  userEmails = new Map<string, string>();

  async createSession(payload: CreateTailoringSessionPayload) {
    const record: TailoringSessionRecord = {
      id: randomUUID(),
      ...payload,
      status: "draft",
      analysis: null,
      analysis_run_id: null,
      requirement_decisions: {},
      answers: {},
      questions_completed: false,
      error_message: null,
      finished_at: null,
      created_at: now(),
      updated_at: now()
    };
    this.sessions.set(record.id, record);
    return { ...record };
  }

  async findSessionById(userId: string, sessionId: string) {
    const record = this.sessions.get(sessionId);
    return record && record.user_id === userId ? { ...record } : null;
  }

  async findActiveSessionByTailoredCv(userId: string, tailoredCvId: string) {
    const record = [...this.sessions.values()].find(
      (item) => item.user_id === userId && item.tailored_cv_id === tailoredCvId && item.status !== "archived"
    );
    return record ? { ...record } : null;
  }

  async updateSession(userId: string, sessionId: string, payload: UpdateTailoringSessionPayload) {
    const record = this.sessions.get(sessionId);
    if (!record || record.user_id !== userId) return null;
    Object.assign(record, payload, { updated_at: now() });
    return { ...record };
  }

  async claimSessionStatus(userId: string, sessionId: string, from: TailoringSessionStatus[], to: TailoringSessionStatus) {
    const record = this.sessions.get(sessionId);
    if (!record || record.user_id !== userId || !from.includes(record.status)) return null;
    record.status = to;
    record.error_message = null;
    record.updated_at = now();
    return { ...record };
  }

  async mergeSessionJson(userId: string, sessionId: string, column: "answers" | "requirement_decisions", patch: Record<string, unknown>) {
    const record = this.sessions.get(sessionId);
    if (!record || record.user_id !== userId) return null;
    record[column] = { ...record[column], ...patch } as never;
    return { ...record };
  }

  async archiveActiveSessions(userId: string, tailoredCvId: string) {
    for (const record of this.sessions.values()) {
      if (record.user_id === userId && record.tailored_cv_id === tailoredCvId) record.status = "archived";
    }
  }

  async createTasks(payloads: CreateTailoringTaskPayload[]) {
    return payloads.map((payload) => {
      const record: TailoringTaskRecord = {
        id: randomUUID(),
        ...payload,
        ai_run_id: null,
        attempts: 0,
        rerun_for_answer: false,
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: now(),
        updated_at: now()
      };
      this.tasks.set(record.id, record);
      return { ...record };
    });
  }

  async deleteTasks(userId: string, sessionId: string) {
    for (const [id, task] of this.tasks) {
      if (task.user_id === userId && task.session_id === sessionId) this.tasks.delete(id);
    }
  }

  async listTasks(userId: string, sessionId: string) {
    return [...this.tasks.values()]
      .filter((task) => task.user_id === userId && task.session_id === sessionId)
      .map((task) => ({ ...task }));
  }

  async findTask(userId: string, sessionId: string, taskId: string) {
    const task = this.tasks.get(taskId);
    return task && task.user_id === userId && task.session_id === sessionId ? { ...task } : null;
  }

  async claimTask(userId: string, sessionId: string, taskId: string, staleBeforeIso: string, allowDone: boolean) {
    const task = this.tasks.get(taskId);
    if (!task || task.user_id !== userId || task.session_id !== sessionId) return null;
    const runnable =
      task.status === "ready" ||
      task.status === "failed" ||
      (allowDone && (task.status === "done" || task.status === "skipped")) ||
      (task.status === "running" && (task.started_at ?? "") < staleBeforeIso);
    if (!runnable) return null;
    Object.assign(task, { status: "running", attempts: task.attempts + 1, started_at: now(), error_message: null, rerun_for_answer: false });
    return { ...task };
  }

  async updateTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload) {
    const task = this.tasks.get(taskId);
    if (!task || task.user_id !== userId) return null;
    Object.assign(task, payload, { updated_at: now() });
    return { ...task };
  }

  async completeTask(userId: string, taskId: string, payload: UpdateTailoringTaskPayload) {
    const task = this.tasks.get(taskId);
    if (!task || task.user_id !== userId) return null;
    if (task.status === "running" && !task.rerun_for_answer) {
      Object.assign(task, payload, { updated_at: now() });
    } else if (task.status === "running") {
      Object.assign(task, payload, { status: "ready", updated_at: now() });
    }
    return { ...task };
  }

  async requeueTasksForAnswer(userId: string, sessionId: string, taskIds: string[]) {
    const moved: string[] = [];
    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (!task || task.user_id !== userId || task.session_id !== sessionId) continue;
      if (["done", "failed", "skipped"].includes(task.status)) {
        Object.assign(task, { status: "ready", rerun_for_answer: true, error_message: null, updated_at: now() });
        moved.push(id);
      } else if (task.status === "running") {
        task.rerun_for_answer = true;
      }
    }
    return moved;
  }

  async markTasksReady(userId: string, sessionId: string, taskIds: string[]) {
    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (task && task.user_id === userId && task.session_id === sessionId && task.status === "waiting") {
        task.status = "ready";
      }
    }
  }

  async createSuggestions(payloads: CreateTailoringSuggestionPayload[]) {
    return payloads.map((payload) => {
      const record: TailoringSuggestionRecord = {
        id: randomUUID(),
        ...payload,
        status: "pending",
        applied_at: null,
        created_at: now()
      };
      this.suggestions.set(record.id, record);
      return { ...record };
    });
  }

  async listSuggestions(userId: string, sessionId: string) {
    return [...this.suggestions.values()]
      .filter((item) => item.user_id === userId && item.tailoring_session_id === sessionId && item.status !== "expired")
      .map((item) => ({ ...item }));
  }

  async findSuggestion(userId: string, sessionId: string, suggestionId: string) {
    const item = this.suggestions.get(suggestionId);
    return item && item.user_id === userId && item.tailoring_session_id === sessionId ? { ...item } : null;
  }

  async updateSuggestionStatus(
    userId: string,
    suggestionId: string,
    from: TailoringSuggestionStatus[],
    to: TailoringSuggestionStatus,
    suggestedContent?: Record<string, unknown>
  ) {
    const item = this.suggestions.get(suggestionId);
    if (!item || item.user_id !== userId || !from.includes(item.status)) return null;
    item.status = to;
    item.applied_at = to === "applied" ? now() : null;
    if (suggestedContent) item.suggested_content = suggestedContent;
    return { ...item };
  }

  async expirePendingTaskSuggestions(userId: string, taskId: string, keepIds: string[] = []) {
    for (const item of this.suggestions.values()) {
      if (item.user_id === userId && item.tailoring_task_id === taskId && item.status === "pending" && !keepIds.includes(item.id)) item.status = "expired";
    }
  }

  async updateSuggestionMeta(userId: string, suggestionId: string, meta: Record<string, unknown>) {
    const item = this.suggestions.get(suggestionId);
    if (!item || item.user_id !== userId) return null;
    item.meta = meta;
    return { ...item };
  }

  async getPreferences(userId: string) {
    return this.preferences.get(userId) ?? { auto_apply: false };
  }

  async updatePreferences(userId: string, patch: Partial<TailoringPreferences>) {
    const next = { ...(await this.getPreferences(userId)), ...patch };
    this.preferences.set(userId, next);
    return next;
  }

  async unlinkJobFromTailoredCv(_userId: string, jobId: string) {
    this.unlinkedJobIds.push(jobId);
  }

  async findSessionByIdUnscoped(sessionId: string): Promise<TailoringAdminSessionRow | null> {
    const record = this.sessions.get(sessionId);
    return record ? { session: { ...record }, user_email: this.userEmails.get(record.user_id) ?? null } : null;
  }

  async listRecentSessionsUnscoped(limit: number): Promise<TailoringAdminSessionRow[]> {
    return [...this.sessions.values()]
      .slice(0, limit)
      .map((record) => ({ session: { ...record }, user_email: this.userEmails.get(record.user_id) ?? null }));
  }

  async listRunCostRowsBySessions(sessionIds: string[]) {
    return this.runCostRows.filter((row) => sessionIds.includes(row.tailoring_session_id));
  }
}
