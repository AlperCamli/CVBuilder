import { describe, expect, it } from "vitest";
import { CvPhotosService } from "../src/modules/cv-photos/cv-photos.service";
import type {
  CreateFilePayload,
  FilesRepository,
  SignedUploadTarget,
  UploadStorageObjectPayload
} from "../src/modules/files/files.repository";
import type { FileRecord } from "../src/shared/types/domain";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const NOT_IMAGE_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

class FakeFilesRepository implements FilesRepository {
  files = new Map<string, FileRecord>();
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];

  constructor(private readonly storedBytes: Uint8Array = PNG_BYTES) {}

  async createFile(payload: CreateFilePayload): Promise<FileRecord> {
    const record: FileRecord = {
      id: `file-${this.files.size + 1}`,
      user_id: payload.user_id,
      file_type: payload.file_type,
      storage_bucket: payload.storage_bucket,
      storage_path: payload.storage_path,
      original_filename: payload.original_filename,
      mime_type: payload.mime_type,
      size_bytes: payload.size_bytes,
      checksum: payload.checksum,
      is_deleted: false,
      created_at: new Date().toISOString()
    };
    this.files.set(record.id, record);
    return record;
  }

  async findById(userId: string, fileId: string): Promise<FileRecord | null> {
    const file = this.files.get(fileId);
    if (!file || file.user_id !== userId || file.is_deleted) {
      return null;
    }
    return file;
  }

  async softDeleteById(userId: string, fileId: string): Promise<boolean> {
    const file = this.files.get(fileId);
    if (!file || file.user_id !== userId) {
      return false;
    }
    file.is_deleted = true;
    return true;
  }

  async uploadStorageObject(_payload: UploadStorageObjectPayload): Promise<void> {}

  async deleteStorageObject(_bucket: string, storagePath: string): Promise<void> {
    this.deleted.push(storagePath);
  }

  async createSignedUploadUrl(_bucket: string, storagePath: string): Promise<SignedUploadTarget> {
    return { storage_path: storagePath, token: "upload-token" };
  }

  async downloadStorageObject(_bucket: string, _storagePath: string): Promise<Uint8Array> {
    return this.storedBytes;
  }

  async createSignedDownloadUrl(_bucket: string, storagePath: string): Promise<string> {
    return `https://signed.example/${storagePath}`;
  }
}

const createService = (repo: FilesRepository) =>
  new CvPhotosService(repo, {
    storageBucket: "cv-assets",
    photoMaxBytes: 5_242_880,
    photoUrlTtlSeconds: 3600
  });

describe("CvPhotosService", () => {
  it("detects managed references vs legacy data URIs / URLs", () => {
    expect(CvPhotosService.isManagedReference("file-123")).toBe(true);
    expect(CvPhotosService.isManagedReference("data:image/png;base64,AAAA")).toBe(false);
    expect(CvPhotosService.isManagedReference("https://x/y.png")).toBe(false);
    expect(CvPhotosService.isManagedReference("")).toBe(false);
    expect(CvPhotosService.isManagedReference(null)).toBe(false);
  });

  it("rejects unsupported content types and oversized images when creating an upload target", async () => {
    const service = createService(new FakeFilesRepository());
    await expect(
      service.createUploadTarget("user-1", { contentType: "image/webp", sizeBytes: 1000 })
    ).rejects.toThrow(/Unsupported image type/);
    await expect(
      service.createUploadTarget("user-1", { contentType: "image/png", sizeBytes: 10_000_000 })
    ).rejects.toThrow(/maximum allowed size/);
  });

  it("creates a scoped upload target for a valid image", async () => {
    const service = createService(new FakeFilesRepository());
    const target = await service.createUploadTarget("user-1", {
      contentType: "image/png",
      sizeBytes: 2048
    });
    expect(target.storage_bucket).toBe("cv-assets");
    expect(target.storage_path).toMatch(/^users\/user-1\/avatars\/[0-9a-f-]+\.png$/);
    expect(target.token).toBe("upload-token");
  });

  it("rejects completion when the storage path does not match the file id / user", async () => {
    const service = createService(new FakeFilesRepository());
    await expect(
      service.completeUpload("user-1", "abc", { storagePath: "users/user-2/avatars/abc.png" })
    ).rejects.toThrow(/Storage path does not match/);
  });

  it("rejects completion when the stored object is not a real PNG/JPEG", async () => {
    const repo = new FakeFilesRepository(NOT_IMAGE_BYTES);
    const service = createService(repo);
    await expect(
      service.completeUpload("user-1", "abc", { storagePath: "users/user-1/avatars/abc.png" })
    ).rejects.toThrow(/not a valid PNG or JPEG/);
    expect(repo.deleted).toContain("users/user-1/avatars/abc.png");
  });

  it("persists a files row and returns a signed URL on successful completion", async () => {
    const repo = new FakeFilesRepository(PNG_BYTES);
    const service = createService(repo);
    const access = await service.completeUpload("user-1", "abc", {
      storagePath: "users/user-1/avatars/abc.png"
    });
    expect(access.file_id).toBe("file-1");
    expect(access.signed_url).toContain("users/user-1/avatars/abc.png");
    const stored = repo.files.get("file-1");
    expect(stored?.file_type).toBe("avatar");
    expect(stored?.mime_type).toBe("image/png");
  });

  it("resolves references to signed URLs and data URIs, with legacy passthrough", async () => {
    const repo = new FakeFilesRepository(PNG_BYTES);
    const service = createService(repo);
    const file = await repo.createFile({
      user_id: "user-1",
      file_type: "avatar",
      storage_bucket: "cv-assets",
      storage_path: "users/user-1/avatars/x.png",
      original_filename: "profile-photo.png",
      mime_type: "image/png",
      size_bytes: PNG_BYTES.byteLength,
      checksum: null
    });

    // managed reference -> signed url / data uri
    await expect(service.resolveSignedUrl("user-1", file.id)).resolves.toContain("https://signed.example/");
    await expect(service.resolveDataUri("user-1", file.id)).resolves.toMatch(/^data:image\/png;base64,/);

    // legacy data uri passthrough
    const legacy = "data:image/jpeg;base64,AAAA";
    await expect(service.resolveSignedUrl("user-1", legacy)).resolves.toBe(legacy);
    await expect(service.resolveDataUri("user-1", legacy)).resolves.toBe(legacy);

    // unknown / not owned -> null
    await expect(service.resolveSignedUrl("user-1", "missing")).resolves.toBeNull();
    await expect(service.resolveDataUri("user-2", file.id)).resolves.toBeNull();
  });

  it("removes the storage object and soft-deletes the files row", async () => {
    const repo = new FakeFilesRepository(PNG_BYTES);
    const service = createService(repo);
    const file = await repo.createFile({
      user_id: "user-1",
      file_type: "avatar",
      storage_bucket: "cv-assets",
      storage_path: "users/user-1/avatars/x.png",
      original_filename: "profile-photo.png",
      mime_type: "image/png",
      size_bytes: PNG_BYTES.byteLength,
      checksum: null
    });

    await service.remove("user-1", file.id);
    expect(repo.deleted).toContain("users/user-1/avatars/x.png");
    expect(repo.files.get(file.id)?.is_deleted).toBe(true);
  });
});
