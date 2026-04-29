import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { CvBlock, CvContent, CvPreview } from "../../shared/cv-content/cv-content.types";
import type {
  CvKind,
  AiFlowType,
  AiRunProgressStage,
  AiRunStatus,
  AiSuggestionActionType,
  AiSuggestionStatus,
  TailoredCvStatus
} from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface AiJobPayload {
  company_name: string;
  job_title: string;
  job_description: string;
}

export interface AiTailoredDraftJobPayload extends AiJobPayload {
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
}

export interface FollowUpQuestionChoice {
  id: string;
  label: string;
}

export type FollowUpQuestionType = "single_choice" | "multi_select" | "text";

export interface FollowUpQuestion {
  id: string;
  question: string;
  question_type: FollowUpQuestionType;
  choices?: FollowUpQuestionChoice[];
  target_hint?: string | null;
}

export interface FollowUpAnswer {
  question_id: string;
  answer_text?: string | null;
  selected_options?: string[];
}

export interface JobAnalysisInput {
  master_cv_id: string;
  job: AiJobPayload;
}

export interface FollowUpQuestionsInput extends JobAnalysisInput {
  prior_analysis?: Record<string, unknown>;
}

export interface TailoredDraftInput {
  master_cv_id: string;
  tailored_cv_id?: string;
  language?: string;
  template_id?: string | null;
  job: AiTailoredDraftJobPayload;
  answers: FollowUpAnswer[];
}

export type TailoredCvDraftInput = TailoredDraftInput;

export interface AiBlockTargetInput {
  tailored_cv_id?: string;
  master_cv_id?: string;
}

export interface BlockSuggestInput extends AiBlockTargetInput {
  block_id: string;
  action_type: AiSuggestionActionType;
  user_instruction?: string | null;
}

export interface BlockCompareInput {
  tailored_cv_id: string;
  block_id: string;
}

export interface BlockOptionsInput extends AiBlockTargetInput {
  block_id: string;
  user_instruction?: string | null;
  option_count?: number;
}

export interface ImportImproveInput {
  parsed_content: Record<string, unknown>;
  language?: string;
  improvement_guidance?: string[];
}

export interface CoverLetterGenerationInput {
  job_title: string;
  company_name: string;
  job_description?: string;
  master_cv_id?: string;
  tailored_cv_id?: string;
  tone?: string;
  additional_instructions?: string;
}

export interface JobAnalysisResult {
  keywords: string[];
  requirements: string[];
  strengths: string[];
  gaps: string[];
  summary: string;
  fit_score: number | null;
}

export interface FollowUpQuestionsResult {
  questions: FollowUpQuestion[];
}

export interface TailoredDraftResult {
  current_content: Record<string, unknown>;
  generation_summary: string;
  changed_block_ids: string[];
}

export interface CoverLetterGenerationResult {
  title: string;
  content: string;
}

export interface BlockSuggestionVariant {
  label: string;
  rationale: string;
  suggested_block: Record<string, unknown>;
}

export interface BlockSuggestResult {
  suggestions: BlockSuggestionVariant[];
}

export interface BlockCompareResult {
  comparison_summary: string;
  gap_highlights: string[];
  improvement_guidance: string[];
  matched_keywords: string[];
  missing_keywords: string[];
}

export interface AiRunSummary {
  id: string;
  flow_type: AiFlowType;
  provider: string;
  model_name: string;
  status: AiRunStatus;
  progress_stage: AiRunProgressStage;
  error_message: string | null;
  debug_payload: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
}

export type TailoringRunFlowType = "job_analysis" | "follow_up_questions" | "tailored_draft";

export interface TailoringRunStartInput {
  flow_type: TailoringRunFlowType;
  input: Record<string, unknown>;
}

export interface TailoringRunStartResponse {
  ai_run_id: string;
  flow_type: TailoringRunFlowType;
  status: AiRunStatus;
  progress_stage: AiRunProgressStage;
}

export interface TailoringRunStatusResponse extends TailoringRunStartResponse {
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TailoringRunExecuteResponse {
  ai_run_id: string;
  flow_type: TailoringRunFlowType;
  status: AiRunStatus;
  progress_stage: AiRunProgressStage;
}

export interface TailoringRunResultResponse {
  ai_run_id: string;
  flow_type: TailoringRunFlowType;
  status: "completed";
  result: Record<string, unknown>;
}

export interface AiSuggestionSummary {
  id: string;
  ai_run_id: string;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  block_id: string | null;
  action_type: AiSuggestionActionType;
  option_group_key: string | null;
  status: AiSuggestionStatus;
  applied_at: string | null;
  created_at: string;
}

export interface AiSuggestionDetail extends AiSuggestionSummary {
  before_content: Record<string, unknown> | null;
  suggested_content: Record<string, unknown>;
}

export interface TailoredCvDraftJobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: string;
}

export interface TailoredCvDraftSummary {
  id: string;
  title: string;
  language: string;
  status: TailoredCvStatus;
  master_cv_id: string;
  job_id: string | null;
  template_id: string | null;
  ai_generation_status: string | null;
  created_at: string;
  updated_at: string;
  current_content: CvContent;
  preview: CvPreview;
}

export interface SuggestionApplyResponse {
  suggestion: AiSuggestionSummary;
  cv_kind: CvKind;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  updated_block: CvBlock;
  section_id: string;
}

export interface SuggestionRejectResponse {
  suggestion_id: string;
  status: AiSuggestionStatus;
}

export interface CvAiHistoryResponse {
  cv_kind: CvKind;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  ai_runs: AiRunSummary[];
  suggestions: AiSuggestionSummary[];
}

export interface AiBlockVersionEntry {
  source: "original" | "manual_pre_ai" | "ai_applied";
  label: string;
  index: number;
  created_at: string | null;
  ai_suggestion_id: string | null;
  ai_run_id: string | null;
  content_snapshot: Record<string, unknown>;
}

export interface AiBlockVersionChain {
  block_id: string;
  current_version_index: number;
  versions: AiBlockVersionEntry[];
}

export interface CvAiBlockVersionsResponse {
  cv_kind: CvKind;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  blocks: AiBlockVersionChain[];
}

export interface ImportImproveResponse {
  ai_run_id: string;
  improved_content: CvContent;
  generation_summary: string;
  changed_block_ids: string[];
  generation_metadata: {
    provider: string;
    model_name: string;
    flow_type: "import_improve";
    prompt_key: string;
    prompt_version: string;
  };
}
