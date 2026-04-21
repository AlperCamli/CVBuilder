import { createHash } from "node:crypto";
import { ExportStorageFailedError } from "../../shared/errors/app-error";
import type { ExportFormat, FileRecord } from "../../shared/types/domain";
import type { CreateFilePayload, FilesRepository } from "./files.repository";

interface FilesServiceOptions {
  storageBucket: string;
  downloadUrlTtlSeconds: number;
}

interface BuildExportStoragePathInput {
  userId: string;
  tailoredCvId: string;
  exportId: string;
  format: ExportFormat;
}

interface UploadExportObjectInput extends BuildExportStoragePathInput {
  bytes: Uint8Array;
}

interface BuildCoverLetterExportStoragePathInput {
  userId: string;
  coverLetterId: string;
  exportId: string;
  format: ExportFormat;
}

interface UploadCoverLetterExportObjectInput extends BuildCoverLetterExportStoragePathInput {
  bytes: Uint8Array;
}

interface CreateExportFileMetadataInput {
  userId: string;
  format: ExportFormat;
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface DownloadAccess {
  download_url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export interface UploadedExportObject {
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  original_filename: string;
}

const EXTENSION_BY_FORMAT: Record<ExportFormat, "pdf" | "docx"> = {
  pdf: "pdf",
  docx: "docx"
};

const MIME_TYPE_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};

const FILE_TYPE_BY_FORMAT: Record<ExportFormat, FileRecord["file_type"]> = {
  pdf: "export_pdf",
  docx: "export_docx"
};

export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly options: FilesServiceOptions
  ) {}

  buildExportStoragePath(input: BuildExportStoragePathInput): string {
    const extension = EXTENSION_BY_FORMAT[input.format];
    return `users/${input.userId}/tailored-cvs/${input.tailoredCvId}/exports/${input.exportId}.${extension}`;
  }

  buildCoverLetterExportStoragePath(input: BuildCoverLetterExportStoragePathInput): string {
    const extension = EXTENSION_BY_FORMAT[input.format];
    return `users/${input.userId}/cover-letters/${input.coverLetterId}/exports/${input.exportId}.${extension}`;
  }

  async uploadExportObject(input: UploadExportObjectInput): Promise<UploadedExportObject> {
    const storagePath = this.buildExportStoragePath(input);
    const mimeType = MIME_TYPE_BY_FORMAT[input.format];

    try {
      await this.filesRepository.uploadStorageObject({
        storage_bucket: this.options.storageBucket,
        storage_path: storagePath,
        content: input.bytes,
        mime_type: mimeType
      });
    } catch (error) {
      throw new ExportStorageFailedError("Failed to upload export file", {
        format: input.format,
        reason: error instanceof Error ? error.message : "storage_upload_failed"
      });
    }

    return {
      storage_bucket: this.options.storageBucket,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: input.bytes.byteLength,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      original_filename: `tailored-cv-export-${input.exportId}.${EXTENSION_BY_FORMAT[input.format]}`
    };
  }

  async uploadCoverLetterExportObject(
    input: UploadCoverLetterExportObjectInput
  ): Promise<UploadedExportObject> {
    const storagePath = this.buildCoverLetterExportStoragePath(input);
    const mimeType = MIME_TYPE_BY_FORMAT[input.format];

    try {
      await this.filesRepository.uploadStorageObject({
        storage_bucket: this.options.storageBucket,
        storage_path: storagePath,
        content: input.bytes,
        mime_type: mimeType
      });
    } catch (error) {
      throw new ExportStorageFailedError("Failed to upload export file", {
        format: input.format,
        reason: error instanceof Error ? error.message : "storage_upload_failed"
      });
    }

    return {
      storage_bucket: this.options.storageBucket,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: input.bytes.byteLength,
      checksum: createHash("sha256").update(input.bytes).digest("hex"),
      original_filename: `cover-letter-export-${input.exportId}.${EXTENSION_BY_FORMAT[input.format]}`
    };
  }

  async createExportFileMetadata(input: CreateExportFileMetadataInput): Promise<FileRecord> {
    const payload: CreateFilePayload = {
      user_id: input.userId,
      file_type: FILE_TYPE_BY_FORMAT[input.format],
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      checksum: input.checksum
    };

    try {
      return await this.filesRepository.createFile(payload);
    } catch (error) {
      throw new ExportStorageFailedError("Failed to persist export file metadata", {
        format: input.format,
        reason: error instanceof Error ? error.message : "file_metadata_persist_failed"
      });
    }
  }

  async createCoverLetterExportFileMetadata(input: CreateExportFileMetadataInput): Promise<FileRecord> {
    return this.createExportFileMetadata(input);
  }

  async findOwnedFileById(userId: string, fileId: string): Promise<FileRecord | null> {
    return this.filesRepository.findById(userId, fileId);
  }

  async createSignedDownloadAccess(file: FileRecord): Promise<DownloadAccess> {
    const ttl = this.options.downloadUrlTtlSeconds;

    let downloadUrl: string;
    try {
      downloadUrl = await this.filesRepository.createSignedDownloadUrl(
        file.storage_bucket,
        file.storage_path,
        ttl
      );
    } catch (error) {
      throw new ExportStorageFailedError("Failed to prepare export download URL", {
        file_id: file.id,
        reason: error instanceof Error ? error.message : "signed_url_failed"
      });
    }

    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    return {
      download_url: downloadUrl,
      expires_at: expiresAt,
      expires_in_seconds: ttl
    };
  }

  async deleteStorageObject(storageBucket: string, storagePath: string): Promise<void> {
    try {
      await this.filesRepository.deleteStorageObject(storageBucket, storagePath);
    } catch {
      // Best-effort cleanup.
    }
  }

  async softDeleteFileMetadata(userId: string, fileId: string): Promise<void> {
    try {
      await this.filesRepository.softDeleteById(userId, fileId);
    } catch {
      // Best-effort cleanup.
    }
  }
}
