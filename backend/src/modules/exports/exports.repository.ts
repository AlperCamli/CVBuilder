import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { ExportFormat, ExportRecord, ExportStatus } from "../../shared/types/domain";

export interface CreateExportPayload {
  user_id: string;
  master_cv_id?: string | null;
  tailored_cv_id?: string | null;
  file_id?: string | null;
  format: ExportFormat;
  status: ExportStatus;
  template_id?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface UpdateExportPayload {
  file_id?: string | null;
  status?: ExportStatus;
  template_id?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface ExportsRepository {
  create(payload: CreateExportPayload): Promise<ExportRecord>;
  updateById(userId: string, exportId: string, payload: UpdateExportPayload): Promise<ExportRecord | null>;
  findById(userId: string, exportId: string): Promise<ExportRecord | null>;
  listByTailoredCv(userId: string, tailoredCvId: string): Promise<ExportRecord[]>;
  listByMasterCv(userId: string, masterCvId: string): Promise<ExportRecord[]>;
}

const toExportRecord = (row: Record<string, unknown>): ExportRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    master_cv_id: row.master_cv_id ? String(row.master_cv_id) : null,
    tailored_cv_id: row.tailored_cv_id ? String(row.tailored_cv_id) : null,
    file_id: row.file_id ? String(row.file_id) : null,
    format: row.format as ExportFormat,
    status: row.status as ExportStatus,
    template_id: row.template_id ? String(row.template_id) : null,
    error_message: (row.error_message as string | null) ?? null,
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string | null) ?? null
  };
};

export class SupabaseExportsRepository implements ExportsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async create(payload: CreateExportPayload): Promise<ExportRecord> {
    const { data, error } = await this.supabaseClient
      .from("exports")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create export record", {
        reason: error.message
      });
    }

    return toExportRecord(data as Record<string, unknown>);
  }

  async updateById(userId: string, exportId: string, payload: UpdateExportPayload): Promise<ExportRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("exports")
      .update(payload)
      .eq("id", exportId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update export record", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toExportRecord(data as Record<string, unknown>);
  }

  async findById(userId: string, exportId: string): Promise<ExportRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("exports")
      .select("*")
      .eq("id", exportId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load export record", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toExportRecord(data as Record<string, unknown>);
  }

  async listByTailoredCv(userId: string, tailoredCvId: string): Promise<ExportRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("exports")
      .select("*")
      .eq("user_id", userId)
      .eq("tailored_cv_id", tailoredCvId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list export records", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toExportRecord(row as Record<string, unknown>));
  }

  async listByMasterCv(userId: string, masterCvId: string): Promise<ExportRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("exports")
      .select("*")
      .eq("user_id", userId)
      .eq("master_cv_id", masterCvId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list export records", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toExportRecord(row as Record<string, unknown>));
  }
}
