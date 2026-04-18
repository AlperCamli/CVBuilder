import { NotFoundError } from "../../shared/errors/app-error";
import {
  buildCvPreview,
  cloneCvContent,
  normalizeCvContent,
  updateBlockInCvContent
} from "../../shared/cv-content/cv-content.utils";
import type { JobRecord, MasterCvRecord, TailoredCvRecord } from "../../shared/types/domain";
import type { CvRevisionsService } from "../cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../jobs/jobs.repository";
import type { MasterCvRepository } from "../master-cv/master-cv.repository";
import type { RenderingService } from "../rendering/rendering.service";
import type { TemplatesService } from "../templates/templates.service";
import type { TailoredCvRepository } from "./tailored-cv.repository";
import type {
  CreateTailoredCvInput,
  ReplaceTailoredCvContentInput,
  SessionContext,
  TailoredCvBlockUpdateResponse,
  TailoredCvDetail,
  TailoredCvListFilters,
  TailoredCvPreviewResponse,
  TailoredCvSourceMasterSummary,
  TailoredCvSourceResponse,
  TailoredCvSummary,
  UpdateTailoredCvBlockInput,
  UpdateTailoredCvInput
} from "./tailored-cv.types";

export class TailoredCvService {
  constructor(
    private readonly tailoredCvRepository: TailoredCvRepository,
    private readonly masterCvRepository: MasterCvRepository,
    private readonly jobsRepository: JobsRepository,
    private readonly cvRevisionsService: CvRevisionsService,
    private readonly templatesService: TemplatesService,
    private readonly renderingService: RenderingService
  ) {}

  async listTailoredCvs(
    session: SessionContext,
    filters: TailoredCvListFilters
  ): Promise<TailoredCvSummary[]> {
    const rows = await this.tailoredCvRepository.listByUser(session.appUser.id, {
      status: filters.status,
      sort_order: filters.sort_order
    });

    const jobsById = await this.loadJobsById(session.appUser.id, rows);
    const companyNameFilter = filters.company_name?.toLowerCase();

    const filteredRows = companyNameFilter
      ? rows.filter((row) => {
          const job = row.job_id ? jobsById.get(row.job_id) : null;

          if (!job) {
            return false;
          }

          return job.company_name.toLowerCase().includes(companyNameFilter);
        })
      : rows;

    return filteredRows.map((row) => this.toSummary(row, row.job_id ? jobsById.get(row.job_id) ?? null : null));
  }

  async createTailoredCv(session: SessionContext, input: CreateTailoredCvInput): Promise<TailoredCvDetail> {
    const sourceMasterCv = await this.requireSourceMasterCv(session.appUser.id, input.master_cv_id);
    const validatedTemplateId =
      input.template_id !== undefined
        ? await this.templatesService.validateAssignableTemplateId(input.template_id)
        : sourceMasterCv.template_id;

    const createdJob = await this.jobsRepository.create({
      user_id: session.appUser.id,
      tailored_cv_id: null,
      company_name: input.job.company_name,
      job_title: input.job.job_title,
      job_description: input.job.job_description,
      job_posting_url: input.job.job_posting_url ?? null,
      location_text: input.job.location_text ?? null,
      notes: input.job.notes ?? null,
      status: "saved",
      applied_at: null
    });

    const clonedContent = cloneCvContent(sourceMasterCv.current_content);
    const language = input.language ?? sourceMasterCv.language;
    clonedContent.language = language;

    const createdTailoredCv = await this.tailoredCvRepository.create({
      user_id: session.appUser.id,
      master_cv_id: sourceMasterCv.id,
      job_id: createdJob.id,
      title: input.title?.trim() || `${sourceMasterCv.title} - ${createdJob.company_name}`,
      language,
      template_id: validatedTemplateId,
      current_content: clonedContent,
      status: "draft",
      ai_generation_status: null,
      last_exported_at: null
    });

    const linkedJob = await this.jobsRepository.linkTailoredCv(
      session.appUser.id,
      createdJob.id,
      createdTailoredCv.id
    );

    const sourceSummary = this.toSourceMasterSummary(sourceMasterCv);

    return this.toDetail(createdTailoredCv, linkedJob ?? createdJob, sourceSummary);
  }

  async getTailoredCv(session: SessionContext, tailoredCvId: string): Promise<TailoredCvDetail> {
    const row = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const linkedJob = row.job_id ? await this.jobsRepository.findById(session.appUser.id, row.job_id) : null;
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, row.master_cv_id);

    return this.toDetail(row, linkedJob, sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null);
  }

  async updateTailoredCv(
    session: SessionContext,
    tailoredCvId: string,
    input: UpdateTailoredCvInput
  ): Promise<TailoredCvDetail> {
    const existing = await this.requireTailoredCv(session.appUser.id, tailoredCvId);

    const updatePayload: {
      title?: string;
      language?: string;
      template_id?: string | null;
      status?: TailoredCvRecord["status"];
      current_content?: TailoredCvRecord["current_content"];
    } = {
      title: input.title,
      language: input.language,
      status: input.status
    };

    if (input.template_id !== undefined) {
      updatePayload.template_id = await this.templatesService.validateAssignableTemplateId(
        input.template_id
      );
    }

    if (input.language && input.language !== existing.current_content.language) {
      const nextContent = cloneCvContent(existing.current_content);
      nextContent.language = input.language;
      updatePayload.current_content = nextContent;
    }

    const updated = await this.tailoredCvRepository.updateById(
      session.appUser.id,
      tailoredCvId,
      updatePayload
    );

    if (!updated) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const linkedJob = updated.job_id
      ? await this.jobsRepository.findById(session.appUser.id, updated.job_id)
      : null;
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, updated.master_cv_id);

    return this.toDetail(updated, linkedJob, sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null);
  }

  async replaceTailoredCvContent(
    session: SessionContext,
    tailoredCvId: string,
    input: ReplaceTailoredCvContentInput
  ): Promise<TailoredCvDetail> {
    const existing = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const content = normalizeCvContent(input.current_content, existing.language);

    const updated = await this.tailoredCvRepository.updateById(session.appUser.id, tailoredCvId, {
      current_content: content,
      language: content.language,
      ai_generation_status: existing.ai_generation_status
    });

    if (!updated) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const linkedJob = updated.job_id
      ? await this.jobsRepository.findById(session.appUser.id, updated.job_id)
      : null;
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, updated.master_cv_id);

    return this.toDetail(updated, linkedJob, sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null);
  }

  async updateTailoredCvBlock(
    session: SessionContext,
    tailoredCvId: string,
    blockId: string,
    input: UpdateTailoredCvBlockInput
  ): Promise<TailoredCvBlockUpdateResponse> {
    const existing = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const patchResult = updateBlockInCvContent(existing.current_content, blockId, input);

    const updated = await this.tailoredCvRepository.updateById(session.appUser.id, tailoredCvId, {
      current_content: patchResult.content
    });

    if (!updated) {
      throw new NotFoundError("Tailored CV was not found");
    }

    await this.cvRevisionsService.createTailoredBlockRevision({
      user_id: session.appUser.id,
      tailored_cv_id: updated.id,
      block: patchResult.updated_block,
      change_source: "manual",
      created_by_user_id: session.appUser.id
    });

    const linkedJob = updated.job_id
      ? await this.jobsRepository.findById(session.appUser.id, updated.job_id)
      : null;
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, updated.master_cv_id);

    return {
      tailored_cv: this.toDetail(
        updated,
        linkedJob,
        sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null
      ),
      updated_block: patchResult.updated_block,
      section_id: patchResult.section_id
    };
  }

  async deleteTailoredCv(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<{ id: string; is_deleted: true }> {
    const deleted = await this.tailoredCvRepository.softDelete(session.appUser.id, tailoredCvId);

    if (!deleted) {
      throw new NotFoundError("Tailored CV was not found");
    }

    return {
      id: tailoredCvId,
      is_deleted: true
    };
  }

  async assignTemplate(
    session: SessionContext,
    tailoredCvId: string,
    templateId: string | null
  ): Promise<TailoredCvDetail> {
    await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const validatedTemplateId = await this.templatesService.validateAssignableTemplateId(templateId);

    const updated = await this.tailoredCvRepository.updateById(session.appUser.id, tailoredCvId, {
      template_id: validatedTemplateId
    });

    if (!updated) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const linkedJob = updated.job_id
      ? await this.jobsRepository.findById(session.appUser.id, updated.job_id)
      : null;
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, updated.master_cv_id);

    return this.toDetail(updated, linkedJob, sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null);
  }

  async getTailoredCvPreview(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<TailoredCvPreviewResponse> {
    const row = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const linkedJob = row.job_id ? await this.jobsRepository.findById(session.appUser.id, row.job_id) : null;
    const renderingResult = await this.renderingService.buildRendering({
      cv_kind: "tailored",
      current_content: row.current_content,
      template_id: row.template_id,
      language: row.language,
      document: {
        id: row.id,
        title: row.title,
        updated_at: row.updated_at
      },
      context: {
        status: row.status,
        master_cv_id: row.master_cv_id,
        job_id: row.job_id
      },
      allow_inactive_selected_template: true
    });

    return {
      cv: {
        id: row.id,
        title: row.title,
        language: row.language,
        status: row.status,
        master_cv_id: row.master_cv_id,
        job_id: row.job_id,
        template_id: row.template_id,
        updated_at: row.updated_at
      },
      linked_job: linkedJob ? this.toJobSummary(linkedJob) : null,
      current_content: row.current_content,
      preview: buildCvPreview(row.current_content),
      selected_template: renderingResult.resolved_template,
      rendering: renderingResult.rendering
    };
  }

  async getTailoredCvSource(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<TailoredCvSourceResponse> {
    const row = await this.requireTailoredCv(session.appUser.id, tailoredCvId);
    const sourceMaster = await this.masterCvRepository.findAnyById(session.appUser.id, row.master_cv_id);
    const linkedJob = row.job_id ? await this.jobsRepository.findById(session.appUser.id, row.job_id) : null;

    return {
      tailored_cv_id: row.id,
      master_cv_id: row.master_cv_id,
      master_cv: sourceMaster ? this.toSourceMasterSummary(sourceMaster) : null,
      job: linkedJob ? this.toJobSummary(linkedJob) : null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string): Promise<TailoredCvRecord> {
    const row = await this.tailoredCvRepository.findById(userId, tailoredCvId);

    if (!row) {
      throw new NotFoundError("Tailored CV was not found");
    }

    return row;
  }

  private async requireSourceMasterCv(userId: string, masterCvId: string): Promise<MasterCvRecord> {
    const row = await this.masterCvRepository.findById(userId, masterCvId);

    if (!row) {
      throw new NotFoundError("Source master CV was not found");
    }

    return row;
  }

  private async loadJobsById(userId: string, rows: TailoredCvRecord[]): Promise<Map<string, JobRecord>> {
    const jobIds = rows
      .map((row) => row.job_id)
      .filter((jobId): jobId is string => Boolean(jobId));

    const jobs = await this.jobsRepository.findByIds(userId, jobIds);
    return new Map(jobs.map((job) => [job.id, job]));
  }

  private toSummary(row: TailoredCvRecord, job: JobRecord | null): TailoredCvSummary {
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      status: row.status,
      master_cv_id: row.master_cv_id,
      job_id: row.job_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      job: job ? this.toJobSummary(job) : null
    };
  }

  private toDetail(
    row: TailoredCvRecord,
    job: JobRecord | null,
    sourceMaster: TailoredCvSourceMasterSummary | null
  ): TailoredCvDetail {
    return {
      ...this.toSummary(row, job),
      template_id: row.template_id,
      ai_generation_status: row.ai_generation_status,
      last_exported_at: row.last_exported_at,
      current_content: row.current_content,
      preview: buildCvPreview(row.current_content),
      source_master_cv: sourceMaster
    };
  }

  private toJobSummary(job: JobRecord) {
    return {
      id: job.id,
      company_name: job.company_name,
      job_title: job.job_title,
      status: job.status
    };
  }

  private toSourceMasterSummary(masterCv: MasterCvRecord): TailoredCvSourceMasterSummary {
    return {
      id: masterCv.id,
      title: masterCv.title,
      language: masterCv.language,
      template_id: masterCv.template_id,
      updated_at: masterCv.updated_at
    };
  }
}
