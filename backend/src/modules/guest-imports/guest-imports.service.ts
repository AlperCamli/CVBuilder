import type { PrivacyService } from "../privacy/privacy.service";
import { assertProviderEnabled, NOTICE_VERSION, privacyConfig } from "../privacy/privacy.config";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { GuestImportsRepository } from "./guest-imports.repository";
import {
  guestAnswersSchema,
  guestCreateSchema,
  type GuestAnswers,
} from "./guest-imports.schemas";
import type { ImportsRepository } from "../imports/imports.repository";
import type { ImportsService } from "../imports/imports.service";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors/app-error";

export const hashGuestToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class GuestImportsService {
  constructor(
    private readonly repository: GuestImportsRepository,
    private readonly storage: ImportsRepository,
    private readonly parser: Pick<ImportsService, "parseGuestFile">,
    private readonly privacy?: PrivacyService,
  ) {}
  async create(input: unknown) {
    const parsed = guestCreateSchema.safeParse(input);
    if (!parsed.success)
      throw new ValidationError(
        "Choose a non-empty PDF or DOCX smaller than 20 MB.",
      );
    await this.privacy?.assertCollection();
    if (this.privacy && parsed.data.notice_version !== NOTICE_VERSION) throw new ValidationError("Please reload to review the current privacy notice.");
    if (this.privacy && privacyConfig().ai_required) {
      if (!parsed.data.ai_processing) throw new ValidationError("JobSpecificCV uses AI to analyze your CV. Enable AI processing before uploading; you can change this choice at any time.");
      assertProviderEnabled();
    }
    if (parsed.data.ai_processing && !privacyConfig().ai_enabled) throw new ValidationError("External AI is currently unavailable.");
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const path = `guests/${id}/source.${parsed.data.mime_type === "application/pdf" ? "pdf" : "docx"}`;
    const target = await this.storage.createSignedUploadUrl("imports", path);
    const guest = await this.repository.create({
      ...parsed.data,
      ai_processing: false, analytics: false,
      id,
      token_hash: hashGuestToken(token),
      storage_path: path,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    if (this.privacy) await this.privacy.record(null, id, { notice_version: NOTICE_VERSION, ai_processing: parsed.data.ai_processing, analytics: parsed.data.analytics });
    return {
      id,
      guest_token: token,
      expires_at: guest.expires_at,
      upload: {
        storage_bucket: "imports",
        storage_path: path,
        token: target.token,
      },
    };
  }
  private async authorize(id: string, token: string, userId?: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundError(
        "Upload not found or expired. Please upload your CV again.",
      );
    const row = await this.repository.find(id);
    const digest = hashGuestToken(token);
    if (
      !row || row.deleted_at ||
      row.token_hash.length !== digest.length ||
      !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(digest)) ||
      Date.parse(row.expires_at) <= Date.now() ||
      (row.claimed_user_id && row.claimed_user_id !== userId)
    ) {
      throw new NotFoundError(
        "Upload not found or expired. Please upload your CV again.",
      );
    }
    await this.privacy?.assertGuestAvailable(id);
    return row;
  }
  async status(id: string, token: string) {
    const row = await this.authorize(id, token);
    const exhausted =
      row.status === "parsing" &&
      row.attempts >= 3 &&
      Date.parse(row.lease_expires_at ?? "") <= Date.now();
    return {
      answers: row.answers,
      original_filename: row.original_filename,
      ai_processing: Boolean(row.ai_processing && row.ai_notice_version === NOTICE_VERSION && row.ai_provider === privacyConfig().ai_provider_key),
      analytics: row.analytics ?? false,
      status: exhausted ? "failed" : row.status,
      error_message: exhausted
        ? "Analysis was interrupted. Please upload your CV again."
        : row.error_message,
      retry_available: row.attempts < 3,
      can_resume:
        row.status !== "parsing" ||
        Date.parse(row.lease_expires_at ?? "") <= Date.now(),
    };
  }
  async saveAnswers(id: string, token: string, input: unknown) {
    await this.authorize(id, token);
    const parsed = guestAnswersSchema.safeParse(input);
    if (!parsed.success)
      throw new ValidationError("Please choose one of the available answers.");
    await this.repository.saveAnswers(id, parsed.data);
    return { saved: true };
  }
  async process(id: string, token: string) {
    const row = await this.authorize(id, token);
    if (row.processing_restricted_at) throw new ConflictError("Processing of this upload is restricted. Contact the privacy address in the privacy notice.");
    if (this.privacy && privacyConfig().ai_required) {
      if (!row.ai_processing || row.ai_notice_version !== NOTICE_VERSION || row.ai_provider !== privacyConfig().ai_provider_key) throw new ConflictError("Enable AI processing for this upload to resume analysis.");
      assertProviderEnabled();
    }
    if (row.status === "parsed") return this.status(id, token);
    if (row.attempts >= 3)
      throw new ConflictError(
        "We couldn't read this file. Please choose another CV.",
      );
    const leaseId = randomUUID();
    const acquired = await this.repository.acquireLease(
      id,
      leaseId,
      new Date().toISOString(),
      new Date(Date.now() + 300_000).toISOString(),
    );
    if (!acquired) return this.status(id, token);
    // Keep the request open until results are durable. No detached work that a
    // serverless host can terminate. Stale leases can resume after auth/refresh.
    try {
      const bytes = await this.storage.downloadStorageObject(
        "imports",
        row.storage_path,
      );
      if (bytes.length !== row.size_bytes || bytes.length > 20 * 1024 * 1024)
        throw new ValidationError("Upload size did not match");
      const validMagic =
        row.mime_type === "application/pdf"
          ? Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))
          : bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (!validMagic) throw new ValidationError("Unsupported file content");
      const result = await this.parser.parseGuestFile({
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: bytes.length,
        bytes,
      }, Boolean(row.ai_processing && row.ai_notice_version === NOTICE_VERSION && row.ai_provider === privacyConfig().ai_provider_key && privacyConfig().ai_enabled), async () => {
        const current = await this.authorize(id, token);
        if (current.lease_id !== leaseId || Date.parse(current.lease_expires_at ?? "") <= Date.now() || current.processing_restricted_at || !current.ai_processing || current.ai_notice_version !== NOTICE_VERSION || current.privacy_revision !== row.privacy_revision || current.ai_provider !== privacyConfig().ai_provider_key || !privacyConfig().ai_enabled) {
          throw new ConflictError("AI permission changed during processing.");
        }
      }, { guest_import_id: id, guest_lease_id: leaseId });
      await this.repository.finish(id, leaseId, result, row.privacy_revision ?? 0);
    } catch {
      await this.repository.finish(id, leaseId, null, row.privacy_revision ?? 0);
    }
    return this.status(id, token);
  }
  async claim(id: string, token: string, userId: string) {
    const row = await this.authorize(id, token, userId);
    if (this.privacy && privacyConfig().ai_required && !row.claimed_user_id) {
      if (!row.ai_processing || row.ai_notice_version !== NOTICE_VERSION || row.ai_provider !== privacyConfig().ai_provider_key) throw new ConflictError("Enable AI processing for this upload before continuing.");
      assertProviderEnabled();
    }
    const importId = await this.repository.claim(
      id,
      hashGuestToken(token),
      userId,
    );
    return {
      import_id: importId,
      original_filename: row.original_filename,
      answers: row.answers as GuestAnswers,
    };
  }
  async updatePrivacy(id: string, token: string, input: { notice_version: string; ai_processing: boolean; analytics: boolean }) {
    await this.authorize(id, token);
    if (!this.privacy) throw new ConflictError("Privacy preferences are unavailable.");
    await this.privacy.record(null, id, input);
    return this.status(id, token);
  }
  async delete(id: string, token: string) {
    if (!this.privacy || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundError();
    // Deletion remains available after access expiry, and is idempotent while the tombstone exists.
    return this.privacy.deleteGuest(id, hashGuestToken(token));
  }
  cleanup() {
    return this.privacy ? this.privacy.cleanup() : this.repository.cleanup();
  }
}
