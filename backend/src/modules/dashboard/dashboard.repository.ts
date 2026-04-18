import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type {
  DashboardActivityItem,
  DashboardJobItem,
  DashboardJobStatusCounts,
  DashboardMasterCvItem,
  DashboardTailoredCvItem
} from "./dashboard.types";

export interface DashboardSummarySnapshot {
  master_total_count: number;
  primary_master_cv: DashboardMasterCvItem | null;
  tailored_total_count: number;
  recent_tailored_cvs: DashboardTailoredCvItem[];
  jobs_total_count: number;
  jobs_counts_by_status: DashboardJobStatusCounts;
  recent_jobs: DashboardJobItem[];
}

export interface DashboardRepository {
  getSummarySnapshot(userId: string): Promise<DashboardSummarySnapshot>;
  getRecentActivity(userId: string, limit: number): Promise<DashboardActivityItem[]>;
}

const createEmptyJobStatusCounts = (): DashboardJobStatusCounts => {
  return {
    saved: 0,
    applied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    archived: 0
  };
};

const parseTimestamp = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export class SupabaseDashboardRepository implements DashboardRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async getSummarySnapshot(userId: string): Promise<DashboardSummarySnapshot> {
    const [
      masterCountResult,
      primaryMasterResult,
      tailoredCountResult,
      recentTailoredResult,
      jobsStatusResult,
      recentJobsResult
    ] = await Promise.all([
      this.supabaseClient
        .from("master_cvs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_deleted", false),
      this.supabaseClient
        .from("master_cvs")
        .select("id,title,language,template_id,source_type,created_at,updated_at")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabaseClient
        .from("tailored_cvs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_deleted", false),
      this.supabaseClient
        .from("tailored_cvs")
        .select("id,title,language,status,master_cv_id,job_id,created_at,updated_at")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("updated_at", { ascending: false })
        .limit(6),
      this.supabaseClient.from("jobs").select("status").eq("user_id", userId),
      this.supabaseClient
        .from("jobs")
        .select(
          "id,company_name,job_title,status,tailored_cv_id,created_at,updated_at,applied_at,tailored_cv:tailored_cvs!jobs_tailored_cv_id_fkey(id,title)"
        )
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(8)
    ]);

    if (masterCountResult.error) {
      throw new InternalServerError("Failed to aggregate dashboard master CV count", {
        reason: masterCountResult.error.message
      });
    }

    if (primaryMasterResult.error) {
      throw new InternalServerError("Failed to load latest master CV", {
        reason: primaryMasterResult.error.message
      });
    }

    if (tailoredCountResult.error) {
      throw new InternalServerError("Failed to aggregate dashboard tailored CV count", {
        reason: tailoredCountResult.error.message
      });
    }

    if (recentTailoredResult.error) {
      throw new InternalServerError("Failed to load recent tailored CVs", {
        reason: recentTailoredResult.error.message
      });
    }

    if (jobsStatusResult.error) {
      throw new InternalServerError("Failed to aggregate dashboard jobs", {
        reason: jobsStatusResult.error.message
      });
    }

    if (recentJobsResult.error) {
      throw new InternalServerError("Failed to load recent jobs", {
        reason: recentJobsResult.error.message
      });
    }

    const recentTailoredRows = (recentTailoredResult.data ?? []) as Array<Record<string, unknown>>;
    const recentTailoredByJobId = new Map<string, DashboardTailoredCvItem>();
    for (const row of recentTailoredRows) {
      const jobId = row.job_id ? String(row.job_id) : null;
      if (!jobId) {
        continue;
      }

      recentTailoredByJobId.set(jobId, {
        id: String(row.id),
        title: String(row.title),
        language: String(row.language),
        status: String(row.status),
        master_cv_id: String(row.master_cv_id),
        job_id: jobId,
        job_company_name: null,
        job_title: null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at)
      });
    }

    if (recentTailoredByJobId.size > 0) {
      const jobIds = [...recentTailoredByJobId.keys()];
      const jobsForTailored = await this.supabaseClient
        .from("jobs")
        .select("id,company_name,job_title")
        .eq("user_id", userId)
        .in("id", jobIds);

      if (jobsForTailored.error) {
        throw new InternalServerError("Failed to enrich recent tailored CV jobs", {
          reason: jobsForTailored.error.message
        });
      }

      for (const row of (jobsForTailored.data ?? []) as Array<Record<string, unknown>>) {
        const jobId = String(row.id);
        const tailored = recentTailoredByJobId.get(jobId);
        if (!tailored) {
          continue;
        }

        tailored.job_company_name = String(row.company_name);
        tailored.job_title = String(row.job_title);
      }
    }

    const recentTailored = recentTailoredRows.map((row) => {
      const jobId = row.job_id ? String(row.job_id) : null;
      const enriched = jobId ? recentTailoredByJobId.get(jobId) : null;

      return {
        id: String(row.id),
        title: String(row.title),
        language: String(row.language),
        status: String(row.status),
        master_cv_id: String(row.master_cv_id),
        job_id: jobId,
        job_company_name: enriched?.job_company_name ?? null,
        job_title: enriched?.job_title ?? null,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at)
      };
    });

    const jobsStatusRows = (jobsStatusResult.data ?? []) as Array<Record<string, unknown>>;
    const countsByStatus = createEmptyJobStatusCounts();
    for (const row of jobsStatusRows) {
      const status = String(row.status) as keyof DashboardJobStatusCounts;
      if (status in countsByStatus) {
        countsByStatus[status] += 1;
      }
    }

    const recentJobs = ((recentJobsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const tailoredValue = row.tailored_cv;
      let tailoredTitle: string | null = null;

      if (tailoredValue && typeof tailoredValue === "object") {
        if (Array.isArray(tailoredValue)) {
          const first = tailoredValue[0];
          if (first && typeof first === "object" && (first as Record<string, unknown>).title) {
            tailoredTitle = String((first as Record<string, unknown>).title);
          }
        } else if ((tailoredValue as Record<string, unknown>).title) {
          tailoredTitle = String((tailoredValue as Record<string, unknown>).title);
        }
      }

      return {
        id: String(row.id),
        company_name: String(row.company_name),
        job_title: String(row.job_title),
        status: String(row.status) as DashboardJobItem["status"],
        tailored_cv_id: row.tailored_cv_id ? String(row.tailored_cv_id) : null,
        tailored_cv_title: tailoredTitle,
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        applied_at: (row.applied_at as string | null) ?? null
      };
    });

    return {
      master_total_count: masterCountResult.count ?? 0,
      primary_master_cv: primaryMasterResult.data
        ? {
            id: String(primaryMasterResult.data.id),
            title: String(primaryMasterResult.data.title),
            language: String(primaryMasterResult.data.language),
            template_id: primaryMasterResult.data.template_id
              ? String(primaryMasterResult.data.template_id)
              : null,
            source_type: String(primaryMasterResult.data.source_type),
            created_at: String(primaryMasterResult.data.created_at),
            updated_at: String(primaryMasterResult.data.updated_at)
          }
        : null,
      tailored_total_count: tailoredCountResult.count ?? 0,
      recent_tailored_cvs: recentTailored,
      jobs_total_count: jobsStatusRows.length,
      jobs_counts_by_status: countsByStatus,
      recent_jobs: recentJobs
    };
  }

  async getRecentActivity(userId: string, limit: number): Promise<DashboardActivityItem[]> {
    const [tailoredRowsResult, appliedSuggestionResult, restoredRevisionResult, statusHistoryResult] =
      await Promise.all([
        this.supabaseClient
          .from("tailored_cvs")
          .select("id,title,created_at,updated_at")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .order("updated_at", { ascending: false })
          .limit(20),
        this.supabaseClient
          .from("ai_suggestions")
          .select("id,tailored_cv_id,applied_at,status")
          .eq("user_id", userId)
          .eq("status", "applied")
          .order("applied_at", { ascending: false })
          .limit(12),
        this.supabaseClient
          .from("cv_block_revisions")
          .select("id,tailored_cv_id,created_at,change_source")
          .eq("user_id", userId)
          .eq("change_source", "restore")
          .order("created_at", { ascending: false })
          .limit(12),
        this.supabaseClient
          .from("job_status_history")
          .select("id,job_id,from_status,to_status,changed_at")
          .order("changed_at", { ascending: false })
          .limit(40)
      ]);

    if (tailoredRowsResult.error) {
      throw new InternalServerError("Failed to load tailored CV activity", {
        reason: tailoredRowsResult.error.message
      });
    }

    if (appliedSuggestionResult.error) {
      throw new InternalServerError("Failed to load AI suggestion activity", {
        reason: appliedSuggestionResult.error.message
      });
    }

    if (restoredRevisionResult.error) {
      throw new InternalServerError("Failed to load revision activity", {
        reason: restoredRevisionResult.error.message
      });
    }

    if (statusHistoryResult.error) {
      throw new InternalServerError("Failed to load job status activity", {
        reason: statusHistoryResult.error.message
      });
    }

    const activity: DashboardActivityItem[] = [];

    for (const row of (tailoredRowsResult.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const title = String(row.title);
      const createdAt = String(row.created_at);
      const updatedAt = String(row.updated_at);
      const isUpdated = parseTimestamp(updatedAt) > parseTimestamp(createdAt);

      activity.push({
        id: `tailored:${id}:${isUpdated ? "updated" : "created"}`,
        type: isUpdated ? "tailored_cv_updated" : "tailored_cv_created",
        message: isUpdated ? "Tailored CV updated" : "Tailored CV created",
        timestamp: isUpdated ? updatedAt : createdAt,
        related_entity: {
          kind: "tailored_cv",
          id,
          title
        }
      });
    }

    for (const row of (appliedSuggestionResult.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const timestamp = row.applied_at ? String(row.applied_at) : null;
      if (!timestamp) {
        continue;
      }

      const tailoredCvId = String(row.tailored_cv_id);
      activity.push({
        id: `suggestion:${id}`,
        type: "ai_suggestion_applied",
        message: "AI suggestion applied",
        timestamp,
        related_entity: {
          kind: "ai_suggestion",
          id,
          title: tailoredCvId
        }
      });
    }

    for (const row of (restoredRevisionResult.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const tailoredCvId = row.tailored_cv_id ? String(row.tailored_cv_id) : null;

      activity.push({
        id: `revision:${id}`,
        type: "revision_restored",
        message: "Block revision restored",
        timestamp: String(row.created_at),
        related_entity: {
          kind: "revision",
          id,
          title: tailoredCvId
        }
      });
    }

    const historyRows = (statusHistoryResult.data ?? []) as Array<Record<string, unknown>>;
    const historyJobIds = [...new Set(historyRows.map((row) => String(row.job_id)))];
    const jobsById = new Map<string, { company_name: string; job_title: string }>();

    if (historyJobIds.length > 0) {
      const jobsResult = await this.supabaseClient
        .from("jobs")
        .select("id,company_name,job_title")
        .eq("user_id", userId)
        .in("id", historyJobIds);

      if (jobsResult.error) {
        throw new InternalServerError("Failed to load jobs for status activity", {
          reason: jobsResult.error.message
        });
      }

      for (const row of (jobsResult.data ?? []) as Array<Record<string, unknown>>) {
        jobsById.set(String(row.id), {
          company_name: String(row.company_name),
          job_title: String(row.job_title)
        });
      }
    }

    for (const row of historyRows) {
      const jobId = String(row.job_id);
      const job = jobsById.get(jobId);

      if (!job) {
        continue;
      }

      const fromStatus = (row.from_status as string | null) ?? "none";
      const toStatus = String(row.to_status);
      activity.push({
        id: `job-status:${String(row.id)}`,
        type: "job_status_changed",
        message: `Job status changed (${fromStatus} -> ${toStatus})`,
        timestamp: String(row.changed_at),
        related_entity: {
          kind: "job",
          id: jobId,
          title: `${job.company_name} - ${job.job_title}`
        }
      });
    }

    return activity
      .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))
      .slice(0, limit);
  }
}
