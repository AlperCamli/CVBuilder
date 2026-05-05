import { describe, expect, it, vi } from "vitest";
import { FilesService } from "../src/modules/files/files.service";
import type { CreateFilePayload, FilesRepository, UploadStorageObjectPayload } from "../src/modules/files/files.repository";
import type { FileRecord } from "../src/shared/types/domain";

const nowIso = (): string => new Date().toISOString();

class FakeFilesRepository implements FilesRepository {
  uploadedPayload: UploadStorageObjectPayload | null = null;
  signedUrlInput: { bucket: string; path: string; expires: number; filename?: string } | null = null;

  async createFile(_payload: CreateFilePayload): Promise<FileRecord> {
    return {
      id: "file-id",
      user_id: "user-id",
      file_type: "export_pdf",
      storage_bucket: "exports",
      storage_path: "users/user-id/tailored-cvs/tailored-id/exports/export-id.pdf",
      original_filename: "cv.pdf",
      mime_type: "application/pdf",
      size_bytes: 123,
      checksum: null,
      is_deleted: false,
      created_at: nowIso()
    };
  }

  async findById(_userId: string, _fileId: string): Promise<FileRecord | null> {
    return null;
  }

  async softDeleteById(_userId: string, _fileId: string): Promise<boolean> {
    return true;
  }

  async uploadStorageObject(payload: UploadStorageObjectPayload): Promise<void> {
    this.uploadedPayload = payload;
  }

  async deleteStorageObject(_storageBucket: string, _storagePath: string): Promise<void> {
    return;
  }

  async createSignedDownloadUrl(
    storageBucket: string,
    storagePath: string,
    expiresInSeconds: number,
    forcedDownloadFilename?: string
  ): Promise<string> {
    this.signedUrlInput = {
      bucket: storageBucket,
      path: storagePath,
      expires: expiresInSeconds,
      filename: forcedDownloadFilename
    };

    return "https://example.com/signed-url";
  }
}

describe("files service", () => {
  it("builds deterministic export storage paths", () => {
    const service = new FilesService(new FakeFilesRepository(), {
      storageBucket: "exports",
      downloadUrlTtlSeconds: 600
    });

    const pdfPath = service.buildExportStoragePath({
      userId: "user-1",
      cvKind: "tailored",
      cvId: "tailored-1",
      exportId: "export-1",
      format: "pdf"
    });

    const docxPath = service.buildExportStoragePath({
      userId: "user-1",
      cvKind: "tailored",
      cvId: "tailored-1",
      exportId: "export-2",
      format: "docx"
    });

    const masterPdfPath = service.buildExportStoragePath({
      userId: "user-1",
      cvKind: "master",
      cvId: "master-1",
      exportId: "export-3",
      format: "pdf"
    });

    expect(pdfPath).toBe("users/user-1/tailored-cvs/tailored-1/exports/export-1.pdf");
    expect(docxPath).toBe("users/user-1/tailored-cvs/tailored-1/exports/export-2.docx");
    expect(masterPdfPath).toBe("users/user-1/master-cvs/master-1/exports/export-3.pdf");
  });

  it("returns signed URL metadata with configured expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));

    const repository = new FakeFilesRepository();
    const service = new FilesService(repository, {
      storageBucket: "exports",
      downloadUrlTtlSeconds: 900
    });

    const response = await service.createSignedDownloadAccess({
      id: "file-1",
      user_id: "user-1",
      file_type: "export_pdf",
      storage_bucket: "exports",
      storage_path: "users/user-1/tailored-cvs/tailored-1/exports/export-1.pdf",
      original_filename: "cv.pdf",
      mime_type: "application/pdf",
      size_bytes: 1234,
      checksum: "abc",
      is_deleted: false,
      created_at: nowIso()
    });

    expect(repository.signedUrlInput).toEqual({
      bucket: "exports",
      path: "users/user-1/tailored-cvs/tailored-1/exports/export-1.pdf",
      expires: 900,
      filename: undefined
    });
    expect(response.download_url).toBe("https://example.com/signed-url");
    expect(response.expires_in_seconds).toBe(900);
    expect(response.expires_at).toBe("2026-04-18T12:15:00.000Z");

    vi.useRealTimers();
  });

  it("passes forced download filename when requested", async () => {
    const repository = new FakeFilesRepository();
    const service = new FilesService(repository, {
      storageBucket: "exports",
      downloadUrlTtlSeconds: 900
    });

    await service.createSignedDownloadAccess(
      {
        id: "file-1",
        user_id: "user-1",
        file_type: "export_pdf",
        storage_bucket: "exports",
        storage_path: "users/user-1/tailored-cvs/tailored-1/exports/export-1.pdf",
        original_filename: "cv.pdf",
        mime_type: "application/pdf",
        size_bytes: 1234,
        checksum: "abc",
        is_deleted: false,
        created_at: nowIso()
      },
      {
        forcedDownloadFilename: "Senior Engineer CV.pdf"
      }
    );

    expect(repository.signedUrlInput?.filename).toBe("Senior Engineer CV.pdf");
  });
});
