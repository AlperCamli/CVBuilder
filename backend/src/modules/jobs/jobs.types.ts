import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type { JobStatus } from "../../shared/types/domain";

export type SessionContext = AuthenticatedRequestContext;

export interface JobDetail {
  id: string;
  company_name: string;
  job_title: string;
  job_description: string;
  job_posting_url: string | null;
  location_text: string | null;
  status: JobStatus;
  notes: string | null;
  applied_at: string | null;
  tailored_cv_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateJobInput {
  company_name?: string;
  job_title?: string;
  job_description?: string;
  job_posting_url?: string | null;
  location_text?: string | null;
  notes?: string | null;
  status?: JobStatus;
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
