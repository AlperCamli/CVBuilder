import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { JobRecord, JobStatus } from "../../shared/types/domain";

export interface CreateJobPayload {
  user_id: string;
  tailored_cv_id?: string | null;
  company_name: string;
  job_title: string;
  job_description: string;
  job_posting_url: string | null;
  location_text: string | null;
  notes: string | null;
  status: JobStatus;
  applied_at?: string | null;
}

export interface UpdateJobPayload {
  tailored_cv_id?: string | null;
  company_name?: string;
  job_title?: string;
  job_description?: string;
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
  status?: JobStatus;
  applied_at?: string | null;
}

export interface JobsRepository {
  findById(userId: string, jobId: string): Promise<JobRecord | null>;
  findByIds(userId: string, jobIds: string[]): Promise<JobRecord[]>;
  create(payload: CreateJobPayload): Promise<JobRecord>;
  updateById(userId: string, jobId: string, payload: UpdateJobPayload): Promise<JobRecord | null>;
  linkTailoredCv(userId: string, jobId: string, tailoredCvId: string): Promise<JobRecord | null>;
}

const toJobRecord = (row: Record<string, unknown>): JobRecord => {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    tailored_cv_id: row.tailored_cv_id ? String(row.tailored_cv_id) : null,
    company_name: String(row.company_name),
    job_title: String(row.job_title),
    job_description: String(row.job_description),
    job_posting_url: (row.job_posting_url as string | null) ?? null,
    location_text: (row.location_text as string | null) ?? null,
    status: row.status as JobStatus,
    notes: (row.notes as string | null) ?? null,
    applied_at: (row.applied_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseJobsRepository implements JobsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async findById(userId: string, jobId: string): Promise<JobRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to load job", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toJobRecord(data as Record<string, unknown>);
  }

  async findByIds(userId: string, jobIds: string[]): Promise<JobRecord[]> {
    if (jobIds.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(jobIds)];
    const { data, error } = await this.supabaseClient
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .in("id", uniqueIds);

    if (error) {
      throw new InternalServerError("Failed to load jobs", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toJobRecord(row as Record<string, unknown>));
  }

  async create(payload: CreateJobPayload): Promise<JobRecord> {
    const { data, error } = await this.supabaseClient
      .from("jobs")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create job", {
        reason: error.message
      });
    }

    return toJobRecord(data as Record<string, unknown>);
  }

  async updateById(userId: string, jobId: string, payload: UpdateJobPayload): Promise<JobRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("jobs")
      .update(payload)
      .eq("id", jobId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new InternalServerError("Failed to update job", {
        reason: error.message
      });
    }

    if (!data) {
      return null;
    }

    return toJobRecord(data as Record<string, unknown>);
  }

  async linkTailoredCv(userId: string, jobId: string, tailoredCvId: string): Promise<JobRecord | null> {
    return this.updateById(userId, jobId, {
      tailored_cv_id: tailoredCvId
    });
  }
}
