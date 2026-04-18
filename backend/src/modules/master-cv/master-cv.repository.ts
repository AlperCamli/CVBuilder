import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import type { MasterCvRecord, MasterCvSourceType } from "../../shared/types/domain";

type MasterCvUpdatePayload = {
  title?: string;
  language?: string;
  template_id?: string | null;
  current_content?: CvContent;
  summary_text?: string | null;
  source_type?: MasterCvSourceType;
};

export interface CreateMasterCvPayload {
  user_id: string;
  title: string;
  language: string;
  template_id: string | null;
  current_content: CvContent;
  summary_text: string | null;
  source_type: MasterCvSourceType;
}

export interface MasterCvRepository {
  listByUser(userId: string): Promise<MasterCvRecord[]>;
  findById(userId: string, masterCvId: string): Promise<MasterCvRecord | null>;
  findAnyById(userId: string, masterCvId: string): Promise<MasterCvRecord | null>;
  create(payload: CreateMasterCvPayload): Promise<MasterCvRecord>;
  updateById(userId: string, masterCvId: string, payload: MasterCvUpdatePayload): Promise<MasterCvRecord | null>;
  softDelete(userId: string, masterCvId: string): Promise<boolean>;
}

const toMasterCvRecord = (row: Record<string, unknown>): MasterCvRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    language: String(row.language),
    template_id: row.template_id ? String(row.template_id) : null,
    current_content: row.current_content as CvContent,
    summary_text: (row.summary_text as string | null) ?? null,
    source_type: row.source_type as MasterCvSourceType,
    is_deleted: Boolean(row.is_deleted),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

const sanitizeJsonValue = (value: CvJsonValue): unknown => {
  return value;
};

const toDbContent = (content: CvContent): Record<string, unknown> => {
  return {
    version: content.version,
    language: content.language,
    metadata: Object.fromEntries(
      Object.entries(content.metadata).map(([key, value]) => [key, sanitizeJsonValue(value)])
    ),
    sections: content.sections.map((section) => ({
      id: section.id,
      type: section.type,
      title: section.title,
      order: section.order,
      meta: Object.fromEntries(
        Object.entries(section.meta).map(([key, value]) => [key, sanitizeJsonValue(value)])
      ),
      blocks: section.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        order: block.order,
        visibility: block.visibility,
        fields: Object.fromEntries(
          Object.entries(block.fields).map(([key, value]) => [key, sanitizeJsonValue(value)])
        ),
        meta: Object.fromEntries(
          Object.entries(block.meta).map(([key, value]) => [key, sanitizeJsonValue(value)])
        )
      }))
    }))
  };
};

export class SupabaseMasterCvRepository implements MasterCvRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async listByUser(userId: string): Promise<MasterCvRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .select("*")
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list master CVs", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toMasterCvRecord(row as Record<string, unknown>));
  }

  async findById(userId: string, masterCvId: string): Promise<MasterCvRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .select("*")
      .eq("id", masterCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load master CV", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toMasterCvRecord(data as Record<string, unknown>);
  }

  async findAnyById(userId: string, masterCvId: string): Promise<MasterCvRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .select("*")
      .eq("id", masterCvId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load master CV", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toMasterCvRecord(data as Record<string, unknown>);
  }

  async create(payload: CreateMasterCvPayload): Promise<MasterCvRecord> {
    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .insert({
        user_id: payload.user_id,
        title: payload.title,
        language: payload.language,
        template_id: payload.template_id,
        current_content: toDbContent(payload.current_content),
        summary_text: payload.summary_text,
        source_type: payload.source_type
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create master CV", {
        reason: error.message
      });
    }

    return toMasterCvRecord(data as Record<string, unknown>);
  }

  async updateById(
    userId: string,
    masterCvId: string,
    payload: MasterCvUpdatePayload
  ): Promise<MasterCvRecord | null> {
    const updatePayload: Record<string, unknown> = {
      ...payload
    };

    if (payload.current_content) {
      updatePayload.current_content = toDbContent(payload.current_content);
    }

    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .update(updatePayload)
      .eq("id", masterCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update master CV", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toMasterCvRecord(data as Record<string, unknown>);
  }

  async softDelete(userId: string, masterCvId: string): Promise<boolean> {
    const { data, error } = await this.supabaseClient
      .from("master_cvs")
      .update({
        is_deleted: true
      })
      .eq("id", masterCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to delete master CV", {
        reason: error.message
      });
    }

    return Boolean(data);
  }
}
