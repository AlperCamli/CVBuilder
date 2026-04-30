import type { ApiClient } from "./api-client";
import type {
  AiBlockCompareResult,
  CvAiBlockVersionsResponse,
  CvAiHistoryResponse,
  AiBlockOptionsResult,
  AiSuggestResponse,
  AiSuggestionDetail,
  BlockRevisionListResponse,
  BillingPlanResponseData,
  CreateCheckoutResponseData,
  CoverLetterDetail,
  CoverLetterExportDetailResponse,
  CoverLetterExportDownloadResponse,
  CreateMasterCvFromImportResponse,
  CvBlockRevisionDetail,
  DashboardActivityResponseData,
  DashboardResponseData,
  ExportDetailResponse,
  ExportDownloadResponse,
  FollowUpQuestionsResult,
  ImportDetail,
  ImportResultView,
  JobAnalysisResult,
  JobBoardResponse,
  JobDetail,
  JobHistoryResponse,
  ListJobsResponse,
  ListCoverLetterExportsResponse,
  ListCoverLettersResponse,
  ListMasterCvExportsResponse,
  ListTailoredCvExportsResponse,
  ListTemplatesResponse,
  MasterCvBlockUpdateResponse,
  MasterCvDetail,
  MasterCvPreviewResponse,
  MasterCvSummary,
  MeResponseData,
  ParseImportResponse,
  RenderingPreviewResponse,
  ImportImproveResponse,
  RestoreRevisionResponse,
  RevisionCompareResponse,
  SettingsResponseData,
  SuggestionApplyResponse,
  SuggestionRejectResponse,
  TailoringRunExecuteResponse,
  TailoringRunResultResponse,
  TailoringRunStartResponse,
  TailoringRunStatusResponse,
  TailoredCvAiHistoryResponse,
  TailoredCvDetail,
  TailoredCvPreviewResponse,
  TailoredCvSourceResponse,
  TailoredCvSummary,
  TailoredCvRevisionListResponse,
  TailoredCvDraftResult,
  TemplateDetail,
  UsageSummary,
  UpdateJobStatusResponse,
  EntitlementSummary,
  CreatePortalResponseData,
  TailoringRunFlowType
} from "./api-types";

export interface UpdateMeInput {
  full_name?: string;
  default_cv_language?: string;
}

export interface UpdateSettingsInput {
  locale?: "en" | "tr";
  default_cv_language?: string;
  onboarding_completed?: boolean;
}

export interface CreateMasterCvInput {
  title: string;
  language: string;
  template_id?: string | null;
  current_content?: unknown;
}

export interface UpdateMasterCvInput {
  title?: string;
  language?: string;
  template_id?: string | null;
  summary_text?: string | null;
}

export interface UpdateCvBlockInput {
  type?: string;
  order?: number;
  visibility?: "visible" | "hidden";
  fields?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  replace_fields?: boolean;
}

export interface CreateImportSessionInput {
  original_filename: string;
  mime_type?: string;
  size_bytes: number;
  storage_bucket: string;
  storage_path: string;
  checksum?: string | null;
}

export interface CreateImportUploadUrlInput {
  original_filename: string;
}

export interface ImportUploadUrlTarget {
  storage_bucket: string;
  storage_path: string;
  token: string;
}

export interface CreateMasterCvFromImportInput {
  title?: string;
  language?: string;
  template_id?: string | null;
}

export interface CreateTailoredCvInput {
  master_cv_id: string;
  title?: string;
  language?: string;
  template_id?: string | null;
  job: {
    company_name: string;
    job_title: string;
    job_description: string;
    job_posting_url?: string | null;
    location_text?: string | null;
    notes?: string | null;
  };
}

export interface UpdateTailoredCvInput {
  title?: string;
  language?: string;
  template_id?: string | null;
  status?: "draft" | "ready" | "exported" | "archived";
}

export interface TailoredCvListFilters {
  status?: "draft" | "ready" | "exported" | "archived";
  company_name?: string;
  sort_order?: "asc" | "desc";
}

export interface JobFilters {
  status?: "saved" | "applied" | "interview" | "offer" | "rejected" | "archived";
  search?: string;
  sort_by?: "created_at" | "updated_at" | "company_name" | "job_title" | "status" | "applied_at";
  sort_order?: "asc" | "desc";
  linked_tailored_cv?: boolean;
  page?: number;
  limit?: number;
}

export interface UpdateJobInput {
  company_name?: string;
  job_title?: string;
  job_description?: string;
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
}

export interface JobAnalysisInput {
  master_cv_id: string;
  job: {
    company_name: string;
    job_title: string;
    job_description: string;
  };
}

export interface FollowUpQuestionsInput {
  master_cv_id: string;
  job: {
    company_name: string;
    job_title: string;
    job_description: string;
  };
  prior_analysis?: Record<string, unknown>;
}

export interface FollowUpAnswer {
  question_id: string;
  answer_text?: string | null;
  selected_options?: string[];
}

export interface TailoredDraftInput {
  master_cv_id: string;
  tailored_cv_id?: string;
  language?: string;
  template_id?: string | null;
  job: {
    company_name: string;
    job_title: string;
    job_description: string;
    job_posting_url?: string | null;
    location_text?: string | null;
    notes?: string | null;
  };
  answers: FollowUpAnswer[];
}

export interface TailoringRunStartInput {
  flow_type: TailoringRunFlowType;
  input: Record<string, unknown>;
}

export interface AiBlockTargetInput {
  tailored_cv_id?: string;
  master_cv_id?: string;
}

export interface BlockSuggestInput extends AiBlockTargetInput {
  block_id: string;
  action_type: "improve" | "summarize" | "rewrite" | "ats_optimize" | "shorten" | "expand" | "options";
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

export interface CreateExportInput {
  template_id?: string | null;
}

export interface UpdateCoverLetterContentInput {
  title?: string;
  content: string;
  status?: "draft" | "ready" | "archived";
}

export interface BillingCheckoutInput {
  plan_code: "free" | "pro";
  success_url?: string;
  cancel_url?: string;
}

export interface BillingPortalInput {
  return_url?: string;
}

export class BackendApi {
  constructor(private readonly client: ApiClient) {}

  getMe(): Promise<MeResponseData> {
    return this.client.get<MeResponseData>("/me");
  }

  patchMe(payload: UpdateMeInput): Promise<{ user: MeResponseData["user"] }> {
    return this.client.patch<{ user: MeResponseData["user"] }, UpdateMeInput>("/me", payload);
  }

  getSettings(): Promise<{ settings: SettingsResponseData }> {
    return this.client.get<{ settings: SettingsResponseData }>("/me/settings");
  }

  patchSettings(payload: UpdateSettingsInput): Promise<{ settings: SettingsResponseData }> {
    return this.client.patch<{ settings: SettingsResponseData }, UpdateSettingsInput>(
      "/me/settings",
      payload
    );
  }

  getUsage(): Promise<UsageSummary> {
    return this.client.get<UsageSummary>("/me/usage");
  }

  getDashboard(): Promise<DashboardResponseData> {
    return this.client.get<DashboardResponseData>("/dashboard");
  }

  getDashboardActivity(): Promise<DashboardActivityResponseData> {
    return this.client.get<DashboardActivityResponseData>("/dashboard/activity");
  }

  listMasterCvs(): Promise<MasterCvSummary[]> {
    return this.client.get<MasterCvSummary[]>("/master-cvs");
  }

  createMasterCv(payload: CreateMasterCvInput): Promise<MasterCvDetail> {
    return this.client.post<MasterCvDetail, CreateMasterCvInput>("/master-cvs", payload);
  }

  getMasterCv(masterCvId: string): Promise<MasterCvDetail> {
    return this.client.get<MasterCvDetail>(`/master-cvs/${masterCvId}`);
  }

  patchMasterCv(masterCvId: string, payload: UpdateMasterCvInput): Promise<MasterCvDetail> {
    return this.client.patch<MasterCvDetail, UpdateMasterCvInput>(`/master-cvs/${masterCvId}`, payload);
  }

  putMasterCvContent(masterCvId: string, currentContent: unknown): Promise<MasterCvDetail> {
    return this.client.put<MasterCvDetail, { current_content: unknown }>(
      `/master-cvs/${masterCvId}/content`,
      { current_content: currentContent }
    );
  }

  patchMasterCvBlock(
    masterCvId: string,
    blockId: string,
    payload: UpdateCvBlockInput
  ): Promise<MasterCvBlockUpdateResponse> {
    return this.client.patch<MasterCvBlockUpdateResponse, UpdateCvBlockInput>(
      `/master-cvs/${masterCvId}/blocks/${blockId}`,
      payload
    );
  }

  duplicateMasterCv(masterCvId: string): Promise<MasterCvDetail> {
    return this.client.post<MasterCvDetail>(`/master-cvs/${masterCvId}/duplicate`);
  }

  deleteMasterCv(masterCvId: string): Promise<{ id: string; is_deleted: true }> {
    return this.client.delete<{ id: string; is_deleted: true }>(`/master-cvs/${masterCvId}`);
  }

  getMasterCvPreview(masterCvId: string): Promise<MasterCvPreviewResponse> {
    return this.client.get<MasterCvPreviewResponse>(`/master-cvs/${masterCvId}/preview`);
  }

  patchMasterCvTemplate(masterCvId: string, templateId: string | null): Promise<MasterCvDetail> {
    return this.client.patch<MasterCvDetail, { template_id: string | null }>(
      `/master-cvs/${masterCvId}/template`,
      { template_id: templateId }
    );
  }

  createImportSession(payload: CreateImportSessionInput): Promise<ImportDetail> {
    return this.client.post<ImportDetail, CreateImportSessionInput>("/imports", payload);
  }

  createImportUploadUrl(payload: CreateImportUploadUrlInput): Promise<ImportUploadUrlTarget> {
    return this.client.post<ImportUploadUrlTarget, CreateImportUploadUrlInput>(
      "/imports/upload-url",
      payload
    );
  }

  getImport(importId: string): Promise<ImportDetail> {
    return this.client.get<ImportDetail>(`/imports/${importId}`);
  }

  markImportUploadComplete(importId: string): Promise<ImportDetail> {
    return this.client.post<ImportDetail>(`/imports/${importId}/upload-complete`);
  }

  parseImport(importId: string): Promise<ParseImportResponse> {
    return this.client.post<ParseImportResponse>(`/imports/${importId}/parse`);
  }

  getImportResult(importId: string): Promise<ImportResultView> {
    return this.client.get<ImportResultView>(`/imports/${importId}/result`);
  }

  patchImportResult(importId: string, parsedContent: unknown): Promise<ImportResultView> {
    return this.client.patch<ImportResultView, { parsed_content: unknown }>(
      `/imports/${importId}/result`,
      { parsed_content: parsedContent }
    );
  }

  createMasterCvFromImport(
    importId: string,
    payload: CreateMasterCvFromImportInput = {}
  ): Promise<CreateMasterCvFromImportResponse> {
    return this.client.post<CreateMasterCvFromImportResponse, CreateMasterCvFromImportInput>(
      `/imports/${importId}/create-master-cv`,
      payload
    );
  }

  listTailoredCvs(filters: TailoredCvListFilters = {}): Promise<TailoredCvSummary[]> {
    return this.client.get<TailoredCvSummary[]>("/tailored-cvs", {
      query: {
        status: filters.status,
        company_name: filters.company_name,
        sort_order: filters.sort_order
      }
    });
  }

  createTailoredCv(payload: CreateTailoredCvInput): Promise<TailoredCvDetail> {
    return this.client.post<TailoredCvDetail, CreateTailoredCvInput>("/tailored-cvs", payload);
  }

  getTailoredCv(tailoredCvId: string): Promise<TailoredCvDetail> {
    return this.client.get<TailoredCvDetail>(`/tailored-cvs/${tailoredCvId}`);
  }

  patchTailoredCv(tailoredCvId: string, payload: UpdateTailoredCvInput): Promise<TailoredCvDetail> {
    return this.client.patch<TailoredCvDetail, UpdateTailoredCvInput>(
      `/tailored-cvs/${tailoredCvId}`,
      payload
    );
  }

  putTailoredCvContent(tailoredCvId: string, currentContent: unknown): Promise<TailoredCvDetail> {
    return this.client.put<TailoredCvDetail, { current_content: unknown }>(
      `/tailored-cvs/${tailoredCvId}/content`,
      { current_content: currentContent }
    );
  }

  patchTailoredCvBlock(
    tailoredCvId: string,
    blockId: string,
    payload: UpdateCvBlockInput
  ): Promise<{ tailored_cv: TailoredCvDetail; updated_block: unknown; section_id: string }> {
    return this.client.patch<
      { tailored_cv: TailoredCvDetail; updated_block: unknown; section_id: string },
      UpdateCvBlockInput
    >(`/tailored-cvs/${tailoredCvId}/blocks/${blockId}`, payload);
  }

  deleteTailoredCv(tailoredCvId: string): Promise<{ id: string; is_deleted: true }> {
    return this.client.delete<{ id: string; is_deleted: true }>(`/tailored-cvs/${tailoredCvId}`);
  }

  getTailoredCvPreview(tailoredCvId: string): Promise<TailoredCvPreviewResponse> {
    return this.client.get<TailoredCvPreviewResponse>(`/tailored-cvs/${tailoredCvId}/preview`);
  }

  getTailoredCvSource(tailoredCvId: string): Promise<TailoredCvSourceResponse> {
    return this.client.get<TailoredCvSourceResponse>(`/tailored-cvs/${tailoredCvId}/source`);
  }

  patchTailoredCvTemplate(tailoredCvId: string, templateId: string | null): Promise<TailoredCvDetail> {
    return this.client.patch<TailoredCvDetail, { template_id: string | null }>(
      `/tailored-cvs/${tailoredCvId}/template`,
      { template_id: templateId }
    );
  }

  getTailoredCvAiHistory(tailoredCvId: string): Promise<TailoredCvAiHistoryResponse> {
    return this.client.get<TailoredCvAiHistoryResponse>(`/tailored-cvs/${tailoredCvId}/ai-history`);
  }

  getMasterCvAiHistory(masterCvId: string): Promise<CvAiHistoryResponse> {
    return this.client.get<CvAiHistoryResponse>(`/master-cvs/${masterCvId}/ai-history`);
  }

  getTailoredCvAiBlockVersions(tailoredCvId: string): Promise<CvAiBlockVersionsResponse> {
    return this.client.get<CvAiBlockVersionsResponse>(
      `/tailored-cvs/${tailoredCvId}/ai-block-versions`
    );
  }

  getMasterCvAiBlockVersions(masterCvId: string): Promise<CvAiBlockVersionsResponse> {
    return this.client.get<CvAiBlockVersionsResponse>(`/master-cvs/${masterCvId}/ai-block-versions`);
  }

  postJobAnalysis(payload: JobAnalysisInput): Promise<JobAnalysisResult> {
    return this.client.post<JobAnalysisResult, JobAnalysisInput>("/ai/job-analysis", payload);
  }

  startTailoringRun(payload: TailoringRunStartInput): Promise<TailoringRunStartResponse> {
    return this.client.post<TailoringRunStartResponse, TailoringRunStartInput>(
      "/ai/tailoring-runs/start",
      payload
    );
  }

  executeTailoringRun(aiRunId: string): Promise<TailoringRunExecuteResponse> {
    return this.client.post<TailoringRunExecuteResponse>(`/ai/tailoring-runs/${aiRunId}/execute`);
  }

  getTailoringRunStatus(aiRunId: string): Promise<TailoringRunStatusResponse> {
    return this.client.get<TailoringRunStatusResponse>(`/ai/tailoring-runs/${aiRunId}/status`);
  }

  getTailoringRunResult(aiRunId: string): Promise<TailoringRunResultResponse> {
    return this.client.get<TailoringRunResultResponse>(`/ai/tailoring-runs/${aiRunId}/result`);
  }

  postFollowUpQuestions(payload: FollowUpQuestionsInput): Promise<FollowUpQuestionsResult> {
    return this.client.post<FollowUpQuestionsResult, FollowUpQuestionsInput>(
      "/ai/follow-up-questions",
      payload
    );
  }

  postTailoredCvDraft(payload: TailoredDraftInput): Promise<TailoredCvDraftResult> {
    return this.client.post<TailoredCvDraftResult, TailoredDraftInput>("/ai/tailored-cv-draft", payload);
  }

  postImportImprove(payload: ImportImproveInput): Promise<ImportImproveResponse> {
    return this.client.post<ImportImproveResponse, ImportImproveInput>("/ai/import-improve", payload);
  }

  postBlockSuggest(payload: BlockSuggestInput): Promise<AiSuggestResponse> {
    return this.client.post<AiSuggestResponse, BlockSuggestInput>("/ai/blocks/suggest", payload);
  }

  postBlockCompare(payload: BlockCompareInput): Promise<AiBlockCompareResult> {
    return this.client.post<AiBlockCompareResult, BlockCompareInput>("/ai/blocks/compare", payload);
  }

  postBlockOptions(payload: BlockOptionsInput): Promise<AiBlockOptionsResult> {
    return this.client.post<AiBlockOptionsResult, BlockOptionsInput>("/ai/blocks/options", payload);
  }

  getSuggestion(suggestionId: string): Promise<AiSuggestionDetail> {
    return this.client.get<AiSuggestionDetail>(`/ai/suggestions/${suggestionId}`);
  }

  applySuggestion(suggestionId: string): Promise<SuggestionApplyResponse> {
    return this.client.post<SuggestionApplyResponse>(`/ai/suggestions/${suggestionId}/apply`);
  }

  rejectSuggestion(suggestionId: string): Promise<SuggestionRejectResponse> {
    return this.client.post<SuggestionRejectResponse>(`/ai/suggestions/${suggestionId}/reject`);
  }

  listTailoredCvRevisions(tailoredCvId: string): Promise<TailoredCvRevisionListResponse> {
    return this.client.get<TailoredCvRevisionListResponse>(`/tailored-cvs/${tailoredCvId}/revisions`);
  }

  listBlockRevisions(tailoredCvId: string, blockId: string): Promise<BlockRevisionListResponse> {
    return this.client.get<BlockRevisionListResponse>(
      `/tailored-cvs/${tailoredCvId}/blocks/${blockId}/revisions`
    );
  }

  getRevision(revisionId: string): Promise<CvBlockRevisionDetail> {
    return this.client.get<CvBlockRevisionDetail>(`/revisions/${revisionId}`);
  }

  restoreRevision(revisionId: string): Promise<RestoreRevisionResponse> {
    return this.client.post<RestoreRevisionResponse>(`/revisions/${revisionId}/restore`);
  }

  compareRevisions(fromRevisionId: string, toRevisionId: string): Promise<RevisionCompareResponse> {
    return this.client.post<RevisionCompareResponse, { from_revision_id: string; to_revision_id: string }>(
      "/revisions/compare",
      {
        from_revision_id: fromRevisionId,
        to_revision_id: toRevisionId
      }
    );
  }

  listJobs(filters: JobFilters = {}): Promise<ListJobsResponse> {
    return this.client.get<ListJobsResponse>("/jobs", {
      query: {
        status: filters.status,
        search: filters.search,
        sort_by: filters.sort_by,
        sort_order: filters.sort_order,
        linked_tailored_cv: filters.linked_tailored_cv,
        page: filters.page,
        limit: filters.limit
      }
    });
  }

  getJob(jobId: string): Promise<JobDetail> {
    return this.client.get<JobDetail>(`/jobs/${jobId}`);
  }

  patchJob(jobId: string, payload: UpdateJobInput): Promise<JobDetail> {
    return this.client.patch<JobDetail, UpdateJobInput>(`/jobs/${jobId}`, payload);
  }

  patchJobStatus(jobId: string, status: JobStatus): Promise<UpdateJobStatusResponse> {
    return this.client.patch<UpdateJobStatusResponse, { status: JobStatus }>(
      `/jobs/${jobId}/status`,
      { status }
    );
  }

  getJobsBoard(filters: Omit<JobFilters, "status" | "page" | "limit"> = {}): Promise<JobBoardResponse> {
    return this.client.get<JobBoardResponse>("/jobs/board", {
      query: {
        search: filters.search,
        sort_by: filters.sort_by,
        sort_order: filters.sort_order,
        linked_tailored_cv: filters.linked_tailored_cv
      }
    });
  }

  getJobHistory(jobId: string): Promise<JobHistoryResponse> {
    return this.client.get<JobHistoryResponse>(`/jobs/${jobId}/history`);
  }

  listCoverLetters(): Promise<ListCoverLettersResponse> {
    return this.client.get<ListCoverLettersResponse>("/cover-letters");
  }

  upsertCoverLetterByJob(jobId: string): Promise<CoverLetterDetail> {
    return this.client.post<CoverLetterDetail>(`/jobs/${jobId}/cover-letter`);
  }

  getCoverLetter(coverLetterId: string): Promise<CoverLetterDetail> {
    return this.client.get<CoverLetterDetail>(`/cover-letters/${coverLetterId}`);
  }

  postGenerateCoverLetter(payload: CoverLetterGenerationInput): Promise<{ title: string; content: string }> {
    return this.client.post<{ title: string; content: string }, CoverLetterGenerationInput>(
      "/ai/cover-letters/generate",
      payload
    );
  }

  putCoverLetterContent(
    coverLetterId: string,
    payload: UpdateCoverLetterContentInput
  ): Promise<CoverLetterDetail> {
    return this.client.put<CoverLetterDetail, UpdateCoverLetterContentInput>(
      `/cover-letters/${coverLetterId}/content`,
      payload
    );
  }

  createCoverLetterPdfExport(coverLetterId: string): Promise<CoverLetterExportDetailResponse> {
    return this.client.post<CoverLetterExportDetailResponse>(
      `/cover-letters/${coverLetterId}/exports/pdf`
    );
  }

  createCoverLetterDocxExport(coverLetterId: string): Promise<CoverLetterExportDetailResponse> {
    return this.client.post<CoverLetterExportDetailResponse>(
      `/cover-letters/${coverLetterId}/exports/docx`
    );
  }

  listCoverLetterExports(coverLetterId: string): Promise<ListCoverLetterExportsResponse> {
    return this.client.get<ListCoverLetterExportsResponse>(`/cover-letters/${coverLetterId}/exports`);
  }

  getCoverLetterExport(coverLetterExportId: string): Promise<CoverLetterExportDetailResponse> {
    return this.client.get<CoverLetterExportDetailResponse>(
      `/cover-letter-exports/${coverLetterExportId}`
    );
  }

  getCoverLetterExportDownload(
    coverLetterExportId: string
  ): Promise<CoverLetterExportDownloadResponse> {
    return this.client.get<CoverLetterExportDownloadResponse>(
      `/cover-letter-exports/${coverLetterExportId}/download`
    );
  }

  listTemplates(): Promise<ListTemplatesResponse> {
    return this.client.get<ListTemplatesResponse>("/templates");
  }

  getTemplate(templateId: string): Promise<TemplateDetail> {
    return this.client.get<TemplateDetail>(`/templates/${templateId}`);
  }

  postRenderingPreview(payload: {
    cv_kind: "master" | "tailored";
    current_content: unknown;
    template_id?: string | null;
    language?: string;
    context?: Record<string, unknown>;
  }): Promise<RenderingPreviewResponse> {
    return this.client.post<
      RenderingPreviewResponse,
      {
        cv_kind: "master" | "tailored";
        current_content: unknown;
        template_id?: string | null;
        language?: string;
        context?: Record<string, unknown>;
      }
    >("/rendering/preview", payload);
  }

  createPdfExport(tailoredCvId: string, payload: CreateExportInput = {}): Promise<ExportDetailResponse> {
    return this.client.post<ExportDetailResponse, CreateExportInput>(
      `/tailored-cvs/${tailoredCvId}/exports/pdf`,
      payload
    );
  }

  createMasterCvPdfExport(masterCvId: string, payload: CreateExportInput = {}): Promise<ExportDetailResponse> {
    return this.client.post<ExportDetailResponse, CreateExportInput>(
      `/master-cvs/${masterCvId}/exports/pdf`,
      payload
    );
  }

  createDocxExport(
    tailoredCvId: string,
    payload: CreateExportInput = {}
  ): Promise<ExportDetailResponse> {
    return this.client.post<ExportDetailResponse, CreateExportInput>(
      `/tailored-cvs/${tailoredCvId}/exports/docx`,
      payload
    );
  }

  createMasterCvDocxExport(
    masterCvId: string,
    payload: CreateExportInput = {}
  ): Promise<ExportDetailResponse> {
    return this.client.post<ExportDetailResponse, CreateExportInput>(
      `/master-cvs/${masterCvId}/exports/docx`,
      payload
    );
  }

  listTailoredCvExports(tailoredCvId: string): Promise<ListTailoredCvExportsResponse> {
    return this.client.get<ListTailoredCvExportsResponse>(`/tailored-cvs/${tailoredCvId}/exports`);
  }

  listMasterCvExports(masterCvId: string): Promise<ListMasterCvExportsResponse> {
    return this.client.get<ListMasterCvExportsResponse>(`/master-cvs/${masterCvId}/exports`);
  }

  getExport(exportId: string): Promise<ExportDetailResponse> {
    return this.client.get<ExportDetailResponse>(`/exports/${exportId}`);
  }

  getExportDownload(exportId: string): Promise<ExportDownloadResponse> {
    return this.client.get<ExportDownloadResponse>(`/exports/${exportId}/download`);
  }

  deleteExport(_exportId: string): Promise<{ id: string; deleted: true }> {
    return Promise.reject(new Error("DELETE /exports/:exportId is not implemented in backend"));
  }

  getBillingPlan(): Promise<BillingPlanResponseData> {
    return this.client.get<BillingPlanResponseData>("/billing/plan");
  }

  getBillingUsage(): Promise<UsageSummary> {
    return this.client.get<UsageSummary>("/billing/usage");
  }

  getBillingEntitlements(): Promise<EntitlementSummary> {
    return this.client.get<EntitlementSummary>("/billing/entitlements");
  }

  createBillingCheckout(payload: BillingCheckoutInput): Promise<CreateCheckoutResponseData> {
    return this.client.post<CreateCheckoutResponseData, BillingCheckoutInput>(
      "/billing/checkout",
      payload
    );
  }

  createBillingPortal(payload: BillingPortalInput = {}): Promise<CreatePortalResponseData> {
    return this.client.post<CreatePortalResponseData, BillingPortalInput>("/billing/portal", payload);
  }
}
