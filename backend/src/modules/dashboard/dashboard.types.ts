import type { CurrentPlanSummary, UsageSummary } from "../../shared/types/domain";

export interface DashboardCounts {
  master_cvs: number;
  tailored_cvs: number;
  jobs: number;
  exports: number;
}

export interface DashboardUserSummary {
  id: string;
  email: string;
  full_name: string | null;
}

export interface DashboardResponseData {
  user_summary: DashboardUserSummary;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  counts: DashboardCounts;
  locale: "en" | "tr";
  onboarding_completed: boolean;
}

export interface DashboardActivityItem {
  id: string;
  type: string;
  message: string;
  created_at: string;
}

export interface DashboardActivityResponseData {
  activity: DashboardActivityItem[];
}
