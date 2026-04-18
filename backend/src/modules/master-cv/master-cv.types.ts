import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { CvBlock, CvBlockPatch, CvContent, CvPreview } from "../../shared/cv-content/cv-content.types";
import type { MasterCvSourceType } from "../../shared/types/domain";
import type { RenderingPayload } from "../rendering/rendering.types";
import type { ResolvedTemplateSummary } from "../templates/templates.types";

export type SessionContext = AuthenticatedRequestContext;

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

export interface ReplaceMasterCvContentInput {
  current_content: unknown;
}

export type UpdateMasterCvBlockInput = CvBlockPatch;

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
