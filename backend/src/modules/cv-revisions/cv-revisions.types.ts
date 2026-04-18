import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { CvBlock } from "../../shared/cv-content/cv-content.types";
import type { CvKind, CvRevisionChangeSource } from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface CvBlockRevisionSummary {
  id: string;
  cv_kind: CvKind;
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

export interface CreateTailoredBlockRevisionInput {
  user_id: string;
  tailored_cv_id: string;
  block: CvBlock;
  change_source: CvRevisionChangeSource;
  ai_suggestion_id?: string | null;
  created_by_user_id?: string | null;
}

export interface RestoreRevisionResponse {
  tailored_cv_id: string;
  restored_from_revision_id: string;
  restored_block: CvBlock;
  section_id: string;
  created_revision: CvBlockRevisionSummary;
}

export interface RevisionDiffPayload {
  same_cv: boolean;
  same_block: boolean;
  changed_block_type: boolean;
  changed_visibility: boolean;
  changed_order: boolean;
  changed_fields: string[];
  changed_meta: string[];
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
}

export interface RevisionCompareResponse {
  from_revision: CvBlockRevisionSummary;
  to_revision: CvBlockRevisionSummary;
  comparison: RevisionDiffPayload;
}
