import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { JobRecord, JobStatus, JobStatusHistoryRecord } from "../../shared/types/domain";
import type { JobsSortBy } from "./jobs.types";

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

export interface ListJobsQuery {
  status?: JobStatus;
  search?: string;
  sort_by?: JobsSortBy;
  sort_order?: "asc" | "desc";
  linked_tailored_cv?: boolean;
  page: number;
  limit: number;
}

export interface ListJobsBoardQuery {
  search?: string;
  sort_by?: JobsSortBy;
  sort_order?: "asc" | "desc";
  linked_tailored_cv?: boolean;
}

export interface JobWithTailoredRecord extends JobRecord {
  tailored_cv_title: string | null;
  tailored_cv_status: string | null;
  tailored_cv_updated_at: string | null;
}

export interface ListJobsResult {
  rows: JobWithTailoredRecord[];
  total: number;
}

export interface CreateJobStatusHistoryPayload {
  job_id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  changed_at: string;
  changed_by_user_id: string;
}

export interface JobsRepository {
  findById(userId: string, jobId: string): Promise<JobRecord | null>;
  findDetailById(userId: string, jobId: string): Promise<JobWithTailoredRecord | null>;
  findByIds(userId: string, jobIds: string[]): Promise<JobRecord[]>;
  listByUser(userId: string, query: ListJobsQuery): Promise<ListJobsResult>;
  listForBoard(userId: string, query: ListJobsBoardQuery): Promise<JobWithTailoredRecord[]>;
  create(payload: CreateJobPayload): Promise<JobRecord>;
  updateById(userId: string, jobId: string, payload: UpdateJobPayload): Promise<JobRecord | null>;
  linkTailoredCv(userId: string, jobId: string, tailoredCvId: string): Promise<JobRecord | null>;
  createStatusHistory(payload: CreateJobStatusHistoryPayload): Promise<JobStatusHistoryRecord>;
  listStatusHistory(jobId: string, limit: number): Promise<JobStatusHistoryRecord[]>;
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

const toStatusHistoryRecord = (row: Record<string, unknown>): JobStatusHistoryRecord => {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    from_status: (row.from_status as JobStatus | null) ?? null,
    to_status: row.to_status as JobStatus,
    changed_at: String(row.changed_at),
    changed_by_user_id: String(row.changed_by_user_id)
  };
};

const readTailoredJoin = (row: Record<string, unknown>): Record<string, unknown> | null => {
  const value = row.tailored_cv;
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }

  return typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const toJobWithTailoredRecord = (row: Record<string, unknown>): JobWithTailoredRecord => {
  const base = toJobRecord(row);
  const tailored = readTailoredJoin(row);

  return {
    ...base,
    tailored_cv_title: tailored?.title ? String(tailored.title) : null,
    tailored_cv_status: tailored?.status ? String(tailored.status) : null,
    tailored_cv_updated_at: tailored?.updated_at ? String(tailored.updated_at) : null
  };
};

const JOB_DETAIL_SELECT =
  "*,tailored_cv:tailored_cvs!jobs_tailored_cv_id_fkey(id,title,status,updated_at)";

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

  async findDetailById(userId: string, jobId: string): Promise<JobWithTailoredRecord | null> {
    const { data, error } = await this.supabaseClient
      .from("jobs")
      .select(JOB_DETAIL_SELECT)
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

    return toJobWithTailoredRecord(data as Record<string, unknown>);
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

  async listByUser(userId: string, query: ListJobsQuery): Promise<ListJobsResult> {
    let builder = this.supabaseClient
      .from("jobs")
      .select(JOB_DETAIL_SELECT, { count: "exact" })
      .eq("user_id", userId);

    if (query.status) {
      builder = builder.eq("status", query.status);
    }

    if (query.search) {
      const escaped = query.search.replace(/,/g, "\\,");
      builder = builder.or(`company_name.ilike.%${escaped}%,job_title.ilike.%${escaped}%`);
    }

    if (query.linked_tailored_cv === true) {
      builder = builder.not("tailored_cv_id", "is", null);
    }

    if (query.linked_tailored_cv === false) {
      builder = builder.is("tailored_cv_id", null);
    }

    const sortBy = query.sort_by ?? "updated_at";
    const ascending = query.sort_order === "asc";
    const from = (query.page - 1) * query.limit;
    const to = from + query.limit - 1;

    const { data, error, count } = await (builder as any)
      .order(sortBy, { ascending, nullsFirst: ascending })
      .range(from, to);

    if (error) {
      throw new InternalServerError("Failed to list jobs", {
        reason: error.message
      });
    }

    return {
      rows: (data ?? []).map((row: unknown) => toJobWithTailoredRecord(row as Record<string, unknown>)),
      total: count ?? 0
    };
  }

  async listForBoard(userId: string, query: ListJobsBoardQuery): Promise<JobWithTailoredRecord[]> {
    let builder = this.supabaseClient.from("jobs").select(JOB_DETAIL_SELECT).eq("user_id", userId);

    if (query.search) {
      const escaped = query.search.replace(/,/g, "\\,");
      builder = builder.or(`company_name.ilike.%${escaped}%,job_title.ilike.%${escaped}%`);
    }

    if (query.linked_tailored_cv === true) {
      builder = builder.not("tailored_cv_id", "is", null);
    }

    if (query.linked_tailored_cv === false) {
      builder = builder.is("tailored_cv_id", null);
    }

    const sortBy = query.sort_by ?? "updated_at";
    const ascending = query.sort_order === "asc";

    const { data, error } = await (builder as any).order(sortBy, {
      ascending,
      nullsFirst: ascending
    });

    if (error) {
      throw new InternalServerError("Failed to list jobs for board", {
        reason: error.message
      });
    }

    return (data ?? []).map((row: unknown) => toJobWithTailoredRecord(row as Record<string, unknown>));
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

  async createStatusHistory(payload: CreateJobStatusHistoryPayload): Promise<JobStatusHistoryRecord> {
    const { data, error } = await this.supabaseClient
      .from("job_status_history")
      .insert({
        job_id: payload.job_id,
        from_status: payload.from_status,
        to_status: payload.to_status,
        changed_at: payload.changed_at,
        changed_by_user_id: payload.changed_by_user_id
      })
      .select("*")
      .single();

    if (error) {
      throw new InternalServerError("Failed to create job status history", {
        reason: error.message
      });
    }

    return toStatusHistoryRecord(data as Record<string, unknown>);
  }

  async listStatusHistory(jobId: string, limit: number): Promise<JobStatusHistoryRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("job_status_history")
      .select("*")
      .eq("job_id", jobId)
      .order("changed_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerError("Failed to list job status history", {
        reason: error.message
      });
    }

    return (data ?? []).map((row) => toStatusHistoryRecord(row as Record<string, unknown>));
  }
}
