import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { JobStatus } from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface JobLinkedTailoredCvSummary {
  id: string;
  title: string;
  status: string;
  updated_at: string;
}

export interface JobSummary {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
  job_posting_url: string | null;
  location_text: string | null;
  tailored_cv_id: string | null;
  cover_letter_id: string | null;
  tailored_cv_title: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

export interface JobDetail {
  job: JobSummary;
  job_description: string;
  notes: string | null;
  linked_tailored_cv: JobLinkedTailoredCvSummary | null;
  status_last_changed_at: string;
}

export interface UpdateJobInput {
  company_name?: string;
  job_title?: string;
  job_description?: string;
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
}

export interface CreateJobInput {
  company_name: string;
  job_title: string;
  job_description: string;
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
  status?: JobStatus;
}

export interface UpdateJobStatusInput {
  status: JobStatus;
}

export type JobsSortBy =
  | "created_at"
  | "updated_at"
  | "company_name"
  | "job_title"
  | "status"
  | "applied_at";

export interface ListJobsInput {
  status?: JobStatus;
  search?: string;
  sort_by?: JobsSortBy;
  sort_order?: "asc" | "desc";
  linked_tailored_cv?: boolean;
  page?: number;
  limit?: number;
}

export interface ListJobsBoardInput {
  search?: string;
  sort_by?: JobsSortBy;
  sort_order?: "asc" | "desc";
  linked_tailored_cv?: boolean;
}

export interface ListJobsResponse {
  items: JobSummary[];
  page: number;
  limit: number;
  total: number;
}

export interface JobBoardGroup {
  status: JobStatus;
  count: number;
  items: JobSummary[];
}

export interface JobStatusCounts {
  saved: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  archived: number;
}

export interface JobBoardResponse {
  groups: JobBoardGroup[];
  counts_by_status: JobStatusCounts;
  total: number;
}

export interface JobHistoryItem {
  id: string;
  from_status: JobStatus | null;
  to_status: JobStatus;
  changed_at: string;
  changed_by_user_id: string;
}

export interface JobHistoryResponse {
  job_id: string;
  current_status: JobStatus;
  current_status_updated_at: string;
  history: JobHistoryItem[];
}

export interface UpdateJobStatusResponse {
  job: JobDetail;
  status_history_entry: JobHistoryItem | null;
}
