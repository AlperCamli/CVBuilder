import type { CurrentPlanSummary, EntitlementSummary, UsageSummary } from "../../shared/types/domain";
import type { JobStatus } from "../../shared/types/domain";

export interface DashboardUserSummary {
  id: string;
  email: string;
  full_name: string | null;
}

export interface DashboardMasterCvItem {
  id: string;
  title: string;
  language: string;
  template_id: string | null;
  source_type: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardTailoredCvItem {
  id: string;
  title: string;
  language: string;
  status: string;
  master_cv_id: string;
  job_id: string | null;
  job_company_name: string | null;
  job_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardJobItem {
  id: string;
  company_name: string;
  job_title: string;
  status: JobStatus;
  tailored_cv_id: string | null;
  tailored_cv_title: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

export interface DashboardJobStatusCounts {
  saved: number;
  applied: number;
  interview: number;
  offer: number;
  rejected: number;
  archived: number;
}

export interface DashboardMasterCvSummary {
  total_count: number;
  primary_master_cv: DashboardMasterCvItem | null;
}

export interface DashboardTailoredCvSummary {
  total_count: number;
  recent_items: DashboardTailoredCvItem[];
}

export interface DashboardJobsSummary {
  total_count: number;
  counts_by_status: DashboardJobStatusCounts;
  recent_items: DashboardJobItem[];
}

export type DashboardActivityType =
  | "tailored_cv_created"
  | "tailored_cv_updated"
  | "ai_suggestion_applied"
  | "revision_restored"
  | "job_status_changed";

export interface DashboardResponseData {
  user_summary: DashboardUserSummary;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  entitlements: EntitlementSummary;
  master_cv_summary: DashboardMasterCvSummary;
  tailored_cv_summary: DashboardTailoredCvSummary;
  jobs_summary: DashboardJobsSummary;
  recent_activity: DashboardActivityItem[];
  locale: "en" | "tr";
  onboarding_completed: boolean;
}

export interface DashboardActivityItem {
  id: string;
  type: DashboardActivityType;
  message: string;
  timestamp: string;
  related_entity: {
    kind: "master_cv" | "tailored_cv" | "job" | "ai_suggestion" | "revision";
    id: string;
    title: string | null;
  };
}

export interface DashboardActivityResponseData {
  activity: DashboardActivityItem[];
}
