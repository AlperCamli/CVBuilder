import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type {
  FileRecord,
  ImportRecord,
  ImportStatus,
  MasterCvRecord
} from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface CreateImportSessionInput {
  original_filename: string;
  mime_type: string;
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

export interface UpdateImportResultInput {
  parsed_content: unknown;
}

export interface CreateMasterCvFromImportInput {
  title?: string;
  language?: string;
  template_id?: string | null;
}

export interface ImportDetail {
  import: ImportRecord;
  source_file: FileRecord;
  target_master_cv: Pick<MasterCvRecord, "id" | "title" | "language" | "template_id" | "created_at"> | null;
}

export interface ImportResultView {
  status: ImportStatus;
  parser_name: string | null;
  raw_extracted_text: string | null;
  parsed_content: CvContent | null;
  error_message: string | null;
}

export interface ParseSummary {
  parser_name: string;
  status: "parsed" | "failed";
  raw_text_length: number;
  section_count: number;
  block_count: number;
  warnings: string[];
}
