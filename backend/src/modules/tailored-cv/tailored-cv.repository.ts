import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import type { TailoredCvRecord, TailoredCvStatus } from "../../shared/types/domain";

export interface TailoredCvCreatePayload {
  user_id: string;
  master_cv_id: string;
  job_id: string | null;
  title: string;
  language: string;
  template_id: string | null;
  current_content: CvContent;
  status: TailoredCvStatus;
  ai_generation_status?: string | null;
  last_exported_at?: string | null;
}

export interface TailoredCvUpdatePayload {
  title?: string;
  language?: string;
  template_id?: string | null;
  status?: TailoredCvStatus;
  current_content?: CvContent;
  ai_generation_status?: string | null;
  last_exported_at?: string | null;
  job_id?: string | null;
}

export interface TailoredCvListQuery {
  status?: TailoredCvStatus;
  sort_order?: "asc" | "desc";
}

export interface TailoredCvRepository {
  listByUser(userId: string, query?: TailoredCvListQuery): Promise<TailoredCvRecord[]>;
  findById(userId: string, tailoredCvId: string): Promise<TailoredCvRecord | null>;
  create(payload: TailoredCvCreatePayload): Promise<TailoredCvRecord>;
  updateById(
    userId: string,
    tailoredCvId: string,
    payload: TailoredCvUpdatePayload
  ): Promise<TailoredCvRecord | null>;
  softDelete(userId: string, tailoredCvId: string): Promise<boolean>;
}

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

const toTailoredCvRecord = (row: Record<string, unknown>): TailoredCvRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    master_cv_id: String(row.master_cv_id),
    job_id: row.job_id ? String(row.job_id) : null,
    title: String(row.title),
    language: String(row.language),
    template_id: row.template_id ? String(row.template_id) : null,
    current_content: row.current_content as CvContent,
    status: row.status as TailoredCvStatus,
    ai_generation_status: (row.ai_generation_status as string | null) ?? null,
    last_exported_at: (row.last_exported_at as string | null) ?? null,
    is_deleted: Boolean(row.is_deleted),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseTailoredCvRepository implements TailoredCvRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async listByUser(userId: string, query?: TailoredCvListQuery): Promise<TailoredCvRecord[]> {
    let builder = this.supabaseClient
      .from("tailored_cvs")
      .select("*")
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: query?.sort_order === "asc" });

    if (query?.status) {
      builder = builder.eq("status", query.status);
    }

    const { data, error } = await builder;

    if (error) {
      throw new InternalServerError("Failed to list tailored CVs", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toTailoredCvRecord(row as Record<string, unknown>));
  }

  async findById(userId: string, tailoredCvId: string): Promise<TailoredCvRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("tailored_cvs")
      .select("*")
      .eq("id", tailoredCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load tailored CV", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toTailoredCvRecord(data as Record<string, unknown>);
  }

  async create(payload: TailoredCvCreatePayload): Promise<TailoredCvRecord> {
    const { data, error } = await this.supabaseClient
      .from("tailored_cvs")
      .insert({
        ...payload,
        current_content: toDbContent(payload.current_content)
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create tailored CV", {
        reason: error.message
      });
    }

    return toTailoredCvRecord(data as Record<string, unknown>);
  }

  async updateById(
    userId: string,
    tailoredCvId: string,
    payload: TailoredCvUpdatePayload
  ): Promise<TailoredCvRecord | null> {
    const updatePayload: Record<string, unknown> = {
      ...payload
    };

    if (payload.current_content) {
      updatePayload.current_content = toDbContent(payload.current_content);
    }

    const { data, error } = await this.supabaseClient
      .from("tailored_cvs")
      .update(updatePayload)
      .eq("id", tailoredCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update tailored CV", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toTailoredCvRecord(data as Record<string, unknown>);
  }

  async softDelete(userId: string, tailoredCvId: string): Promise<boolean> {
    const { data, error } = await this.supabaseClient
      .from("tailored_cvs")
      .update({
        is_deleted: true
      })
      .eq("id", tailoredCvId)
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to delete tailored CV", {
        reason: error.message
      });
    }

    return Boolean(data);
  }
}
