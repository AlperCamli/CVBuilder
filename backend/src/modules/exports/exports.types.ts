import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { DownloadAccess } from "../files/files.service";
import type { ResolvedTemplateSummary, TemplateSummary } from "../templates/templates.types";
import type {
  ExportFormat,
  ExportStatus,
  FileRecord,
  MasterCvRecord,
  TailoredCvRecord
} from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface CreateExportInput {
  template_id?: string | null;
  font_scale?: number;
  spacing_scale?: number;
  layout_scale?: number;
}

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

export interface ListMasterCvExportsResponse {
  master_cv_id: string;
  exports: ExportSummaryItem[];
}

export interface ExportFileSummary {
  id: string;
  file_type: FileRecord["file_type"];
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ExportTailoredCvSummary {
  id: string;
  title: string;
  status: TailoredCvRecord["status"];
  template_id: string | null;
  updated_at: string;
}

export interface ExportMasterCvSummary {
  id: string;
  title: string;
  source_type: MasterCvRecord["source_type"];
  template_id: string | null;
  updated_at: string;
}

export interface ExportDetailResponse {
  export: ExportSummaryItem;
  tailored_cv: ExportTailoredCvSummary | null;
  master_cv: ExportMasterCvSummary | null;
  file: ExportFileSummary | null;
  template: TemplateSummary | null;
  resolved_template: ResolvedTemplateSummary | null;
  download: DownloadAccess | null;
}

export interface ExportDownloadResponse extends DownloadAccess {
  export_id: string;
  format: ExportFormat;
}
