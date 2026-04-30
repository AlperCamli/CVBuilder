import type { CvContent } from "../cv-content/cv-content.types";

export type LocaleCode = "en" | "tr";

export interface UserRecord {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string | null;
  locale: LocaleCode;
  default_cv_language: string | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  plan_code: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsageCounterRecord {
  id: string;
  user_id: string;
  period_month: string;
  tailored_cv_generations_count: number;
  exports_count: number;
  ai_actions_count: number;
  storage_bytes_used: number;
  updated_at: string;
}

export interface CvTemplateRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  preview_config: Record<string, unknown> | null;
  export_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type MasterCvSourceType = "scratch" | "import";

export interface MasterCvRecord {
  id: string;
  user_id: string;
  title: string;
  language: string;
  template_id: string | null;
  current_content: CvContent;
  summary_text: string | null;
  source_type: MasterCvSourceType;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export type TailoredCvStatus = "draft" | "ready" | "exported" | "archived";

export interface TailoredCvRecord {
  id: string;
  user_id: string;
  master_cv_id: string;
  job_id: string | null;
  title: string;
  language: string;
  template_id: string | null;
  current_content: CvContent;
  status: TailoredCvStatus;
  ai_generation_status: string | null;
  last_exported_at: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export type AiFlowType =
  | "job_analysis"
  | "follow_up_questions"
  | "tailored_draft"
  | "block_suggest"
  | "block_compare"
  | "multi_option"
  | "import_improve"
  | "summary"
  | "improve"
  | "cv_parse"
  | "cover_letter_generation";

export type AiRunStatus = "pending" | "completed" | "failed";

export type AiRunProgressStage =
  | "queued"
  | "building_prompt"
  | "calling_model"
  | "parsing_output"
  | "validating_output"
  | "persisting_result"
  | "completed"
  | "failed";

export interface AiRunRecord {
  id: string;
  user_id: string;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  job_id: string | null;
  flow_type: AiFlowType;
  provider: string;
  model_name: string;
  status: AiRunStatus;
  progress_stage: AiRunProgressStage;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  error_message: string | null;
  debug_payload: Record<string, unknown> | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  started_at: string;
  completed_at: string | null;
}

export type AiSuggestionActionType =
  | "rewrite"
  | "summarize"
  | "improve"
  | "ats_optimize"
  | "options"
  | "expand"
  | "shorten";

export type AiSuggestionStatus = "pending" | "applied" | "rejected" | "expired";

export interface AiSuggestionRecord {
  id: string;
  ai_run_id: string;
  user_id: string;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  block_id: string | null;
  action_type: AiSuggestionActionType;
  before_content: Record<string, unknown> | null;
  suggested_content: Record<string, unknown>;
  option_group_key: string | null;
  status: AiSuggestionStatus;
  applied_at: string | null;
  created_at: string;
}

export type CvKind = "master" | "tailored";

export type CvRevisionChangeSource = "manual" | "ai" | "import" | "restore" | "system";

export interface CvBlockRevisionRecord {
  id: string;
  user_id: string;
  cv_kind: CvKind;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  block_id: string;
  block_type: string;
  revision_number: number;
  content_snapshot: Record<string, unknown>;
  change_source: CvRevisionChangeSource;
  ai_suggestion_id: string | null;
  created_at: string;
  created_by_user_id: string | null;
}

export type JobStatus = "saved" | "applied" | "interview" | "offer" | "rejected" | "archived";

export interface JobRecord {
  id: string;
  user_id: string;
  tailored_cv_id: string | null;
  cover_letter_id: string | null;
  company_name: string;
  job_title: string;
  job_description: string;
  job_posting_url: string | null;
  location_text: string | null;
  status: JobStatus;
  notes: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobStatusHistoryRecord {
  id: string;
  job_id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  changed_at: string;
  changed_by_user_id: string;
}

export type FileType =
  | "source_upload"
  | "parsed_artifact"
  | "export_pdf"
  | "export_docx"
  | "avatar"
  | "other";

export interface FileRecord {
  id: string;
  user_id: string;
  file_type: FileType;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
  is_deleted: boolean;
  created_at: string;
}

export type ExportFormat = "pdf" | "docx";

export type ExportStatus = "processing" | "completed" | "failed";

export interface ExportRecord {
  id: string;
  user_id: string;
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  file_id: string | null;
  format: ExportFormat;
  status: ExportStatus;
  template_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type CoverLetterStatus = "draft" | "ready" | "archived";

export interface CoverLetterRecord {
  id: string;
  user_id: string;
  job_id: string;
  tailored_cv_id: string | null;
  title: string;
  content: string;
  status: CoverLetterStatus;
  last_exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoverLetterExportRecord {
  id: string;
  user_id: string;
  cover_letter_id: string;
  file_id: string | null;
  format: ExportFormat;
  status: ExportStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ImportStatus = "uploaded" | "parsing" | "parsed" | "reviewed" | "converted" | "failed";

export interface ImportRecord {
  id: string;
  user_id: string;
  source_file_id: string;
  target_master_cv_id: string | null;
  status: ImportStatus;
  parser_name: string | null;
  raw_extracted_text: string | null;
  parsed_content: CvContent | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CurrentPlanSummary {
  plan_code: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface UsageLimits {
  tailored_cv_generations: number | null;
  exports: number | null;
  ai_actions: number | null;
  storage_bytes: number | null;
}

export interface UsageRemaining {
  tailored_cv_generations: number | null;
  exports: number | null;
  ai_actions: number | null;
  storage_bytes: number | null;
}

export interface UsageSummary {
  period_month: string;
  tailored_cv_generations_count: number;
  exports_count: number;
  ai_actions_count: number;
  storage_bytes_used: number;
  plan_code: string;
  limits: UsageLimits;
  remaining: UsageRemaining;
}

export interface EntitlementSummary {
  plan_code: string;
  can_generate_tailored_cv: boolean;
  can_export_pdf: boolean;
  can_export_docx: boolean;
  can_use_ai_actions: boolean;
  limits: UsageLimits;
  remaining: UsageRemaining;
}
