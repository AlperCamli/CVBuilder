import type { CvContent } from "../../shared/cv-content/cv-content.types";

export type TailoringSessionStatus =
  | "draft"
  | "analyzing"
  | "answering"
  | "generating"
  | "reviewing"
  | "ready"
  | "archived";

export type RequirementStatus = "covered" | "weak" | "missing";

// Requirement and question ids are the model's short ids (e.g. "r1", "q2"); block ids are
// real CV block ids (aliases are translated back right after the analysis call).
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

export interface TailoringQuestion {
  id: string;
  kind: "gap" | "metric";
  text: string;
  requirement_id: string | null;
  target_block_id: string | null;
}

export interface TailoringBlockBrief {
  block_id: string;
  requirement_ids: string[];
  focus: string;
  terms: string[];
  avoid: string;
}

export interface TailoringAnalysis {
  role_summary: string;
  requirements: TailoringRequirement[];
  questions: TailoringQuestion[];
  block_briefs: TailoringBlockBrief[];
}

export type TailoringAnswerChoice = "yes" | "some" | "no";

export interface TailoringAnswer {
  answer: TailoringAnswerChoice | null;
  detail: string | null;
  add_to_main: boolean;
  answered_at: string;
}

export type RequirementDecision = "relevant" | "not_relevant";

export interface TailoringJobSnapshot {
  job_title: string;
  company_name: string;
  job_description: string;
}

export interface TailoringSessionRecord {
  id: string;
  user_id: string;
  // null once the tailored CV is deleted: the session is then archived and scrubbed, and
  // kept only for cost reporting (see the tailoring v2 migration).
  tailored_cv_id: string | null;
  job_id: string | null;
  status: TailoringSessionStatus;
  job_snapshot: TailoringJobSnapshot;
  analysis: TailoringAnalysis | null;
  analysis_run_id: string | null;
  requirement_decisions: Record<string, RequirementDecision>;
  answers: Record<string, TailoringAnswer>;
  questions_completed: boolean;
  base_snapshot: CvContent;
  error_message: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TailoringTaskKind = "block" | "summary" | "skills" | "structure";

// Quick fixes / "Refine with AI" presets for a block, skills or summary run.
export const TAILORING_REFINEMENTS = ["shorter", "more_impact", "more_keywords", "more_professional", "improve"] as const;
export type TailoringRefinement = (typeof TAILORING_REFINEMENTS)[number];
// Free-text "Refine with AI" request from the candidate (trimmed, at most this long).
export const TAILORING_INSTRUCTION_MAX_CHARS = 500;
export type TailoringTaskStatus = "waiting" | "ready" | "running" | "done" | "failed" | "skipped";

export interface TailoringTaskRecord {
  id: string;
  session_id: string;
  user_id: string;
  kind: TailoringTaskKind;
  block_id: string | null;
  section_id: string | null;
  status: TailoringTaskStatus;
  depends_on_question_ids: string[];
  brief: TailoringBlockBrief | Record<string, never>;
  ai_run_id: string | null;
  attempts: number;
  // Re-queued because a question it uses was answered (or re-answered) after it ran; the
  // next run regenerates it with the answer. Cleared when that run starts.
  rerun_for_answer: boolean;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TailoringSuggestionKind =
  | "rewrite"
  | "skills"
  | "new_section"
  | "reorder"
  | "hide_section";

export type TailoringSuggestionStatus = "pending" | "applied" | "rejected" | "expired";

// before/suggested payloads per kind:
// - rewrite / skills: { field, value }               (block field replacement)
// - new_section:      suggested { section }          (insert a whole section)
// - reorder:          { section_order: string[] }    (body section ids)
// - hide_section:     { section_id }
export interface TailoringSuggestionRecord {
  id: string;
  ai_run_id: string;
  user_id: string;
  tailored_cv_id: string;
  tailoring_session_id: string;
  tailoring_task_id: string | null;
  kind: TailoringSuggestionKind;
  block_id: string | null;
  before_content: Record<string, unknown> | null;
  suggested_content: Record<string, unknown>;
  rationale: string;
  requirement_ids: string[];
  meta: Record<string, unknown>;
  status: TailoringSuggestionStatus;
  applied_at: string | null;
  created_at: string;
}

export interface CreateTailoringSuggestionPayload {
  ai_run_id: string;
  user_id: string;
  tailored_cv_id: string;
  tailoring_session_id: string;
  tailoring_task_id: string;
  kind: TailoringSuggestionKind;
  block_id: string | null;
  before_content: Record<string, unknown> | null;
  suggested_content: Record<string, unknown>;
  rationale: string;
  requirement_ids: string[];
  meta: Record<string, unknown>;
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
    job: TailoringJobSnapshot;
    analysis: TailoringAnalysis | null;
    requirement_decisions: Record<string, RequirementDecision>;
    answers: Record<string, TailoringAnswer>;
    questions_completed: boolean;
    error_message: string | null;
    created_at: string;
    finished_at: string | null;
  };
  tasks: TailoringTaskView[];
  suggestions: TailoringSuggestionView[];
  score: TailoringScore;
  preferences: TailoringPreferences;
  viewer: { is_admin: boolean };
}

export interface TailoringTaskView {
  id: string;
  kind: TailoringTaskKind;
  block_id: string | null;
  section_id: string | null;
  status: TailoringTaskStatus;
  depends_on_question_ids: string[];
  // True while the task is re-queued to use a new answer and has not run yet.
  rerun_for_answer: boolean;
  error_message: string | null;
  updated_at: string;
}

export interface TailoringSuggestionView {
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

export interface TailoringTaskRunResponse {
  task: TailoringTaskView;
  suggestions: TailoringSuggestionView[];
  session_status: TailoringSessionStatus;
  score: TailoringScore;
}

export interface TailoringSuggestionDecisionResponse {
  suggestion: TailoringSuggestionView;
  score: TailoringScore;
  // accept: the rewrite was also written to the main CV ("Also add to my main CV").
  master_cv_updated: boolean;
  // undo: the main CV block was restored to its value before that write.
  master_cv_reverted: boolean;
  // undo: the main CV block was edited since the write, so it was left unchanged.
  master_cv_revert_skipped: boolean;
}

export interface CreateTailoringSessionInput {
  cv_id: string;
  job: {
    job_title: string;
    company_name?: string | null;
    job_description: string;
  };
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
