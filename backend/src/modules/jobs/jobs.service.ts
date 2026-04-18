import { NotFoundError } from "../../shared/errors/app-error";
import type { JobRecord, JobStatus, JobStatusHistoryRecord } from "../../shared/types/domain";
import type { JobWithTailoredRecord, JobsRepository } from "./jobs.repository";
import type {
  CreateJobInput,
  JobBoardResponse,
  JobDetail,
  JobHistoryItem,
  JobHistoryResponse,
  JobStatusCounts,
  JobSummary,
  ListJobsBoardInput,
  ListJobsInput,
  ListJobsResponse,
  SessionContext,
  UpdateJobInput,
  UpdateJobStatusInput,
  UpdateJobStatusResponse
} from "./jobs.types";

const JOB_STATUS_ORDER: JobStatus[] = [
  "saved",
  "applied",
  "interview",
  "offer",
  "rejected",
  "archived"
];

export class JobsService {
  constructor(private readonly jobsRepository: JobsRepository) {}

  async createJobForUser(userId: string, input: CreateJobInput, tailoredCvId?: string | null): Promise<JobRecord> {
    const shouldSetAppliedAt = input.status === "applied";

    return this.jobsRepository.create({
      user_id: userId,
      tailored_cv_id: tailoredCvId ?? null,
      company_name: input.company_name,
      job_title: input.job_title,
      job_description: input.job_description,
      job_posting_url: input.job_posting_url ?? null,
      location_text: input.location_text ?? null,
      notes: input.notes ?? null,
      status: input.status ?? "saved",
      applied_at: shouldSetAppliedAt ? new Date().toISOString() : null
    });
  }

  async linkTailoredCv(userId: string, jobId: string, tailoredCvId: string): Promise<JobRecord> {
    const linked = await this.jobsRepository.linkTailoredCv(userId, jobId, tailoredCvId);

    if (!linked) {
      throw new NotFoundError("Job was not found");
    }

    return linked;
  }

  async listJobs(session: SessionContext, input: ListJobsInput): Promise<ListJobsResponse> {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;

    const result = await this.jobsRepository.listByUser(session.appUser.id, {
      status: input.status,
      search: input.search,
      sort_by: input.sort_by,
      sort_order: input.sort_order,
      linked_tailored_cv: input.linked_tailored_cv,
      page,
      limit
    });

    return {
      items: result.rows.map((row) => this.toSummary(row)),
      page,
      limit,
      total: result.total
    };
  }

  async getJobsBoard(session: SessionContext, input: ListJobsBoardInput): Promise<JobBoardResponse> {
    const rows = await this.jobsRepository.listForBoard(session.appUser.id, {
      search: input.search,
      sort_by: input.sort_by,
      sort_order: input.sort_order,
      linked_tailored_cv: input.linked_tailored_cv
    });

    const countsByStatus = this.createEmptyStatusCounts();
    for (const row of rows) {
      countsByStatus[row.status] += 1;
    }

    return {
      groups: JOB_STATUS_ORDER.map((status) => ({
        status,
        count: countsByStatus[status],
        items: rows.filter((row) => row.status === status).map((row) => this.toSummary(row))
      })),
      counts_by_status: countsByStatus,
      total: rows.length
    };
  }

  async getJob(session: SessionContext, jobId: string): Promise<JobDetail> {
    const row = await this.requireJobDetail(session.appUser.id, jobId);
    return this.toDetail(row);
  }

  async updateJob(session: SessionContext, jobId: string, input: UpdateJobInput): Promise<JobDetail> {
    await this.requireJob(session.appUser.id, jobId);
    const updated = await this.jobsRepository.updateById(session.appUser.id, jobId, input);

    if (!updated) {
      throw new NotFoundError("Job was not found");
    }

    const detail = await this.jobsRepository.findDetailById(session.appUser.id, updated.id);
    if (!detail) {
      throw new NotFoundError("Job was not found");
    }

    return this.toDetail(detail);
  }

  async updateJobStatus(
    session: SessionContext,
    jobId: string,
    input: UpdateJobStatusInput
  ): Promise<UpdateJobStatusResponse> {
    const existing = await this.requireJobDetail(session.appUser.id, jobId);
    const isStatusChanged = existing.status !== input.status;

    if (!isStatusChanged) {
      return {
        job: this.toDetail(existing),
        status_history_entry: null
      };
    }

    const changedAt = new Date().toISOString();
    const nextAppliedAt = input.status === "applied" ? existing.applied_at ?? changedAt : existing.applied_at;

    const updated = await this.jobsRepository.updateById(session.appUser.id, jobId, {
      status: input.status,
      applied_at: nextAppliedAt
    });

    if (!updated) {
      throw new NotFoundError("Job was not found");
    }

    const history = await this.jobsRepository.createStatusHistory({
      job_id: jobId,
      from_status: existing.status,
      to_status: input.status,
      changed_at: changedAt,
      changed_by_user_id: session.appUser.id
    });

    const detail = await this.jobsRepository.findDetailById(session.appUser.id, jobId);
    if (!detail) {
      throw new NotFoundError("Job was not found");
    }

    return {
      job: this.toDetail(detail),
      status_history_entry: this.toHistoryItem(history)
    };
  }

  async getJobHistory(session: SessionContext, jobId: string): Promise<JobHistoryResponse> {
    const job = await this.requireJob(session.appUser.id, jobId);
    const history = await this.jobsRepository.listStatusHistory(job.id, 50);

    return {
      job_id: job.id,
      current_status: job.status,
      current_status_updated_at: job.updated_at,
      history: history.map((item) => this.toHistoryItem(item))
    };
  }

  private async requireJob(userId: string, jobId: string): Promise<JobRecord> {
    const row = await this.jobsRepository.findById(userId, jobId);

    if (!row) {
      throw new NotFoundError("Job was not found");
    }

    return row;
  }

  private async requireJobDetail(userId: string, jobId: string): Promise<JobWithTailoredRecord> {
    const row = await this.jobsRepository.findDetailById(userId, jobId);

    if (!row) {
      throw new NotFoundError("Job was not found");
    }

    return row;
  }

  private toSummary(row: JobWithTailoredRecord): JobSummary {
    return {
      id: row.id,
      company_name: row.company_name,
      job_title: row.job_title,
      status: row.status,
      job_posting_url: row.job_posting_url ?? null,
      location_text: row.location_text ?? null,
      tailored_cv_id: row.tailored_cv_id,
      tailored_cv_title: row.tailored_cv_title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      applied_at: row.applied_at
    };
  }

  private toDetail(row: JobWithTailoredRecord): JobDetail {
    return {
      job: this.toSummary(row),
      job_description: row.job_description,
      notes: row.notes,
      linked_tailored_cv:
        row.tailored_cv_id && row.tailored_cv_title && row.tailored_cv_status && row.tailored_cv_updated_at
          ? {
              id: row.tailored_cv_id,
              title: row.tailored_cv_title,
              status: row.tailored_cv_status,
              updated_at: row.tailored_cv_updated_at
            }
          : null,
      status_last_changed_at: row.updated_at
    };
  }

  private toHistoryItem(item: JobStatusHistoryRecord): JobHistoryItem {
    return {
      id: item.id,
      from_status: item.from_status,
      to_status: item.to_status,
      changed_at: item.changed_at,
      changed_by_user_id: item.changed_by_user_id
    };
  }

  private createEmptyStatusCounts(): JobStatusCounts {
    return {
      saved: 0,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      archived: 0
    };
  }
}
