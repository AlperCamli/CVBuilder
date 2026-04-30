import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { CvBlock, CvBlockPatch, CvContent, CvPreview } from "../../shared/cv-content/cv-content.types";
import type { JobStatus, TailoredCvStatus } from "../../shared/types/domain";
import type { RenderingPayload } from "../rendering/rendering.types";
import type { RenderingPresentation } from "../rendering/rendering-presentation";
import type { ResolvedTemplateSummary } from "../templates/templates.types";

export type SessionContext = AuthenticatedRequestContext;

export interface TailoredCvJobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
}

export interface TailoredCvSourceMasterSummary {
  id: string;
  title: string;
  language: string;
  template_id: string | null;
  updated_at: string;
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
  presentation: RenderingPresentation;
}

export interface TailoredCvSourceResponse {
  tailored_cv_id: string;
  master_cv_id: string;
  master_cv: TailoredCvSourceMasterSummary | null;
  job: TailoredCvJobSummary | null;
  created_at: string;
  updated_at: string;
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
  status?: TailoredCvStatus;
}

export interface ReplaceTailoredCvContentInput {
  current_content: unknown;
}

export type UpdateTailoredCvBlockInput = CvBlockPatch;

export interface TailoredCvBlockUpdateResponse {
  tailored_cv: TailoredCvDetail;
  updated_block: CvBlock;
  section_id: string;
}

export interface TailoredCvListFilters {
  status?: TailoredCvStatus;
  company_name?: string;
  sort_order?: "asc" | "desc";
}
