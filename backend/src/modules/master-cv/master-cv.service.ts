import { NotFoundError } from "../../shared/errors/app-error";
import {
  buildCvPreview,
  buildCvSummaryText,
  cloneCvContent,
  createEmptyCvContent,
  normalizeCvContent,
  updateBlockInCvContent
} from "../../shared/cv-content/cv-content.utils";
import type { MasterCvRecord } from "../../shared/types/domain";
import type { RenderingService } from "../rendering/rendering.service";
import type { TemplatesService } from "../templates/templates.service";
import type { MasterCvRepository } from "./master-cv.repository";
import type {
  CreateMasterCvInput,
  MasterCvBlockUpdateResponse,
  MasterCvDetail,
  MasterCvPreviewResponse,
  MasterCvSummary,
  ReplaceMasterCvContentInput,
  SessionContext,
  UpdateMasterCvBlockInput,
  UpdateMasterCvInput
} from "./master-cv.types";

export class MasterCvService {
  constructor(
    private readonly masterCvRepository: MasterCvRepository,
    private readonly templatesService: TemplatesService,
    private readonly renderingService: RenderingService
  ) {}

  async listMasterCvs(session: SessionContext): Promise<MasterCvSummary[]> {
    const rows = await this.masterCvRepository.listByUser(session.appUser.id);
    return rows.map((row) => this.toSummary(row));
  }

  async createMasterCv(session: SessionContext, input: CreateMasterCvInput): Promise<MasterCvDetail> {
    const templateId =
      input.template_id !== undefined
        ? await this.templatesService.validateAssignableTemplateId(input.template_id)
        : null;

    const content = input.current_content
      ? normalizeCvContent(input.current_content, input.language)
      : createEmptyCvContent(input.language);

    const created = await this.masterCvRepository.create({
      user_id: session.appUser.id,
      title: input.title,
      language: content.language,
      template_id: templateId,
      current_content: content,
      summary_text: buildCvSummaryText(content),
      source_type: "scratch"
    });

    return this.toDetail(created);
  }

  async getMasterCv(session: SessionContext, masterCvId: string): Promise<MasterCvDetail> {
    const row = await this.requireMasterCv(session.appUser.id, masterCvId);
    return this.toDetail(row);
  }

  async updateMasterCv(
    session: SessionContext,
    masterCvId: string,
    input: UpdateMasterCvInput
  ): Promise<MasterCvDetail> {
    const existing = await this.requireMasterCv(session.appUser.id, masterCvId);

    const updatePayload: {
      title?: string;
      language?: string;
      template_id?: string | null;
      summary_text?: string | null;
      current_content?: ReturnType<typeof cloneCvContent>;
    } = {
      title: input.title,
      language: input.language,
      summary_text: input.summary_text
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

    const updated = await this.masterCvRepository.updateById(session.appUser.id, masterCvId, updatePayload);

    if (!updated) {
      throw new NotFoundError("Master CV was not found");
    }

    return this.toDetail(updated);
  }

  async assignTemplate(
    session: SessionContext,
    masterCvId: string,
    templateId: string | null
  ): Promise<MasterCvDetail> {
    await this.requireMasterCv(session.appUser.id, masterCvId);
    const validatedTemplateId = await this.templatesService.validateAssignableTemplateId(templateId);

    const updated = await this.masterCvRepository.updateById(session.appUser.id, masterCvId, {
      template_id: validatedTemplateId
    });

    if (!updated) {
      throw new NotFoundError("Master CV was not found");
    }

    return this.toDetail(updated);
  }

  async replaceMasterCvContent(
    session: SessionContext,
    masterCvId: string,
    input: ReplaceMasterCvContentInput
  ): Promise<MasterCvDetail> {
    const existing = await this.requireMasterCv(session.appUser.id, masterCvId);
    const content = normalizeCvContent(input.current_content, existing.language);

    const updated = await this.masterCvRepository.updateById(session.appUser.id, masterCvId, {
      current_content: content,
      summary_text: buildCvSummaryText(content),
      language: content.language
    });

    if (!updated) {
      throw new NotFoundError("Master CV was not found");
    }

    return this.toDetail(updated);
  }

  async updateMasterCvBlock(
    session: SessionContext,
    masterCvId: string,
    blockId: string,
    input: UpdateMasterCvBlockInput
  ): Promise<MasterCvBlockUpdateResponse> {
    const existing = await this.requireMasterCv(session.appUser.id, masterCvId);
    const patchResult = updateBlockInCvContent(existing.current_content, blockId, input);

    const updated = await this.masterCvRepository.updateById(session.appUser.id, masterCvId, {
      current_content: patchResult.content,
      summary_text: buildCvSummaryText(patchResult.content)
    });

    if (!updated) {
      throw new NotFoundError("Master CV was not found");
    }

    return {
      master_cv: this.toDetail(updated),
      updated_block: patchResult.updated_block,
      section_id: patchResult.section_id
    };
  }

  async duplicateMasterCv(session: SessionContext, masterCvId: string): Promise<MasterCvDetail> {
    const existing = await this.requireMasterCv(session.appUser.id, masterCvId);
    const copiedContent = cloneCvContent(existing.current_content);

    const created = await this.masterCvRepository.create({
      user_id: session.appUser.id,
      title: `${existing.title} (Copy)`,
      language: existing.language,
      template_id: existing.template_id,
      current_content: copiedContent,
      summary_text: existing.summary_text,
      source_type: existing.source_type
    });

    return this.toDetail(created);
  }

  async deleteMasterCv(session: SessionContext, masterCvId: string): Promise<{ id: string; is_deleted: true }> {
    const deleted = await this.masterCvRepository.softDelete(session.appUser.id, masterCvId);

    if (!deleted) {
      throw new NotFoundError("Master CV was not found");
    }

    return {
      id: masterCvId,
      is_deleted: true
    };
  }

  async getMasterCvPreview(session: SessionContext, masterCvId: string): Promise<MasterCvPreviewResponse> {
    const row = await this.requireMasterCv(session.appUser.id, masterCvId);
    const renderingResult = await this.renderingService.buildRendering({
      cv_kind: "master",
      current_content: row.current_content,
      template_id: row.template_id,
      language: row.language,
      document: {
        id: row.id,
        title: row.title,
        updated_at: row.updated_at
      },
      context: {
        source_type: row.source_type
      },
      allow_inactive_selected_template: true
    });

    return {
      cv: {
        id: row.id,
        title: row.title,
        language: row.language,
        source_type: row.source_type,
        template_id: row.template_id,
        updated_at: row.updated_at
      },
      current_content: row.current_content,
      preview: buildCvPreview(row.current_content),
      selected_template: renderingResult.resolved_template,
      rendering: renderingResult.rendering,
      presentation: renderingResult.presentation
    };
  }

  private async requireMasterCv(userId: string, masterCvId: string): Promise<MasterCvRecord> {
    const row = await this.masterCvRepository.findById(userId, masterCvId);

    if (!row) {
      throw new NotFoundError("Master CV was not found");
    }

    return row;
  }

  private toSummary(row: MasterCvRecord): MasterCvSummary {
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      source_type: row.source_type,
      template_id: row.template_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private toDetail(row: MasterCvRecord): MasterCvDetail {
    return {
      ...this.toSummary(row),
      summary_text: row.summary_text,
      current_content: row.current_content,
      preview: buildCvPreview(row.current_content)
    };
  }
}
