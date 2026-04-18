import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvKind, CvBlockRevisionRecord, CvRevisionChangeSource } from "../../shared/types/domain";

export interface CreateCvBlockRevisionPayload {
  user_id: string;
  cv_kind: CvKind;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  block_id: string;
  block_type: string;
  revision_number: number;
  content_snapshot: Record<string, unknown>;
  change_source: CvRevisionChangeSource;
  ai_suggestion_id?: string | null;
  created_by_user_id?: string | null;
}

export interface RevisionBlockScope {
  user_id: string;
  cv_kind: CvKind;
  block_id: string;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
}

export interface CvRevisionsRepository {
  create(payload: CreateCvBlockRevisionPayload): Promise<CvBlockRevisionRecord>;
  findById(userId: string, revisionId: string): Promise<CvBlockRevisionRecord | null>;
  listByTailoredCv(userId: string, tailoredCvId: string): Promise<CvBlockRevisionRecord[]>;
  listByTailoredCvBlock(
    userId: string,
    tailoredCvId: string,
    blockId: string
  ): Promise<CvBlockRevisionRecord[]>;
  findLatestRevisionNumber(scope: RevisionBlockScope): Promise<number>;
}

const toCvBlockRevisionRecord = (row: Record<string, unknown>): CvBlockRevisionRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    cv_kind: row.cv_kind as CvKind,
    master_cv_id: (row.master_cv_id as string | null) ?? null,
    tailored_cv_id: (row.tailored_cv_id as string | null) ?? null,
    block_id: String(row.block_id),
    block_type: String(row.block_type),
    revision_number: Number(row.revision_number),
    content_snapshot: (row.content_snapshot as Record<string, unknown>) ?? {},
    change_source: row.change_source as CvRevisionChangeSource,
    ai_suggestion_id: (row.ai_suggestion_id as string | null) ?? null,
    created_at: String(row.created_at),
    created_by_user_id: (row.created_by_user_id as string | null) ?? null
  };
};

export class SupabaseCvRevisionsRepository implements CvRevisionsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async create(payload: CreateCvBlockRevisionPayload): Promise<CvBlockRevisionRecord> {
    const { data, error } = await this.supabaseClient
      .from("cv_block_revisions")
      .insert({
        user_id: payload.user_id,
        cv_kind: payload.cv_kind,
        master_cv_id: payload.master_cv_id ?? null,
        tailored_cv_id: payload.tailored_cv_id ?? null,
        block_id: payload.block_id,
        block_type: payload.block_type,
        revision_number: payload.revision_number,
        content_snapshot: payload.content_snapshot,
        change_source: payload.change_source,
        ai_suggestion_id: payload.ai_suggestion_id ?? null,
        created_by_user_id: payload.created_by_user_id ?? null
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create CV block revision", {
        reason: error.message
      });
    }

    return toCvBlockRevisionRecord(data as Record<string, unknown>);
  }

  async findById(userId: string, revisionId: string): Promise<CvBlockRevisionRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cv_block_revisions")
      .select("*")
      .eq("id", revisionId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load CV block revision", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCvBlockRevisionRecord(data as Record<string, unknown>);
  }

  async listByTailoredCv(userId: string, tailoredCvId: string): Promise<CvBlockRevisionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("cv_block_revisions")
      .select("*")
      .eq("user_id", userId)
      .eq("cv_kind", "tailored")
      .eq("tailored_cv_id", tailoredCvId)
      .order("created_at", { ascending: false })
      .order("revision_number", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list CV block revisions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toCvBlockRevisionRecord(row as Record<string, unknown>));
  }

  async listByTailoredCvBlock(
    userId: string,
    tailoredCvId: string,
    blockId: string
  ): Promise<CvBlockRevisionRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("cv_block_revisions")
      .select("*")
      .eq("user_id", userId)
      .eq("cv_kind", "tailored")
      .eq("tailored_cv_id", tailoredCvId)
      .eq("block_id", blockId)
      .order("revision_number", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list block revisions", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toCvBlockRevisionRecord(row as Record<string, unknown>));
  }

  async findLatestRevisionNumber(scope: RevisionBlockScope): Promise<number> {
    let builder = this.supabaseClient
      .from("cv_block_revisions")
      .select("revision_number")
      .eq("user_id", scope.user_id)
      .eq("cv_kind", scope.cv_kind)
      .eq("block_id", scope.block_id)
      .order("revision_number", { ascending: false })
      .limit(1);

    if (scope.cv_kind === "tailored") {
      builder = builder.eq("tailored_cv_id", scope.tailored_cv_id ?? "");
    } else {
      builder = builder.eq("master_cv_id", scope.master_cv_id ?? "");
    }

    const { data, error } = await builder.maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to read latest revision number", {
        reason: error.message
      });
    }

    if (!data) {
      return 0;
    }

    return Number((data as Record<string, unknown>).revision_number ?? 0);
  }
}
