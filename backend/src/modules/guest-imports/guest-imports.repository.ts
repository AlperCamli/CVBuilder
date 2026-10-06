import { reviewCv } from "../cv-review/cv-review";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParseCvFileResult } from "../imports/parsers/cv-parser";
import type { GuestAnswers, GuestCreate } from "./guest-imports.schemas";
import {
  ConflictError,
  InternalServerError,
  NotFoundError,
} from "../../shared/errors/app-error";

export interface GuestImport extends GuestCreate {
  id: string;
  ai_provider?: string | null;
  ai_notice_version?: string | null;
  deleted_at?: string | null;
  processing_restricted_at?: string | null;
  privacy_revision?: number;
  token_hash: string;
  storage_path: string;
  expires_at: string;
  status: "uploaded" | "parsing" | "parsed" | "failed" | "claimed";
  answers: GuestAnswers;
  attempts: number;
  lease_id: string | null;
  lease_expires_at: string | null;
  error_message: string | null;
  claimed_user_id: string | null;
  claimed_import_id: string | null;
}
export interface GuestImportsRepository {
  create(
    row: GuestCreate & {
      id: string;
      token_hash: string;
      storage_path: string;
      expires_at: string;
    },
  ): Promise<GuestImport>;
  find(id: string): Promise<GuestImport | null>;
  saveAnswers(id: string, answers: GuestAnswers): Promise<void>;
  acquireLease(
    id: string,
    leaseId: string,
    now: string,
    until: string,
  ): Promise<boolean>;
  finish(
    id: string,
    leaseId: string,
    result: ParseCvFileResult | null,
    revision?: number,
  ): Promise<void>;
  claim(id: string, tokenHash: string, userId: string): Promise<string>;
  cleanup(): Promise<number>;
}
export class SupabaseGuestImportsRepository implements GuestImportsRepository {
  constructor(private readonly client: SupabaseClient) {}
  private check(error: { message: string } | null) {
    if (error)
      throw new InternalServerError(
        "Could not save your CV. Please try again.",
        { reason: error.message },
      );
  }
  async create(
    row: GuestCreate & {
      id: string;
      token_hash: string;
      storage_path: string;
      expires_at: string;
    },
  ) {
    const { data, error } = await this.client
      .from("guest_imports")
      .insert(row)
      .select("*")
      .single();
    this.check(error);
    return data as GuestImport;
  }
  async find(id: string) {
    const { data, error } = await this.client
      .from("guest_imports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    this.check(error);
    return data as GuestImport | null;
  }
  async saveAnswers(id: string, answers: GuestAnswers) {
    const { data, error } = await this.client
      .from("guest_imports")
      .update({ answers })
      .eq("id", id)
      .is("claimed_user_id", null)
      .is("deleted_at", null)
      .is("processing_restricted_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    this.check(error);
    if (!data)
      throw new ConflictError("This CV has already been saved to an account.");
  }
  async acquireLease(id: string, leaseId: string, now: string, until: string) {
    const { data, error } = await this.client.rpc("begin_guest_import_parse", {
      p_id: id,
      p_lease_id: leaseId,
    });
    this.check(error);
    return Boolean(data);
  }
  async finish(id: string, leaseId: string, result: ParseCvFileResult | null, revision = 0) {
    const payload = result
      ? {
          cv_review: reviewCv({
            content: result.parsedContent,
            import_status: "parsed",
            raw_text: result.rawExtractedText,
            diagnostics: result.diagnostics,
          }),
          status: "parsed",
          parser_name: result.parserName,
          raw_extracted_text: result.rawExtractedText,
          parsed_content: result.parsedContent,
          review_context: {
            diagnostics: result.diagnostics,
            warnings: result.warnings,
          },
          error_message: null,
        }
      : {
          status: "failed",
          error_message:
            "We couldn't read this CV. Try again or choose another PDF or DOCX.",
        };
    const { error } = await this.client
      .from("guest_imports")
      .update({ ...payload, lease_id: null, lease_expires_at: null })
      .eq("id", id)
      .eq("lease_id", leaseId)
      .eq("privacy_revision", revision)
      .is("deleted_at", null)
      .is("processing_restricted_at", null)
      .gt("expires_at", new Date().toISOString());
    this.check(error);
  }
  async claim(id: string, tokenHash: string, userId: string) {
    const { data, error } = await this.client.rpc("claim_guest_import", {
      p_id: id,
      p_token_hash: tokenHash,
      p_user_id: userId,
    });
    if (error?.message.includes("guest_not_found"))
      throw new NotFoundError(
        "This upload has expired. Please upload your CV again.",
      );
    if (error?.message.includes("guest_not_ready"))
      throw new ConflictError("Your CV is still being analyzed.");
    this.check(error);
    return String(data);
  }
  async cleanup() {
    // Claim and cleanup both test expiry in the database. Claimed source files
    // belong to the account and must never be deleted by guest cleanup.
    const { data, error } = await this.client
      .from("guest_imports")
      .select("id,storage_path,claimed_user_id")
      .lt("expires_at", new Date().toISOString())
      .limit(100);
    this.check(error);
    let removed = 0;
    for (const row of data ?? []) {
      if (!row.claimed_user_id) {
        const result = await this.client.storage
          .from("imports")
          .remove([row.storage_path]);
        if (result.error) continue; // retain metadata so the next cleanup retries
      }
      const result = await this.client
        .from("guest_imports")
        .delete()
        .eq("id", row.id);
      this.check(result.error);
      removed++;
    }
    return removed;
  }
}
