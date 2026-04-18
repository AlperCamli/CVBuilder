import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvTemplateRecord } from "../../shared/types/domain";

export interface TemplatesRepository {
  listActive(): Promise<CvTemplateRecord[]>;
  findById(templateId: string): Promise<CvTemplateRecord | null>;
  findDefaultActive(): Promise<CvTemplateRecord | null>;
}

const toTemplateRecord = (row: Record<string, unknown>): CvTemplateRecord => {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: String(row.status),
    preview_config: (row.preview_config as Record<string, unknown> | null) ?? null,
    export_config: (row.export_config as Record<string, unknown> | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseTemplatesRepository implements TemplatesRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async listActive(): Promise<CvTemplateRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("cv_templates")
      .select("*")
      .eq("status", "active")
      .order("name", { ascending: true });

    if (error) {
      throw new InternalServerError("Failed to list templates", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toTemplateRecord(row as Record<string, unknown>));
  }

  async findById(templateId: string): Promise<CvTemplateRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cv_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load template", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toTemplateRecord(data as Record<string, unknown>);
  }

  async findDefaultActive(): Promise<CvTemplateRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cv_templates")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to resolve default template", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toTemplateRecord(data as Record<string, unknown>);
  }
}
