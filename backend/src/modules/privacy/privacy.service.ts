import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { withRequestDeadline } from "../../shared/utils/request-deadline";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { StripeGateway } from "../billing/stripe-gateway";
import { AppError, ForbiddenError, InternalServerError, NotFoundError, ValidationError } from "../../shared/errors/app-error";
import { assertCollectionEnabled, assertProviderEnabled, NOTICE_VERSION, privacyConfig, type PrivacyPreferences } from "./privacy.config";

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const OWNED_TABLES = ["users", "master_cvs", "tailored_cvs", "jobs", "job_status_history", "cover_letters", "cover_letter_exports", "exports", "imports", "files", "ai_runs", "ai_suggestions", "cv_block_revisions", "subscriptions", "usage_counters", "privacy_receipts"];
class MaintenanceYield extends Error {}
const withinBudget = (deadline: number) => { if (Date.now() >= deadline - 500) throw new MaintenanceYield(); };
type StoredObject = { bucket: string; path: string };
type Job = { id: string; subject_user_id: string; auth_user_id: string | null; kind: "deletion" | "export"; status: string; step: string; manifest: Record<string, unknown>; storage_path: string | null; expires_at: string | null; attempts: number };
function check(error: { message?: string } | null) {
  if (error) throw new InternalServerError("Privacy operation could not be completed. Please try again.");
}

export class PrivacyService {
  constructor(private readonly db: SupabaseClient, private readonly stripe: StripeGateway | null, private readonly logger: Pick<Logger, "error">) {}

  config() { return privacyConfig(); }
  async assertGuestAvailable(guestId: string) {
    const { data, error } = await this.db.from("privacy_guest_erasure_ledger").select("guest_id").eq("guest_id", guestId).maybeSingle();
    check(error); if (data) throw new NotFoundError("This upload was deleted.");
  }
  async assertIdentityAvailable(authId: string) {
    const { data, error } = await this.db.from("privacy_erasure_ledger").select("auth_id_hash").eq("auth_id_hash", hash(authId)).maybeSingle();
    check(error);
    if (data) throw new ForbiddenError("Account deletion has been requested. This account cannot be used.");
  }
  async preferences(userId: string): Promise<PrivacyPreferences> {
    const { data, error } = await this.db.from("users").select("ai_processing,ai_provider,ai_notice_version,analytics,privacy_revision,deletion_requested_at").eq("id", userId).maybeSingle();
    check(error);
    if (!data || data.deletion_requested_at) throw new ForbiddenError("This account is unavailable.");
    const config = privacyConfig();
    return { ai_processing: data.ai_processing && data.ai_provider === config.ai_provider_key && data.ai_notice_version === NOTICE_VERSION, analytics: data.analytics, privacy_revision: data.privacy_revision };
  }
  async aiPermission(userId: string) { return privacyConfig().ai_enabled && (await this.preferences(userId)).ai_processing; }
  async assertProcessingAvailable(userId: string) {
    const { data, error } = await this.db.from("users").select("processing_restricted_at,deletion_requested_at").eq("id", userId).maybeSingle();
    check(error);
    if (!data || data.deletion_requested_at || data.processing_restricted_at) throw new ForbiddenError("Processing is restricted for this account. You can request a data download or deletion, or contact the privacy address.");
  }
  async assertAi(userId: string) {
    assertProviderEnabled();
    await this.assertProcessingAvailable(userId);
    const preferences = await this.preferences(userId);
    if (!preferences.ai_processing) throw new ForbiddenError("Enable AI processing in Profile → Privacy before using this feature.");
    return preferences.privacy_revision;
  }
  async assertProductAccess(userId: string) {
    await this.assertProcessingAvailable(userId);
    if (privacyConfig().ai_required) await this.assertAi(userId);
  }
  async assertAiUnchanged(userId: string, revision: number) {
    const current = await this.assertAi(userId);
    if (current !== revision) throw new ForbiddenError("Privacy choices changed during processing. This result was discarded.");
  }
  async record(userId: string | null, guestId: string | null, input: { notice_version: string; ai_processing?: boolean; analytics: boolean }) {
    if (input.notice_version !== NOTICE_VERSION) throw new ValidationError("Please reload to review the current privacy notice.");
    if (input.ai_processing === undefined) {
      if (input.analytics && !privacyConfig().analytics_enabled) throw new ForbiddenError("Analytics is currently unavailable.");
      check((await this.db.rpc("record_analytics_choice", {p_user: userId, p_guest: guestId, p_version: input.notice_version, p_analytics: input.analytics})).error);
      return;
    }
    if (input.ai_processing && userId) await this.assertProcessingAvailable(userId);
    if (input.ai_processing && guestId) {
      const guest = await this.db.from("guest_imports").select("processing_restricted_at").eq("id", guestId).maybeSingle();
      check(guest.error);
      if (guest.data?.processing_restricted_at) throw new ForbiddenError("Processing of this upload is restricted.");
    }
    if (input.ai_processing && !privacyConfig().ai_enabled) {
      // Analytics changes may preserve an existing AI choice while an operator
      // has paused the provider. They must not silently withdraw an independent
      // choice or authorize a new provider/version without its review.
      const current = await this.db.from(userId ? "users" : "guest_imports").select("ai_processing,ai_provider,ai_notice_version").eq("id", userId ?? guestId).maybeSingle();
      check(current.error);
      if (!current.data?.ai_processing || current.data.ai_provider !== privacyConfig().ai_provider_key || current.data.ai_notice_version !== NOTICE_VERSION) assertProviderEnabled();
    }
    const { error } = await this.db.rpc("record_privacy_choices", { p_user: userId, p_guest: guestId, p_version: input.notice_version, p_ai: input.ai_processing, p_analytics: input.analytics, p_provider: input.ai_processing ? privacyConfig().ai_provider_key : null });
    check(error);
  }
  async health() {
    const { data, error } = await this.db.from("privacy_cleanup_health").select("*").eq("id", true).single();
    check(error);
    const overdue = Date.now() - Date.parse(data.last_success_at ?? data.initialized_at) > 30 * 3_600_000;
    if (overdue) this.logger.error({ code: "PRIVACY_CLEANUP_OVERDUE" }, "Daily privacy cleanup is overdue");
    return { overdue, backlog: data.backlog, failures: data.failures, oldest_expired_at: data.oldest_expired_at, last_success_at: data.last_success_at };
  }
  async assertCollection(checkCleanup = true) {
    assertCollectionEnabled();
    if (checkCleanup && (await this.health()).overdue) throw new AppError({ statusCode: 503, code: "PRIVACY_UNAVAILABLE", message: "New uploads are paused while temporary data cleanup is restored. Please try again later." });
  }
  async deleteGuest(id: string, tokenHash: string) {
    const { error } = await this.db.rpc("delete_guest_import", { p_id: id, p_token_hash: tokenHash });
    if (error?.message.includes("guest_claimed")) throw new ForbiddenError("This upload belongs to an account. Delete it from your account.");
    if (error?.message.includes("guest_not_found")) throw new NotFoundError();
    check(error);
    // Tombstone is durable before best-effort physical deletion. Outstanding
    // signed upload URLs last two hours, so metadata stays until a final sweep.
    const { data, error: readError } = await this.db.from("guest_imports").select("storage_path").eq("id", id).single();
    check(readError);
    const removed = await this.db.storage.from("imports").remove([data!.storage_path]);
    return { status: "deletion_requested", storage_removed: !removed.error };
  }
  async updateAnswers(userId: string, answers: Record<string, string>) {
    await this.preferences(userId);
    const { source: _referral, ...guidance } = answers;
    const { error } = await this.db.from("users").update({ onboarding_answers: guidance }).eq("id", userId).is("deletion_requested_at", null);
    check(error);
    // Remove duplicate claim metadata; source bytes and account CVs are preserved.
    const { error: guestError } = await this.db.from("guest_imports").update({ answers: {} }).eq("claimed_user_id", userId);
    check(guestError);
    return { answers: guidance };
  }
  async requestDeletion(userId: string, authId: string, jwt: string) {
    const { data, error } = await this.db.rpc("request_account_erasure", { p_user: userId, p_auth: authId });
    check(error);
    // Access is already blocked in DB and API, including existing JWTs.
    const result = await this.db.auth.admin.signOut(jwt, "global");
    if (result.error) this.logger.error({ code: "PRIVACY_SESSION_REVOCATION_PENDING" }, "Session revocation will be retried by account removal");
    const jobId = String(data);
    await this.attemptJob(jobId);
    return { job_id: jobId, status: "deletion_requested" };
  }
  async requestExport(userId: string) {
    await this.preferences(userId);
    const existing = await this.db.from("privacy_jobs").select("id").eq("user_id", userId).eq("kind", "export").gt("expires_at", iso()).order("created_at", { ascending: false }).limit(1);
    check(existing.error);
    if (existing.data?.length) { await this.attemptJob(existing.data[0].id); return this.exportStatus(userId, existing.data[0].id); }
    const { data, error } = await this.db.from("privacy_jobs").insert({ user_id: userId, subject_user_id: userId, kind: "export", expires_at: iso(Date.now() + 86_400_000) }).select("id").single();
    check(error);
    await this.attemptJob(data!.id);
    return this.exportStatus(userId, data!.id);
  }
  async exportStatus(userId: string, jobId: string) {
    await this.preferences(userId);
    const { data, error } = await this.db.from("privacy_jobs").select("id,status,expires_at").eq("id", jobId).eq("user_id", userId).eq("kind", "export").maybeSingle();
    check(error);
    if (!data || Date.parse(data.expires_at) <= Date.now()) throw new NotFoundError("This data export has expired.");
    return data;
  }
  async exportDownload(userId: string, jobId: string) {
    const status = await this.exportStatus(userId, jobId);
    if (status.status !== "complete") throw new ValidationError("Your export is still being prepared.");
    const { data, error } = await this.db.from("privacy_jobs").select("storage_path").eq("id", jobId).eq("user_id", userId).single();
    check(error);
    const remaining = Math.floor((Date.parse(status.expires_at) - Date.now()) / 1000);
    if (remaining <= 0) throw new NotFoundError();
    const signed = await this.db.storage.from("exports").createSignedUrl(data!.storage_path, Math.min(300, remaining), { download: "cv-builder-data.zip" });
    check(signed.error);
    return { url: signed.data!.signedUrl, expires_at: iso(Date.now() + Math.min(300, remaining) * 1000) };
  }
  private async rows(table: string, userId: string, deadline = Infinity): Promise<Record<string, any>[]> {
    const result: Record<string, any>[] = [];
    // Supabase's default row cap must not silently truncate an export/deletion.
    for (let offset = 0; ; offset += 500) {
      withinBudget(deadline);
      let query = this.db.from(table).select("*");
      if (table === "users") query = query.eq("id", userId);
      else if (table === "job_status_history") {
        const jobs = await this.rows("jobs", userId);
        if (!jobs.length) return [];
        query = query.in("job_id", jobs.map(job => job.id));
      } else query = query.eq("user_id", userId);
      const { data, error } = await query.order("id").range(offset, offset + 499);
      check(error); result.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
    return result;
  }
  private async attemptJob(jobId: string, deadline = Date.now() + 20_000): Promise<boolean> {
    withinBudget(deadline);
    const lease = await this.db.rpc("acquire_privacy_job", { p_id: jobId });
    check(lease.error); if (!lease.data) return true;
    const loaded = await this.db.from("privacy_jobs").select("*").eq("id", jobId).single();
    check(loaded.error); const job = loaded.data as Job;
    try {
      if (job.kind === "deletion") await this.erase(job, deadline);
      else await this.buildExport(job, deadline);
      return true;
    } catch (error) {
      check((await this.db.from("privacy_jobs").update({ status: "pending", lease_until: null, retry_at: iso(Date.now() + (error instanceof MaintenanceYield ? 1000 : Math.min(86_400_000, 60_000 * 2 ** Math.min(job.attempts, 10)))) }).eq("id", jobId)).error);
      if (!(error instanceof MaintenanceYield)) this.logger.error({ code: "PRIVACY_JOB_RETRY", kind: job.kind }, "Privacy job remains pending and will be retried");
      return error instanceof MaintenanceYield;
    }
  }
  private async checkpoint(job: Job, step: string, manifest = job.manifest) {
    check((await this.db.from("privacy_jobs").update({ step, manifest }).eq("id", job.id)).error);
    job.step = step; job.manifest = manifest;
  }
  private async inventory(userId: string, offset = 0): Promise<StoredObject[]> {
    const { data, error } = await this.db.rpc("privacy_storage_inventory", { p_user: userId, p_offset: offset, p_limit: 500 });
    check(error); return data ?? [];
  }
  private async removeObjects(files: StoredObject[], deadline: number) {
    const buckets = [...new Set(files.map(file => file.bucket))];
    for (const bucket of buckets) {
      withinBudget(deadline);
      check((await this.db.storage.from(bucket).remove(files.filter(file => file.bucket === bucket).map(file => file.path))).error);
    }
  }
  private async erase(job: Job, deadline: number) {
    const userId = job.subject_user_id;
    if (job.step === "start") {
      const subscriptions = await this.rows("subscriptions", userId, deadline);
      await this.checkpoint(job, "inventory", { ...job.manifest, files: [], inventory_offset: 0, customers: [...new Set(subscriptions.map(row => row.provider_customer_id).filter(Boolean))], upload_guard_until: iso(Date.now() + 2 * 3_600_000 + 300_000) });
    }
    if (job.step === "inventory") {
      while (job.step === "inventory") {
        withinBudget(deadline);
        const offset = Number(job.manifest.inventory_offset ?? 0);
        const files = await this.inventory(userId, offset);
        await this.checkpoint(job, files.length < 500 ? "billing" : "inventory", { ...job.manifest, files: [...(job.manifest.files as StoredObject[]), ...files], inventory_offset: offset + files.length });
      }
    }
    if (job.step === "billing") {
      const customers = job.manifest.customers as string[];
      if (customers.length && !this.stripe?.cancelCustomerSubscriptions) throw new InternalServerError("Billing cancellation is not available.");
      for (let index = Number(job.manifest.billing_cursor ?? 0); index < customers.length; index++) {
        withinBudget(deadline); await this.stripe!.cancelCustomerSubscriptions!(customers[index], deadline);
        await this.checkpoint(job, "billing", { ...job.manifest, billing_cursor: index + 1 });
      }
      await this.checkpoint(job, "storage");
    }
    if (job.step === "storage") {
      const files = job.manifest.files as StoredObject[];
      for (let index = Number(job.manifest.storage_cursor ?? 0); index < files.length; index += 50) {
        await this.removeObjects(files.slice(index, index + 50), deadline);
        await this.checkpoint(job, "storage", { ...job.manifest, storage_cursor: index + 50 });
      }
      await this.checkpoint(job, "database");
    }
    if (job.step === "database") {
      withinBudget(deadline);
      check((await this.db.from("job_status_history").delete().eq("changed_by_user_id", userId)).error);
      const tables = ["cover_letter_exports", "exports", "imports", "cv_block_revisions", "ai_suggestions", "ai_runs", "cover_letters", "tailored_cvs", "jobs", "master_cvs", "files", "usage_counters", "subscriptions"];
      for (let index = Number(job.manifest.database_cursor ?? 0); index < tables.length; index++) {
        withinBudget(deadline);
        check((await this.db.from(tables[index]).delete().eq("user_id", userId)).error);
        await this.checkpoint(job, "database", { ...job.manifest, database_cursor: index + 1 });
      }
      withinBudget(deadline);
      check((await this.db.from("guest_imports").delete().eq("claimed_user_id", userId)).error);
      check((await this.db.from("privacy_jobs").delete().eq("subject_user_id", userId).eq("kind", "export")).error);
      const retention = new Date(); retention.setUTCFullYear(retention.getUTCFullYear() + 1);
      check((await this.db.from("privacy_receipts").update({ retain_until: retention.toISOString() }).eq("user_id", userId)).error);
      check((await this.db.from("users").delete().eq("id", userId)).error);
      await this.checkpoint(job, "auth");
    }
    if (job.step === "auth") {
      withinBudget(deadline);
      const result = await this.db.auth.admin.deleteUser(job.auth_user_id!);
      if (result.error && !["user_not_found", "not_found"].includes(result.error.code ?? "")) check(result.error);
      await this.checkpoint(job, "upload_guard");
    }
    if (job.step === "upload_guard") {
      if (Date.parse(String(job.manifest.upload_guard_until)) > Date.now()) {
        check((await this.db.from("privacy_jobs").update({ status: "pending", lease_until: null, retry_at: job.manifest.upload_guard_until }).eq("id", job.id)).error);
        return;
      }
      const files = job.manifest.files as StoredObject[];
      for (let index = Number(job.manifest.guard_cursor ?? 0); index < files.length; index += 50) {
        await this.removeObjects(files.slice(index, index + 50), deadline);
        await this.checkpoint(job, "upload_guard", { ...job.manifest, guard_cursor: index + 50 });
      }
      // Re-inventory owned prefixes after upload URLs have expired. Database
      // rows are gone now; repeatedly removing page zero also catches orphans.
      while (true) {
        withinBudget(deadline);
        const remaining = await this.inventory(userId);
        if (!remaining.length) break;
        await this.removeObjects(remaining, deadline);
      }
      check((await this.db.from("privacy_erasure_ledger").update({ retain_until: iso(Date.now() + 90 * 86_400_000) }).eq("user_id", userId)).error);
      check((await this.db.from("privacy_jobs").update({ status: "complete", completed_at: iso(), lease_until: null, manifest: {}, auth_user_id: null, expires_at: iso(Date.now() + 90 * 86_400_000) }).eq("id", job.id)).error);
    }
  }
  private async buildExport(job: Job, deadline: number) {
    await this.preferences(job.subject_user_id);
    const zip = new JSZip(); const data: Record<string, unknown> = {};
    for (const table of OWNED_TABLES) data[table] = await this.rows(table, job.subject_user_id, deadline);
    const guest = await this.db.from("guest_imports").select("answers,created_at,expires_at,notice_version,ai_processing,analytics").eq("claimed_user_id", job.subject_user_id);
    check(guest.error); data.guest_imports = guest.data;
    zip.file("data.json", JSON.stringify(data, null, 2));
    zip.file("README.txt", "Your CV Builder data and owned files. Authentication secrets and guest access tokens are excluded. This download expires after 24 hours. Contact the privacy address in the privacy notice for other rights requests.");
    for (const file of data.files as Record<string, any>[]) {
      // Deleted objects may legitimately be absent; their row remains in data.json.
      if (file.is_deleted) continue;
      const db = this.db;
      const source = Readable.from((async function* () {
        withinBudget(deadline);
        const result = await db.storage.from(file.storage_bucket).download(file.storage_path);
        check(result.error);
        withinBudget(deadline);
        yield Buffer.from(await result.data!.arrayBuffer());
      })());
      zip.file(`files/${file.id}/${String(file.original_filename).replace(/[^a-zA-Z0-9._-]/g, "_")}`, source);
    }
    await this.preferences(job.subject_user_id);
    const path = `privacy/${job.subject_user_id}/${job.id}.zip`;
    // Persist the intended path before storage work so a deletion can sweep it.
    check((await this.db.from("privacy_jobs").update({ storage_path: path }).eq("id", job.id)).error);
    const bytes = new Readable().wrap(zip.generateNodeStream({ compression: "DEFLATE", streamFiles: true }) as Readable);
    const timer = setTimeout(() => bytes.destroy(new MaintenanceYield()), Math.max(1, deadline - Date.now()));
    timer.unref();
    try { check((await this.db.storage.from("exports").upload(path, bytes, { contentType: "application/zip", upsert: true, duplex: "half" })).error); }
    finally { clearTimeout(timer); bytes.destroy(); }
    try {
      await this.preferences(job.subject_user_id);
      check((await this.db.from("privacy_jobs").update({ status: "complete", completed_at: iso(), lease_until: null, storage_path: path }).eq("id", job.id)).error);
    } catch (error) {
      await this.db.storage.from("exports").remove([path]); throw error;
    }
  }
  async cleanup() {
    const hardDeadline = Date.now() + 20_000;
    return withRequestDeadline(hardDeadline, () => this.runCleanup(hardDeadline - 2500));
  }
  private async runCleanup(deadline: number) {
    let removed = 0; let failed = 0;
    check((await this.db.from("privacy_cleanup_health").update({ last_attempt_at: iso() }).eq("id", true)).error);
    try {
      // Job leases survive serverless termination and can be retried next day.
      const jobs = await this.db.from("privacy_jobs").select("id").neq("status", "complete").lte("retry_at", iso()).order("retry_at").limit(100);
      check(jobs.error);
      for (const job of jobs.data ?? []) { if (Date.now() >= deadline - 500) break; if (!(await this.attemptJob(job.id, deadline))) failed++; }
      while (Date.now() < deadline) {
        const guests = await this.db.from("guest_imports").select("id,storage_path,created_at,expires_at,claimed_user_id,deleted_at,delete_attempts").or(`expires_at.lt.${iso()},deleted_at.not.is.null`).or(`delete_retry_at.is.null,delete_retry_at.lte.${iso()}`).order("expires_at").limit(50);
        check(guests.error); if (!guests.data?.length) break;
        for (const row of guests.data) {
          if (Date.now() >= deadline) break;
          try {
            // A claimed object may still have a guests/ prefix: ownership is DB-based.
            const ownership = await this.db.from("files").select("id").eq("storage_bucket", "imports").eq("storage_path", row.storage_path).limit(1);
            check(ownership.error);
            if (!ownership.data?.length) check((await this.db.storage.from("imports").remove([row.storage_path])).error);
            const guard = Date.parse(row.created_at) + 2 * 3_600_000 + 300_000;
            if (guard > Date.now()) {
              check((await this.db.from("guest_imports").update({ delete_retry_at: iso(guard) }).eq("id", row.id)).error);
              continue;
            }
            // Claim checks expiry/deleted_at under a lock, so cleanup cannot race a valid claim.
            check((await this.db.rpc("count_guest_metrics", { p_id: row.id, p_stage: "abandoned" })).error);
            check((await this.db.from("guest_imports").delete().eq("id", row.id)).error); removed++;
          } catch {
            failed++;
            check((await this.db.from("guest_imports").update({ delete_attempts: row.delete_attempts + 1, delete_retry_at: iso(Date.now() + 86_400_000) }).eq("id", row.id)).error);
          }
        }
      }
      const archives = await this.db.from("privacy_jobs").select("id,storage_path").eq("kind", "export").lt("expires_at", iso()).limit(100);
      check(archives.error);
      for (const row of archives.data ?? []) {
        if (Date.now() >= deadline) break;
        if (row.storage_path) { const deleted = await this.db.storage.from("exports").remove([row.storage_path]); if (deleted.error) { failed++; continue; } }
        check((await this.db.from("privacy_jobs").delete().eq("id", row.id)).error);
      }
      check((await this.db.from("privacy_receipts").delete().lt("retain_until", iso())).error);
      check((await this.db.from("privacy_guest_erasure_ledger").delete().lt("retain_until", iso())).error);
      const ledgers = await this.db.from("privacy_erasure_ledger").select("auth_id_hash,user_id").lt("retain_until", iso()).limit(100);
      check(ledgers.error);
      for (const ledger of ledgers.data ?? []) {
        const pending = await this.db.from("privacy_jobs").select("id").eq("subject_user_id", ledger.user_id).eq("kind", "deletion").neq("status", "complete");
        check(pending.error);
        if (!pending.data?.length) check((await this.db.from("privacy_erasure_ledger").delete().eq("auth_id_hash", ledger.auth_id_hash)).error);
      }
      check((await this.db.from("privacy_jobs").delete().eq("kind", "deletion").eq("status", "complete").lt("expires_at", iso())).error);
      check((await this.db.rpc("scrub_privacy_diagnostics")).error);
      const backlog = await this.db.from("guest_imports").select("expires_at", { count: "exact" }).or(`expires_at.lt.${iso()},deleted_at.not.is.null`).order("expires_at").limit(1);
      check(backlog.error);
      check((await this.db.from("privacy_cleanup_health").update({ last_success_at: failed ? undefined : iso(), failures: failed, backlog: backlog.count ?? 0, oldest_expired_at: backlog.data?.[0]?.expires_at ?? null }).eq("id", true)).error);
      if (failed) this.logger.error({ code: "PRIVACY_CLEANUP_FAILURE", failures: failed }, "Privacy cleanup has pending physical deletions");
      return removed;
    } catch (error) {
      await this.db.from("privacy_cleanup_health").update({ failures: failed + 1 }).eq("id", true);
      this.logger.error({ code: "PRIVACY_CLEANUP_FAILED" }, "Privacy cleanup failed"); throw error;
    }
  }
}
