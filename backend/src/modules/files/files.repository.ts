import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { FileRecord } from "../../shared/types/domain";

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

export interface UploadStorageObjectPayload {
  storage_bucket: string;
  storage_path: string;
  content: Uint8Array;
  mime_type: string;
}

export interface FilesRepository {
  createFile(payload: CreateFilePayload): Promise<FileRecord>;
  findById(userId: string, fileId: string): Promise<FileRecord | null>;
  softDeleteById(userId: string, fileId: string): Promise<boolean>;
  uploadStorageObject(payload: UploadStorageObjectPayload): Promise<void>;
  deleteStorageObject(storageBucket: string, storagePath: string): Promise<void>;
  createSignedDownloadUrl(
    storageBucket: string,
    storagePath: string,
    expiresInSeconds: number
  ): Promise<string>;
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

export class SupabaseFilesRepository implements FilesRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async createFile(payload: CreateFilePayload): Promise<FileRecord> {
    const { data, error } = await this.supabaseClient
      .from("files")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create generated file metadata", {
        reason: error.message
      });
    }

    return toFileRecord(data as Record<string, unknown>);
  }

  async findById(userId: string, fileId: string): Promise<FileRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load file metadata", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toFileRecord(data as Record<string, unknown>);
  }

  async softDeleteById(userId: string, fileId: string): Promise<boolean> {
    const { data, error } = await this.supabaseClient
      .from("files")
      .update({
        is_deleted: true
      })
      .eq("id", fileId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to soft delete file metadata", {
        reason: error.message
      });
    }

    return Boolean(data);
  }

  async uploadStorageObject(payload: UploadStorageObjectPayload): Promise<void> {
    const { error } = await this.supabaseClient.storage
      .from(payload.storage_bucket)
      .upload(payload.storage_path, payload.content, {
        contentType: payload.mime_type,
        upsert: false
      });

    if (error) {
      throw new InternalServerError("Failed to upload generated file to storage", {
        reason: error.message,
        storage_bucket: payload.storage_bucket,
        storage_path: payload.storage_path
      });
    }
  }

  async deleteStorageObject(storageBucket: string, storagePath: string): Promise<void> {
    const { error } = await this.supabaseClient.storage.from(storageBucket).remove([storagePath]);

    if (error) {
      throw new InternalServerError("Failed to delete generated file from storage", {
        reason: error.message,
        storage_bucket: storageBucket,
        storage_path: storagePath
      });
    }
  }

  async createSignedDownloadUrl(
    storageBucket: string,
    storagePath: string,
    expiresInSeconds: number
  ): Promise<string> {
    const { data, error } = await this.supabaseClient.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new InternalServerError("Failed to create download URL", {
        reason: error?.message ?? "missing_signed_url",
        storage_bucket: storageBucket,
        storage_path: storagePath
      });
    }

    return data.signedUrl;
  }
}
