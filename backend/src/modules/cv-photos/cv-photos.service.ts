import { createHash, randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "../../shared/errors/app-error";
import type { FilesRepository } from "../files/files.repository";

// Only PNG and JPEG are accepted: the PDF/DOCX export embedders only support those formats
// (see rendering-document.mapper.ts `isDataUriImage`). Normalizing other formats (e.g. webp)
// would require a server-side image library and is intentionally left as a follow-up.
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

const EXT_BY_MIME: Record<string, "png" | "jpg"> = {
  "image/png": "png",
  "image/jpeg": "jpg"
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const matchesSignature = (bytes: Uint8Array, signature: number[]): boolean => {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((value, index) => bytes[index] === value);
};

const sniffImageMime = (bytes: Uint8Array): "image/png" | "image/jpeg" | null => {
  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (matchesSignature(bytes, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  return null;
};

export interface CvPhotosServiceOptions {
  storageBucket: string;
  photoMaxBytes: number;
  photoUrlTtlSeconds: number;
}

export interface CvPhotoUploadTarget {
  file_id: string;
  storage_bucket: string;
  storage_path: string;
  token: string;
  mime_type: string;
}

export interface CvPhotoAccess {
  file_id: string;
  signed_url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export class CvPhotosService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly options: CvPhotosServiceOptions
  ) {}

  // A stored photo reference is "managed" (a files.id) when it is neither a legacy inline
  // data URI nor an absolute URL. Rendering/export use this to decide whether to resolve it.
  static isManagedReference(value: string | null | undefined): value is string {
    if (!value) {
      return false;
    }
    if (value.startsWith("data:")) {
      return false;
    }
    if (/^https?:\/\//i.test(value)) {
      return false;
    }
    return true;
  }

  private avatarStoragePath(userId: string, fileId: string, ext: "png" | "jpg"): string {
    return `users/${userId}/avatars/${fileId}.${ext}`;
  }

  // Step 1: issue a signed URL for a direct-to-storage upload (mirrors the import flow,
  // avoiding large image bodies through the JSON API).
  async createUploadTarget(
    userId: string,
    input: { contentType: string; sizeBytes: number }
  ): Promise<CvPhotoUploadTarget> {
    const mimeType = input.contentType.toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ValidationError("Unsupported image type. Use PNG or JPEG.", {
        content_type: input.contentType
      });
    }
    if (input.sizeBytes <= 0 || input.sizeBytes > this.options.photoMaxBytes) {
      throw new ValidationError("Image exceeds the maximum allowed size.", {
        size_bytes: input.sizeBytes,
        max_bytes: this.options.photoMaxBytes
      });
    }

    const fileId = randomUUID();
    const ext = EXT_BY_MIME[mimeType];
    const storagePath = this.avatarStoragePath(userId, fileId, ext);
    const target = await this.filesRepository.createSignedUploadUrl(this.options.storageBucket, storagePath);

    return {
      file_id: fileId,
      storage_bucket: this.options.storageBucket,
      storage_path: target.storage_path,
      token: target.token,
      mime_type: mimeType
    };
  }

  // Step 2: after the client uploads to the signed URL, validate the stored object
  // (ownership, size, real PNG/JPEG magic bytes) and persist its `files` row.
  async completeUpload(
    userId: string,
    fileId: string,
    input: { storagePath: string }
  ): Promise<CvPhotoAccess> {
    const expectedPrefix = `users/${userId}/avatars/${fileId}.`;
    if (!input.storagePath.startsWith(expectedPrefix)) {
      throw new ValidationError("Storage path does not match the requested photo.", {
        file_id: fileId
      });
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.filesRepository.downloadStorageObject(this.options.storageBucket, input.storagePath);
    } catch {
      throw new ValidationError("Uploaded photo could not be read from storage.", { file_id: fileId });
    }

    if (bytes.byteLength === 0 || bytes.byteLength > this.options.photoMaxBytes) {
      await this.bestEffortDeleteObject(this.options.storageBucket, input.storagePath);
      throw new ValidationError("Image exceeds the maximum allowed size.", {
        size_bytes: bytes.byteLength,
        max_bytes: this.options.photoMaxBytes
      });
    }

    const sniffedMime = sniffImageMime(bytes);
    if (!sniffedMime) {
      await this.bestEffortDeleteObject(this.options.storageBucket, input.storagePath);
      throw new ValidationError("Uploaded file is not a valid PNG or JPEG image.", { file_id: fileId });
    }

    const ext = EXT_BY_MIME[sniffedMime];
    const file = await this.filesRepository.createFile({
      user_id: userId,
      file_type: "avatar",
      storage_bucket: this.options.storageBucket,
      storage_path: input.storagePath,
      original_filename: `profile-photo.${ext}`,
      mime_type: sniffedMime,
      size_bytes: bytes.byteLength,
      checksum: createHash("sha256").update(bytes).digest("hex")
    });

    return this.createSignedAccess(file.id, file.storage_bucket, file.storage_path);
  }

  async getSignedUrl(userId: string, fileId: string): Promise<CvPhotoAccess> {
    const file = await this.filesRepository.findById(userId, fileId);
    if (!file) {
      throw new NotFoundError("Photo was not found", { file_id: fileId });
    }
    return this.createSignedAccess(file.id, file.storage_bucket, file.storage_path);
  }

  async remove(userId: string, fileId: string): Promise<void> {
    const file = await this.filesRepository.findById(userId, fileId);
    if (!file) {
      return;
    }
    await this.bestEffortDeleteObject(file.storage_bucket, file.storage_path);
    try {
      await this.filesRepository.softDeleteById(userId, fileId);
    } catch {
      // best-effort cleanup
    }
  }

  // Resolve a stored reference to a signed URL for preview/editor display. Legacy inline
  // data URIs and absolute URLs pass through unchanged; unresolvable references become null.
  async resolveSignedUrl(userId: string, reference: string | null): Promise<string | null> {
    if (!reference) {
      return null;
    }
    if (!CvPhotosService.isManagedReference(reference)) {
      return reference;
    }
    const file = await this.filesRepository.findById(userId, reference);
    if (!file) {
      return null;
    }
    try {
      return await this.filesRepository.createSignedDownloadUrl(
        file.storage_bucket,
        file.storage_path,
        this.options.photoUrlTtlSeconds
      );
    } catch {
      return null;
    }
  }

  // Resolve a stored reference to a base64 data URI for PDF/DOCX embedding. Legacy inline
  // data URIs pass through unchanged; unresolvable references become null (photo omitted).
  async resolveDataUri(userId: string, reference: string | null): Promise<string | null> {
    if (!reference) {
      return null;
    }
    if (reference.startsWith("data:")) {
      return reference;
    }
    if (!CvPhotosService.isManagedReference(reference)) {
      return null;
    }
    const file = await this.filesRepository.findById(userId, reference);
    if (!file) {
      return null;
    }
    try {
      const bytes = await this.filesRepository.downloadStorageObject(file.storage_bucket, file.storage_path);
      const base64 = Buffer.from(bytes).toString("base64");
      return `data:${file.mime_type};base64,${base64}`;
    } catch {
      return null;
    }
  }

  private async createSignedAccess(
    fileId: string,
    bucket: string,
    storagePath: string
  ): Promise<CvPhotoAccess> {
    const ttl = this.options.photoUrlTtlSeconds;
    const signedUrl = await this.filesRepository.createSignedDownloadUrl(bucket, storagePath, ttl);
    return {
      file_id: fileId,
      signed_url: signedUrl,
      expires_in_seconds: ttl,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString()
    };
  }

  private async bestEffortDeleteObject(bucket: string, storagePath: string): Promise<void> {
    try {
      await this.filesRepository.deleteStorageObject(bucket, storagePath);
    } catch {
      // best-effort cleanup
    }
  }
}
