export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta?: Record<string, unknown>;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

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

export interface MeResponseData {
  user: UserRecord;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  entitlements: EntitlementSummary;
}

export interface SettingsResponseData {
  locale: LocaleCode;
  default_cv_language: string | null;
  onboarding_completed: boolean;
}

export interface DashboardUserSummary {
  id: string;
  email: string;
  full_name: string | null;
}

export type JobStatus = "saved" | "applied" | "interview" | "offer" | "rejected" | "archived";

export interface DashboardMasterCvItem {
  id: string;
  title: string;
  language: string;
  template_id: string | null;
  source_type: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardTailoredCvItem {
  id: string;
  title: string;
  language: string;
  status: string;
  master_cv_id: string;
  job_id: string | null;
  job_company_name: string | null;
  job_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardJobItem {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
  tailored_cv_id: string | null;
  tailored_cv_title: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

export interface DashboardJobStatusCounts {
  saved: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  archived: number;
}

export interface DashboardActivityItem {
  id: string;
  type:
    | "tailored_cv_created"
    | "tailored_cv_updated"
    | "ai_suggestion_applied"
    | "revision_restored"
    | "job_status_changed";
  message: string;
  timestamp: string;
  related_entity: {
    kind: "master_cv" | "tailored_cv" | "job" | "ai_suggestion" | "revision";
    id: string;
    title: string | null;
  };
}

export interface DashboardResponseData {
  user_summary: DashboardUserSummary;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  entitlements: EntitlementSummary;
  master_cv_summary: {
    total_count: number;
    primary_master_cv: DashboardMasterCvItem | null;
  };
  tailored_cv_summary: {
    total_count: number;
    recent_items: DashboardTailoredCvItem[];
  };
  jobs_summary: {
    total_count: number;
    counts_by_status: DashboardJobStatusCounts;
    recent_items: DashboardJobItem[];
  };
  recent_activity: DashboardActivityItem[];
  locale: LocaleCode;
  onboarding_completed: boolean;
}

export interface DashboardActivityResponseData {
  activity: DashboardActivityItem[];
}

export type CvVisibility = "visible" | "hidden";
export type CvJsonPrimitive = string | number | boolean | null;
export type CvJsonValue = CvJsonPrimitive | CvJsonValue[] | { [key: string]: CvJsonValue };

export interface CvBlock {
  id: string;
  type: string;
  order: number;
  visibility: CvVisibility;
  fields: Record<string, CvJsonValue>;
  meta: Record<string, CvJsonValue>;
}

export interface CvSection {
  id: string;
  type: string;
  title: string | null;
  order: number;
  blocks: CvBlock[];
  meta: Record<string, CvJsonValue>;
}

export interface CvContent {
  version: "v1";
  language: string;
  metadata: Record<string, CvJsonValue>;
  sections: CvSection[];
}

export interface CvPreview {
  version: "v1";
  language: string;
  generated_at: string;
  plain_text: string;
  sections: CvSection[];
}

export type MasterCvSourceType = "scratch" | "import";

export interface MasterCvSummary {
  id: string;
  title: string;
  language: string;
  source_type: MasterCvSourceType;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MasterCvDetail extends MasterCvSummary {
  summary_text: string | null;
  current_content: CvContent;
  preview: CvPreview;
}

export interface MasterCvBlockUpdateResponse {
  master_cv: MasterCvDetail;
  updated_block: CvBlock;
  section_id: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  preview_config: Record<string, unknown> | null;
  export_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedTemplateSummary {
  resolution: "selected" | "default_active" | "none";
  template: TemplateSummary | null;
}

export interface RenderingFieldValue {
  raw: CvJsonValue;
  text: string;
  text_items: string[];
}

export interface RenderingBlockDerived {
  headline: string | null;
  subheadline: string | null;
  bullets: string[];
  date_range: string | null;
  location: string | null;
}

export interface RenderingBlock {
  id: string;
  type: string;
  order: number;
  visibility: CvVisibility;
  fields: Record<string, CvJsonValue>;
  meta: Record<string, CvJsonValue>;
  normalized_fields: Record<string, RenderingFieldValue>;
  derived: RenderingBlockDerived;
  plain_text: string;
}

export interface RenderingSection {
  id: string;
  type: string;
  title: string | null;
  order: number;
  meta: Record<string, CvJsonValue>;
  blocks: RenderingBlock[];
  plain_text: string;
}

export interface RenderingPayload {
  version: "v1";
  document: {
    kind: "master" | "tailored";
    id: string | null;
    title: string | null;
    language: string;
    generated_at: string;
    updated_at: string | null;
    context: Record<string, unknown>;
  };
  template: ResolvedTemplateSummary;
  sections: RenderingSection[];
  plain_text: string;
}

export interface MasterCvPreviewResponse {
  cv: {
    id: string;
    title: string;
    language: string;
    source_type: MasterCvSourceType;
    template_id: string | null;
    updated_at: string;
  };
  current_content: CvContent;
  preview: CvPreview;
  selected_template: ResolvedTemplateSummary;
  rendering: RenderingPayload;
}

export type TailoredCvStatus = "draft" | "ready" | "exported" | "archived";

export interface TailoredCvJobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
}

export interface TailoredCvSummary {
  id: string;
  title: string;
  language: string;
  status: TailoredCvStatus;
  master_cv_id: string;
  job_id: string | null;
  created_at: string;
  updated_at: string;
  job: TailoredCvJobSummary | null;
}

export interface TailoredCvSourceMasterSummary {
  id: string;
  title: string;
  language: string;
  template_id: string | null;
  updated_at: string;
}

export interface TailoredCvDetail extends TailoredCvSummary {
  template_id: string | null;
  ai_generation_status: string | null;
  last_exported_at: string | null;
  current_content: CvContent;
  preview: CvPreview;
  source_master_cv: TailoredCvSourceMasterSummary | null;
}

export interface TailoredCvPreviewResponse {
  cv: {
    id: string;
    title: string;
    language: string;
    status: TailoredCvStatus;
    master_cv_id: string;
    job_id: string | null;
    template_id: string | null;
    updated_at: string;
  };
  linked_job: TailoredCvJobSummary | null;
  current_content: CvContent;
  preview: CvPreview;
  selected_template: ResolvedTemplateSummary;
  rendering: RenderingPayload;
}

export interface TailoredCvSourceResponse {
  tailored_cv_id: string;
  master_cv_id: string;
  master_cv: TailoredCvSourceMasterSummary | null;
  job: TailoredCvJobSummary | null;
  created_at: string;
  updated_at: string;
}

export type ImportStatus = "uploaded" | "parsing" | "parsed" | "reviewed" | "converted" | "failed";

export interface FileRecord {
  id: string;
  user_id: string;
  file_type: "source_upload" | "parsed_artifact" | "export_pdf" | "export_docx" | "avatar" | "other";
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
  is_deleted: boolean;
  created_at: string;
}

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

export interface ImportDetail {
  import: ImportRecord;
  source_file: FileRecord;
  target_master_cv: Pick<MasterCvSummary, "id" | "title" | "language" | "template_id" | "created_at"> | null;
}

export interface ParseSummary {
  parser_name: string;
  status: "parsed" | "failed";
  raw_text_length: number;
  section_count: number;
  block_count: number;
  warnings: string[];
}

export interface ParseImportResponse {
  import: ImportDetail;
  parse_summary: ParseSummary;
}

export interface ImportResultView {
  status: ImportStatus;
  parser_name: string | null;
  raw_extracted_text: string | null;
  parsed_content: CvContent | null;
  error_message: string | null;
}

export interface CreateMasterCvFromImportResponse {
  master_cv: MasterCvDetail;
  import: {
    id: string;
    status: ImportStatus;
    target_master_cv_id: string | null;
    updated_at: string;
  };
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

export interface AiSuggestionSummary {
  id: string;
  ai_run_id: string;
  tailored_cv_id: string;
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

export interface AiRunSummary {
  id: string;
  flow_type:
    | "job_analysis"
    | "follow_up_questions"
    | "tailored_draft"
    | "block_suggest"
    | "block_compare"
    | "multi_option"
    | "summary"
    | "improve";
  provider: string;
  model_name: string;
  status: "pending" | "completed" | "failed";
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TailoredCvAiHistoryResponse {
  tailored_cv_id: string;
  ai_runs: AiRunSummary[];
  suggestions: AiSuggestionSummary[];
}

export interface JobAnalysisResult {
  ai_run_id: string;
  keywords: string[];
  requirements: string[];
  strengths: string[];
  gaps: string[];
  summary: string;
  fit_score: number | null;
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

export interface FollowUpQuestionsResult {
  ai_run_id: string;
  questions: FollowUpQuestion[];
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

export interface TailoredCvDraftJobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: string;
}

export interface TailoredCvDraftResult {
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
}

export interface AiSuggestResponse {
  ai_run_id: string;
  suggestion_ids: string[];
  suggestions: Array<
    AiSuggestionSummary & {
      before_content: Record<string, unknown> | null;
      suggested_content: Record<string, unknown>;
      rationale: string;
    }
  >;
}

export interface AiBlockCompareResult {
  ai_run_id: string;
  comparison_summary: string;
  gap_highlights: string[];
  improvement_guidance: string[];
  matched_keywords: string[];
  missing_keywords: string[];
}

export interface AiBlockOptionsResult {
  ai_run_id: string;
  option_group_key: string;
  suggestions: Array<
    AiSuggestionSummary & {
      before_content: Record<string, unknown> | null;
      suggested_content: Record<string, unknown>;
      rationale: string;
    }
  >;
}

export interface SuggestionApplyResponse {
  suggestion: AiSuggestionSummary;
  tailored_cv_id: string;
  updated_block: CvBlock;
  section_id: string;
}

export interface SuggestionRejectResponse {
  suggestion_id: string;
  status: AiSuggestionStatus;
}

export type CvRevisionChangeSource = "manual" | "ai" | "import" | "restore" | "system";

export interface CvBlockRevisionSummary {
  id: string;
  cv_kind: "master" | "tailored";
  master_cv_id: string | null;
  tailored_cv_id: string | null;
  block_id: string;
  block_type: string;
  revision_number: number;
  change_source: CvRevisionChangeSource;
  ai_suggestion_id: string | null;
  created_at: string;
  created_by_user_id: string | null;
}

export interface CvBlockRevisionDetail extends CvBlockRevisionSummary {
  content_snapshot: Record<string, unknown>;
}

export interface TailoredCvRevisionListResponse {
  tailored_cv_id: string;
  revisions: CvBlockRevisionSummary[];
}

export interface BlockRevisionListResponse {
  tailored_cv_id: string;
  block_id: string;
  revisions: CvBlockRevisionSummary[];
}

export interface RestoreRevisionResponse {
  tailored_cv_id: string;
  restored_from_revision_id: string;
  restored_block: CvBlock;
  section_id: string;
  created_revision: CvBlockRevisionSummary;
}

export interface RevisionCompareResponse {
  from_revision: CvBlockRevisionSummary;
  to_revision: CvBlockRevisionSummary;
  comparison: {
    same_cv: boolean;
    same_block: boolean;
    changed_block_type: boolean;
    changed_visibility: boolean;
    changed_order: boolean;
    changed_fields: string[];
    changed_meta: string[];
    before_snapshot: Record<string, unknown>;
    after_snapshot: Record<string, unknown>;
  };
}

export interface JobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
  job_posting_url: string | null;
  location_text: string | null;
  tailored_cv_id: string | null;
  tailored_cv_title: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

export interface JobDetail {
  job: JobSummary;
  job_description: string;
  notes: string | null;
  linked_tailored_cv: {
    id: string;
    title: string;
    status: string;
    updated_at: string;
  } | null;
  status_last_changed_at: string;
}

export interface ListJobsResponse {
  items: JobSummary[];
  page: number;
  limit: number;
  total: number;
}

export interface JobBoardGroup {
  status: JobStatus;
  count: number;
  items: JobSummary[];
}

export interface JobStatusCounts {
  saved: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  archived: number;
}

export interface JobBoardResponse {
  groups: JobBoardGroup[];
  counts_by_status: JobStatusCounts;
  total: number;
}

export interface JobHistoryItem {
  id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  changed_at: string;
  changed_by_user_id: string;
}

export interface JobHistoryResponse {
  job_id: string;
  current_status: JobStatus;
  current_status_updated_at: string;
  history: JobHistoryItem[];
}

export interface UpdateJobStatusResponse {
  job: JobDetail;
  status_history_entry: JobHistoryItem | null;
}

export interface ListTemplatesResponse {
  templates: TemplateSummary[];
}

export interface TemplateDetail {
  template: TemplateSummary;
}

export interface RenderingPreviewResponse {
  current_content: CvContent;
  resolved_template: ResolvedTemplateSummary;
  rendering: RenderingPayload;
}

export type ExportFormat = "pdf" | "docx";
export type ExportStatus = "processing" | "completed" | "failed";

export interface ExportSummaryItem {
  id: string;
  format: ExportFormat;
  status: ExportStatus;
  template_id: string | null;
  file_id: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  download_available: boolean;
}

export interface ListTailoredCvExportsResponse {
  tailored_cv_id: string;
  exports: ExportSummaryItem[];
}

export interface DownloadAccess {
  download_url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export interface ExportDetailResponse {
  export: ExportSummaryItem;
  tailored_cv: {
    id: string;
    title: string;
    status: TailoredCvStatus;
    template_id: string | null;
    updated_at: string;
  } | null;
  file: {
    id: string;
    file_type: FileRecord["file_type"];
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  } | null;
  template: TemplateSummary | null;
  resolved_template: ResolvedTemplateSummary | null;
  download: DownloadAccess | null;
}

export interface ExportDownloadResponse extends DownloadAccess {
  export_id: string;
  format: ExportFormat;
}

export interface BillingProviderSummary {
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
}

export interface BillingPlanResponseData {
  plan_code: "free" | "pro";
  subscription_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider: BillingProviderSummary;
  entitlement_summary: EntitlementSummary;
}

export interface CreateCheckoutResponseData {
  checkout_url: string;
  checkout_session_id: string;
  plan_code: "free" | "pro";
  plan_name: string;
}

export interface CreatePortalResponseData {
  portal_url: string;
}
