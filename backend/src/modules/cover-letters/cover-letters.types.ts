import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { DownloadAccess } from "../files/files.service";
import type { CoverLetterStatus, ExportFormat, ExportStatus, FileRecord } from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface CoverLetterJobSummary {
  id: string;
  company_name: string;
  job_title: string;
  job_description: string | null;
  status: string;
  tailored_cv_id: string | null;
  tailored_cv_title: string | null;
  cover_letter_id: string | null;
}

export interface CoverLetterSummary {
  id: string;
  job_id: string;
  tailored_cv_id: string | null;
  title: string;
  status: CoverLetterStatus;
  last_exported_at: string | null;
  created_at: string;
  updated_at: string;
  job: CoverLetterJobSummary | null;
}

export interface CoverLetterDetail extends CoverLetterSummary {
  content: string;
}

export interface UpdateCoverLetterContentInput {
  title?: string;
  content: string;
  status?: CoverLetterStatus;
}

export interface CoverLetterExportSummaryItem {
  id: string;
  format: ExportFormat;
  status: ExportStatus;
  file_id: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  download_available: boolean;
}

export interface ListCoverLetterExportsResponse {
  cover_letter_id: string;
  exports: CoverLetterExportSummaryItem[];
}

export interface CoverLetterExportFileSummary {
  id: string;
  file_type: FileRecord["file_type"];
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface CoverLetterExportDetailResponse {
  export: CoverLetterExportSummaryItem;
  cover_letter: CoverLetterSummary | null;
  file: CoverLetterExportFileSummary | null;
  download: DownloadAccess | null;
}

export interface CoverLetterExportDownloadResponse extends DownloadAccess {
  cover_letter_export_id: string;
  format: ExportFormat;
}
