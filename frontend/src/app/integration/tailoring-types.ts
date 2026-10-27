// Mirrors backend/src/modules/tailoring/tailoring.types.ts (tailoring v2 session API).

export type TailoringSessionStatus =
  | "draft"
  | "analyzing"
  | "answering"
  | "generating"
  | "reviewing"
  | "ready"
  | "archived";

export type RequirementStatus = "covered" | "weak" | "missing";
export type RequirementDecision = "relevant" | "not_relevant";
export type TailoringAnswerChoice = "yes" | "some" | "no";

export interface TailoringRequirement {
  id: string;
  text: string;
  keywords: string[];
  importance: "must" | "nice";
  weight: number;
  status: RequirementStatus;
  confidence: "high" | "medium" | "low";
  evidence_block_ids: string[];
  reason: string;
}

// "gap": yes / some / no for a requirement (at most 3). "metric": one specific number for a
// CV item (at most 2; approximate answers are fine, skipping is easy). "metric_open": the
// one open "any number to add?" question, answered with `entries` (no task waits on it).
export type TailoringQuestionKind = "gap" | "metric" | "metric_open";

export interface TailoringQuestion {
  id: string;
  kind: TailoringQuestionKind;
  text: string;
  requirement_id: string | null;
  target_block_id: string | null;
}

export interface TailoringAnalysis {
  role_summary: string;
  requirements: TailoringRequirement[];
  questions: TailoringQuestion[];
}

// The open number question's id (kind "metric_open").
export const TAILORING_OPEN_METRIC_QUESTION_ID = "q_open_metric";
// Limits of an answer's `entries` (enforced by the server with a 400).
export const TAILORING_ANSWER_ENTRIES_MAX = 5;
export const TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH = 300;

// One figure for one CV item, e.g. { target_block_id: "<experience block>", detail: "~40 shipments a week" }.
// The target must be an editable item block (experience, project, volunteering, …) of the CV.
export interface TailoringAnswerEntry {
  target_block_id: string;
  detail: string;
}

export interface TailoringAnswer {
  answer: TailoringAnswerChoice | null;
  detail: string | null;
  add_to_main: boolean;
  // Only on the open number question; an empty list means skipped.
  entries?: TailoringAnswerEntry[];
  answered_at: string;
}

// PUT /ai/tailoring-sessions/:sessionId/answers/:questionId. The open number question sends
// { answer: null, detail: null, entries, add_to_main? }.
export interface TailoringAnswerPayload {
  answer: TailoringAnswerChoice | null;
  detail?: string | null;
  add_to_main?: boolean;
  entries?: TailoringAnswerEntry[];
}

export interface TailoringJob {
  job_title: string;
  company_name: string;
  job_description: string;
}

export type TailoringTaskKind = "block" | "summary" | "skills" | "structure";
export type TailoringTaskStatus = "waiting" | "ready" | "running" | "done" | "failed" | "skipped";

export interface TailoringTask {
  id: string;
  kind: TailoringTaskKind;
  block_id: string | null;
  section_id: string | null;
  status: TailoringTaskStatus;
  depends_on_question_ids: string[];
  error_message: string | null;
  // The server re-queued this finished task because an answer it depends on changed.
  // Older backends omit it (treated as false).
  rerun_for_answer?: boolean;
  updated_at: string;
}

export type TailoringSuggestionKind = "rewrite" | "skills" | "new_section" | "reorder" | "hide_section";
export type TailoringSuggestionStatus = "pending" | "applied" | "rejected" | "expired";

export interface TailoringSuggestion {
  id: string;
  task_id: string | null;
  kind: TailoringSuggestionKind;
  block_id: string | null;
  section_id: string | null;
  before: Record<string, unknown> | null;
  suggested: Record<string, unknown>;
  rationale: string;
  requirement_ids: string[];
  add_to_main: boolean;
  guard_notes: string[];
  status: TailoringSuggestionStatus;
  created_at: string;
}

export interface TailoringScore {
  initial: number | null;
  current: number | null;
  potential: number | null;
}

export interface TailoringPreferences {
  auto_apply: boolean;
}

export interface TailoringSessionView {
  session: {
    id: string;
    tailored_cv_id: string;
    job_id: string | null;
    status: TailoringSessionStatus;
    job: TailoringJob;
    analysis: TailoringAnalysis | null;
    requirement_decisions: Record<string, RequirementDecision>;
    answers: Record<string, TailoringAnswer>;
    questions_completed: boolean;
    error_message: string | null;
    created_at: string;
    finished_at: string | null;
  };
  tasks: TailoringTask[];
  suggestions: TailoringSuggestion[];
  score: TailoringScore;
  preferences: TailoringPreferences;
  viewer: { is_admin: boolean };
}

export interface TailoringTaskRunResponse {
  task: TailoringTask;
  suggestions: TailoringSuggestion[];
  session_status: TailoringSessionStatus;
  score: TailoringScore;
}

// "Also add to my main CV": accepting writes the main CV block (with a block history
// revision); undo reverts it only if the main CV block is unchanged since, otherwise the
// revert is skipped. Older backends omit the revert flags (BackendApi defaults them to false).
export interface TailoringSuggestionDecisionResponse {
  suggestion: TailoringSuggestion;
  score: TailoringScore;
  master_cv_updated: boolean;
  master_cv_reverted: boolean;
  master_cv_revert_skipped: boolean;
}

// Raw response shape, before BackendApi fills in the optional flags.
export type TailoringSuggestionDecisionPayload = Omit<
  TailoringSuggestionDecisionResponse,
  "master_cv_updated" | "master_cv_reverted" | "master_cv_revert_skipped"
> &
  Partial<Pick<TailoringSuggestionDecisionResponse, "master_cv_updated" | "master_cv_reverted" | "master_cv_revert_skipped">>;

export type TailoringRefinement = "shorter" | "more_impact" | "more_keywords" | "more_professional" | "improve";

// Free-text instructions for a task run or a block refine are capped at this length.
export const TAILORING_INSTRUCTION_MAX_LENGTH = 500;

export interface TailoringRunPayload {
  regenerate?: boolean;
  refinement?: TailoringRefinement | null;
  instruction?: string | null;
}

// "Refine with AI" on one block (at least one of the two).
export interface TailoringRefinePayload {
  refinement?: TailoringRefinement | null;
  instruction?: string | null;
}

export interface TailoringCostRun {
  ai_run_id: string;
  flow_type: string;
  step: string;
  status: string;
  model_name: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string;
}

export interface TailoringCostReport {
  session_id: string;
  user_email: string | null;
  job_title: string;
  status: TailoringSessionStatus;
  created_at: string;
  totals: {
    run_count: number;
    failed_run_count: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
    cost_usd: number | null;
    cost_complete: boolean;
  };
  by_step: Array<{ step: string; run_count: number; total_tokens: number; cost_usd: number | null }>;
  runs: TailoringCostRun[];
}

export interface TailoringAdminSessionSummary {
  session_id: string;
  user_email: string | null;
  job_title: string;
  company_name: string;
  status: TailoringSessionStatus;
  created_at: string;
  run_count: number;
  total_tokens: number;
  cost_usd: number | null;
  cost_complete: boolean;
}
