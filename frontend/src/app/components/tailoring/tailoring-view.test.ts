import { describe, expect, it } from "vitest";
import type { TailoringSessionView, TailoringSuggestion, TailoringTask } from "../../integration/tailoring-types";
import { refineSuggestionsForBlock } from "./RefineArea";
import { ApiClientError } from "../../integration/api-error";
import { applyTailoringTaskResult, isRefineBusyError, mergeTailoringViews } from "./tailoring-view";

const task = (id: string, patch: Partial<TailoringTask> = {}): TailoringTask => ({
  id,
  kind: "block",
  block_id: `block-${id}`,
  section_id: null,
  status: "done",
  depends_on_question_ids: [],
  error_message: null,
  updated_at: "2026-10-27T10:00:00.000Z",
  ...patch
});

const suggestion = (id: string, patch: Partial<TailoringSuggestion> = {}): TailoringSuggestion => ({
  id,
  task_id: "t1",
  kind: "rewrite",
  block_id: "block-t1",
  section_id: null,
  before: { field: "description", value: "a" },
  suggested: { field: "description", value: "b" },
  rationale: "",
  requirement_ids: [],
  add_to_main: false,
  guard_notes: [],
  status: "pending",
  created_at: "2026-10-27T10:00:00.000Z",
  ...patch
});

const view = (patch: Partial<TailoringSessionView> = {}, status: TailoringSessionView["session"]["status"] = "ready"): TailoringSessionView => ({
  session: {
    id: "session-1",
    tailored_cv_id: "cv-1",
    job_id: null,
    status,
    job: { job_title: "Analyst", company_name: "", job_description: "" },
    analysis: { role_summary: "", requirements: [], questions: [] },
    requirement_decisions: {},
    answers: {},
    questions_completed: true,
    error_message: null,
    created_at: "2026-10-27T09:00:00.000Z",
    finished_at: null
  },
  tasks: [task("t1")],
  suggestions: [suggestion("s1")],
  score: { initial: 50, current: 60, potential: 70 },
  preferences: { auto_apply: false },
  viewer: { is_admin: false },
  ...patch
});

describe("tailoring view merges", () => {
  it("adds a task created by a block refine, with its card", () => {
    const refined = task("t2", { block_id: "block-new", updated_at: "2026-10-27T10:05:00.000Z" });
    const card = suggestion("s2", { task_id: "t2", block_id: "block-new" });
    const next = applyTailoringTaskResult(view(), {
      task: refined,
      suggestions: [card],
      session_status: "ready",
      score: { initial: 50, current: 60, potential: 75 }
    });
    expect(next.tasks.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(next.suggestions.map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(next.score.potential).toBe(75);
  });

  it("replaces the pending cards of a re-run task and keeps decided ones", () => {
    const start = view({ suggestions: [suggestion("s1"), suggestion("s0", { status: "applied" })] });
    const next = applyTailoringTaskResult(start, {
      task: task("t1", { updated_at: "2026-10-27T10:06:00.000Z" }),
      suggestions: [suggestion("s3")],
      session_status: "reviewing",
      score: start.score
    });
    expect(next.suggestions.map((item) => item.id)).toEqual(["s0", "s3"]);
    expect(next.session.status).toBe("reviewing");
    expect(next.tasks).toHaveLength(1);
  });

  it("keeps a refine-created task and its card when an older snapshot arrives", () => {
    const withRefine = applyTailoringTaskResult(view(), {
      task: task("t2", { block_id: "block-new" }),
      suggestions: [suggestion("s2", { task_id: "t2", block_id: "block-new" })],
      session_status: "ready",
      score: view().score
    });
    const merged = mergeTailoringViews(withRefine, view());
    expect(merged.tasks.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(merged.suggestions.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  it("takes newer re-queued tasks from the server and drops stale tasks after a new analysis", () => {
    const requeued = view({ tasks: [task("t1", { status: "ready", rerun_for_answer: true, updated_at: "2026-10-27T10:10:00.000Z" })] });
    expect(mergeTailoringViews(view(), requeued).tasks[0]).toMatchObject({ status: "ready", rerun_for_answer: true });

    const reanalyzing = view({ tasks: [], suggestions: [] }, "analyzing");
    expect(mergeTailoringViews(view(), reanalyzing).tasks).toEqual([]);
  });
});

describe("refine area cards", () => {
  it("shows a block's pending cards and the ones refine made here, pending first and newest first", () => {
    const suggestions = [
      suggestion("old-applied", { status: "applied", created_at: "2026-10-27T10:00:00.000Z" }),
      suggestion("refined-applied", { status: "applied", created_at: "2026-10-27T10:02:00.000Z" }),
      suggestion("pending-a", { created_at: "2026-10-27T10:01:00.000Z" }),
      suggestion("pending-b", { created_at: "2026-10-27T10:03:00.000Z" }),
      suggestion("expired", { status: "expired" }),
      suggestion("other-block", { block_id: "other" })
    ];
    const run = { status: "done" as const, payload: { refinement: "shorter" as const }, message: null, suggestionIds: ["refined-applied", "expired"] };
    expect(refineSuggestionsForBlock(suggestions, "block-t1", run).map((item) => item.id)).toEqual([
      "pending-b",
      "pending-a",
      "refined-applied"
    ]);
  });
});

describe("refine errors", () => {
  it("treats a 409 (block already updating) as busy, not as an error", () => {
    expect(isRefineBusyError(new ApiClientError({ status: 409, code: "CONFLICT", message: "Busy" }))).toBe(true);
    expect(isRefineBusyError(new ApiClientError({ status: 404, code: "NOT_FOUND", message: "Gone" }))).toBe(false);
    expect(isRefineBusyError(new TypeError("offline"))).toBe(false);
  });
});
