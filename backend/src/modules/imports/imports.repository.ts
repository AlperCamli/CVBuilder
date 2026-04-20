import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type { FileRecord, ImportRecord, ImportStatus, MasterCvRecord } from "../../shared/types/domain";

export interface CreateFilePayload {
  user_id: string;
  file_type: FileRecord["file_type"];
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string | null;
}

export interface CreateImportPayload {
  user_id: string;
  source_file_id: string;
  status: ImportStatus;
}

export interface ImportUpdatePayload {
  status?: ImportStatus;
  parser_name?: string | null;
  raw_extracted_text?: string | null;
  parsed_content?: CvContent | null;
  error_message?: string | null;
  target_master_cv_id?: string | null;
}

export interface ImportDetailRow {
  importRow: ImportRecord;
  sourceFile: FileRecord;
  targetMasterCv: Pick<MasterCvRecord, "id" | "title" | "language" | "template_id" | "created_at"> | null;
}

export interface SignedUploadTarget {
  storage_path: string;
  token: string;
}

export interface ImportsRepository {
  createFile(payload: CreateFilePayload): Promise<FileRecord>;
  createImport(payload: CreateImportPayload): Promise<ImportRecord>;
  findImportDetailById(userId: string, importId: string): Promise<ImportDetailRow | null>;
  updateImport(userId: string, importId: string, payload: ImportUpdatePayload): Promise<ImportRecord | null>;
  createSignedUploadUrl(storageBucket: string, storagePath: string): Promise<SignedUploadTarget>;
  downloadStorageObject(storageBucket: string, storagePath: string): Promise<Uint8Array>;
}

const toFileRecord = (row: Record<string, unknown>): FileRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    file_type: row.file_type as FileRecord["file_type"],
    storage_bucket: String(row.storage_bucket),
    storage_path: String(row.storage_path),
    original_filename: String(row.original_filename),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes),
    checksum: (row.checksum as string | null) ?? null,
    is_deleted: Boolean(row.is_deleted),
    created_at: String(row.created_at)
  };
};

const toImportRecord = (row: Record<string, unknown>): ImportRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    source_file_id: String(row.source_file_id),
    target_master_cv_id: row.target_master_cv_id ? String(row.target_master_cv_id) : null,
    status: row.status as ImportStatus,
    parser_name: (row.parser_name as string | null) ?? null,
    raw_extracted_text: (row.raw_extracted_text as string | null) ?? null,
    parsed_content: (row.parsed_content as CvContent | null) ?? null,
    error_message: (row.error_message as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

const toMasterCvSummary = (
  row: Record<string, unknown>
): Pick<MasterCvRecord, "id" | "title" | "language" | "template_id" | "created_at"> => {
  return {
    id: String(row.id),
    title: String(row.title),
    language: String(row.language),
    template_id: row.template_id ? String(row.template_id) : null,
    created_at: String(row.created_at)
  };
};

export class SupabaseImportsRepository implements ImportsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async createFile(payload: CreateFilePayload): Promise<FileRecord> {
    const { data, error } = await this.supabaseClient
      .from("files")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create source file metadata", {
        reason: error.message
      });
    }

    return toFileRecord(data as Record<string, unknown>);
  }

  async createImport(payload: CreateImportPayload): Promise<ImportRecord> {
    const { data, error } = await this.supabaseClient
      .from("imports")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create import session", {
        reason: error.message
      });
    }

    return toImportRecord(data as Record<string, unknown>);
  }

  async findImportDetailById(userId: string, importId: string): Promise<ImportDetailRow | null> {
    const { data: importData, error: importError } = await this.supabaseClient
      .from("imports")
      .select("*")
      .eq("id", importId)
      .eq("user_id", userId)
      .maybeSingle();

    if (importError) {
      throw new InternalServerError("Failed to load import session", {
        reason: importError.message
      });
    }

    if (!importData) {
      return null;
    }

    const importRow = toImportRecord(importData as Record<string, unknown>);

    const { data: fileData, error: fileError } = await this.supabaseClient
      .from("files")
      .select("*")
      .eq("id", importRow.source_file_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (fileError) {
      throw new InternalServerError("Failed to load import source file", {
        reason: fileError.message
      });
    }

    if (!fileData) {
      throw new InternalServerError("Failed to load import source file", {
        reason: "source_file_not_found"
      });
    }

    let targetMasterCv: Pick<
      MasterCvRecord,
      "id" | "title" | "language" | "template_id" | "created_at"
    > | null = null;

    if (importRow.target_master_cv_id) {
      const { data: masterCvData, error: masterCvError } = await this.supabaseClient
        .from("master_cvs")
        .select("id, title, language, template_id, created_at")
        .eq("id", importRow.target_master_cv_id)
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (masterCvError) {
        throw new InternalServerError("Failed to load import target master CV", {
          reason: masterCvError.message
        });
      }

      if (masterCvData) {
        targetMasterCv = toMasterCvSummary(masterCvData as Record<string, unknown>);
      }
    }

    return {
      importRow,
      sourceFile: toFileRecord(fileData as Record<string, unknown>),
      targetMasterCv
    };
  }

  async updateImport(
    userId: string,
    importId: string,
    payload: ImportUpdatePayload
  ): Promise<ImportRecord | null> {
    const updatePayload: Record<string, unknown> = {
      ...payload
    };

    if (Object.prototype.hasOwnProperty.call(payload, "parsed_content")) {
      updatePayload.parsed_content = payload.parsed_content;
    }

    const { data, error } = await this.supabaseClient
      .from("imports")
      .update(updatePayload)
      .eq("id", importId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update import session", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toImportRecord(data as Record<string, unknown>);
  }

  async createSignedUploadUrl(
    storageBucket: string,
    storagePath: string
  ): Promise<SignedUploadTarget> {
    const { data, error } = await this.supabaseClient.storage
      .from(storageBucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data?.token) {
      throw new InternalServerError("Failed to create signed upload URL", {
        reason: error?.message ?? "missing_upload_token",
        storage_bucket: storageBucket,
        storage_path: storagePath
      });
    }

    return {
      storage_path: storagePath,
      token: data.token
    };
  }

  async downloadStorageObject(storageBucket: string, storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.supabaseClient.storage
      .from(storageBucket)
      .download(storagePath);

    if (error) {
      throw new InternalServerError("Failed to download source file from storage", {
        reason: error.message,
        storage_bucket: storageBucket,
        storage_path: storagePath
      });
    }

    const arrayBuffer = await data.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}
