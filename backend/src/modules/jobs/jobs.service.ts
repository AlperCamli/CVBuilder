import { NotFoundError } from "../../shared/errors/app-error";
import type { JobRecord } from "../../shared/types/domain";
import type { JobsRepository } from "./jobs.repository";
import type { CreateJobInput, JobDetail, SessionContext, UpdateJobInput } from "./jobs.types";

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

  async getJob(session: SessionContext, jobId: string): Promise<JobDetail> {
    const row = await this.requireJob(session.appUser.id, jobId);
    return this.toDetail(row);
  }

  async updateJob(session: SessionContext, jobId: string, input: UpdateJobInput): Promise<JobDetail> {
    const existing = await this.requireJob(session.appUser.id, jobId);
    let appliedAt: string | null | undefined;

    if (input.status === "applied") {
      appliedAt = existing.applied_at ?? new Date().toISOString();
    } else if (input.status !== undefined) {
      appliedAt = null;
    }

    const payload = {
      ...input,
      applied_at: appliedAt
    };

    const updated = await this.jobsRepository.updateById(session.appUser.id, jobId, payload);

    if (!updated) {
      throw new NotFoundError("Job was not found");
    }

    return this.toDetail(updated);
  }

  private async requireJob(userId: string, jobId: string): Promise<JobRecord> {
    const row = await this.jobsRepository.findById(userId, jobId);

    if (!row) {
      throw new NotFoundError("Job was not found");
    }

    return row;
  }

  private toDetail(row: JobRecord): JobDetail {
    return {
      id: row.id,
      company_name: row.company_name,
      job_title: row.job_title,
      job_description: row.job_description,
      job_posting_url: row.job_posting_url,
      location_text: row.location_text,
      status: row.status,
      notes: row.notes,
      applied_at: row.applied_at,
      tailored_cv_id: row.tailored_cv_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
