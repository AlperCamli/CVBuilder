import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type {
  CoverLetterExportRecord,
  CoverLetterRecord,
  CoverLetterStatus,
  ExportFormat,
  ExportStatus
} from "../../shared/types/domain";

export interface CreateCoverLetterPayload {
  user_id: string;
  job_id: string;
  tailored_cv_id: string | null;
  title: string;
  content: string;
  status: CoverLetterStatus;
  last_exported_at: string | null;
}

export interface UpdateCoverLetterPayload {
  title?: string;
  content?: string;
  status?: CoverLetterStatus;
  tailored_cv_id?: string | null;
  last_exported_at?: string | null;
}

export interface CreateCoverLetterExportPayload {
  user_id: string;
  cover_letter_id: string;
  file_id?: string | null;
  format: ExportFormat;
  status: ExportStatus;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface UpdateCoverLetterExportPayload {
  file_id?: string | null;
  status?: ExportStatus;
  error_message?: string | null;
  completed_at?: string | null;
}

export interface CoverLettersRepository {
  listByUser(userId: string): Promise<CoverLetterRecord[]>;
  findById(userId: string, coverLetterId: string): Promise<CoverLetterRecord | null>;
  findByJobId(userId: string, jobId: string): Promise<CoverLetterRecord | null>;
  create(payload: CreateCoverLetterPayload): Promise<CoverLetterRecord>;
  updateById(
    userId: string,
    coverLetterId: string,
    payload: UpdateCoverLetterPayload
  ): Promise<CoverLetterRecord | null>;

  createExport(payload: CreateCoverLetterExportPayload): Promise<CoverLetterExportRecord>;
  updateExportById(
    userId: string,
    coverLetterExportId: string,
    payload: UpdateCoverLetterExportPayload
  ): Promise<CoverLetterExportRecord | null>;
  findExportById(userId: string, coverLetterExportId: string): Promise<CoverLetterExportRecord | null>;
  listExportsByCoverLetter(userId: string, coverLetterId: string): Promise<CoverLetterExportRecord[]>;
}

const toCoverLetterRecord = (row: Record<string, unknown>): CoverLetterRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    job_id: String(row.job_id),
    tailored_cv_id: row.tailored_cv_id ? String(row.tailored_cv_id) : null,
    title: String(row.title),
    content: String(row.content ?? ""),
    status: row.status as CoverLetterStatus,
    last_exported_at: (row.last_exported_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

const toCoverLetterExportRecord = (row: Record<string, unknown>): CoverLetterExportRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    cover_letter_id: String(row.cover_letter_id),
    file_id: row.file_id ? String(row.file_id) : null,
    format: row.format as ExportFormat,
    status: row.status as ExportStatus,
    error_message: (row.error_message as string | null) ?? null,
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string | null) ?? null
  };
};

export class SupabaseCoverLettersRepository implements CoverLettersRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async listByUser(userId: string): Promise<CoverLetterRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("cover_letters")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list cover letters", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toCoverLetterRecord(row as Record<string, unknown>));
  }

  async findById(userId: string, coverLetterId: string): Promise<CoverLetterRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cover_letters")
      .select("*")
      .eq("id", coverLetterId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load cover letter", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCoverLetterRecord(data as Record<string, unknown>);
  }

  async findByJobId(userId: string, jobId: string): Promise<CoverLetterRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cover_letters")
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load cover letter", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCoverLetterRecord(data as Record<string, unknown>);
  }

  async create(payload: CreateCoverLetterPayload): Promise<CoverLetterRecord> {
    const { data, error } = await this.supabaseClient
      .from("cover_letters")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create cover letter", {
        reason: error.message
      });
    }

    return toCoverLetterRecord(data as Record<string, unknown>);
  }

  async updateById(
    userId: string,
    coverLetterId: string,
    payload: UpdateCoverLetterPayload
  ): Promise<CoverLetterRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cover_letters")
      .update(payload)
      .eq("id", coverLetterId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update cover letter", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCoverLetterRecord(data as Record<string, unknown>);
  }

  async createExport(payload: CreateCoverLetterExportPayload): Promise<CoverLetterExportRecord> {
    const { data, error } = await this.supabaseClient
      .from("cover_letter_exports")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create cover letter export record", {
        reason: error.message
      });
    }

    return toCoverLetterExportRecord(data as Record<string, unknown>);
  }

  async updateExportById(
    userId: string,
    coverLetterExportId: string,
    payload: UpdateCoverLetterExportPayload
  ): Promise<CoverLetterExportRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cover_letter_exports")
      .update(payload)
      .eq("id", coverLetterExportId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update cover letter export record", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCoverLetterExportRecord(data as Record<string, unknown>);
  }

  async findExportById(userId: string, coverLetterExportId: string): Promise<CoverLetterExportRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("cover_letter_exports")
      .select("*")
      .eq("id", coverLetterExportId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load cover letter export record", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toCoverLetterExportRecord(data as Record<string, unknown>);
  }

  async listExportsByCoverLetter(userId: string, coverLetterId: string): Promise<CoverLetterExportRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("cover_letter_exports")
      .select("*")
      .eq("user_id", userId)
      .eq("cover_letter_id", coverLetterId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new InternalServerError("Failed to list cover letter export records", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toCoverLetterExportRecord(row as Record<string, unknown>));
  }
}
