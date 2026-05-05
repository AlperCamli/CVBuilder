import {
  ExportGenerationFailedError,
  ExportNotReadyError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  type AppError
} from "../../shared/errors/app-error";
import type {
  ExportFormat,
  ExportRecord,
  FileRecord,
  MasterCvRecord,
  TailoredCvRecord
} from "../../shared/types/domain";
import type { FilesService } from "../files/files.service";
import type { RenderingService } from "../rendering/rendering.service";
import type { ResolvedTemplateSummary, TemplateSummary } from "../templates/templates.types";
import type { TemplatesService } from "../templates/templates.service";
import type { TailoredCvRepository } from "../tailored-cv/tailored-cv.repository";
import type { MasterCvRepository } from "../master-cv/master-cv.repository";
import type { BillingService } from "../billing/billing.service";
import type { ExportsRepository } from "./exports.repository";
import type {
  CreateExportInput,
  ExportDetailResponse,
  ExportDownloadResponse,
  ExportFileSummary,
  ExportMasterCvSummary,
  ExportSummaryItem,
  ExportTailoredCvSummary,
  ListMasterCvExportsResponse,
  ListTailoredCvExportsResponse,
  SessionContext
} from "./exports.types";
import type { RenderingExportGenerator } from "./generators/rendering-export-generator";

const truncateErrorMessage = (value: string, maxLength = 500): string => {
  const normalized = value.trim();

  if (!normalized) {
    return "Export failed";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const isTemplateFormatEnabled = (template: TemplateSummary, format: ExportFormat): boolean => {
  const config = template.export_config;

  if (!config) {
    return true;
  }

  const formatConfig = config[format];

  if (typeof formatConfig === "boolean") {
    return formatConfig;
  }

  if (typeof formatConfig === "object" && formatConfig !== null) {
    const enabled = (formatConfig as Record<string, unknown>).enabled;
    if (typeof enabled === "boolean") {
      return enabled;
    }
  }

  return true;
};

const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.15;
const DEFAULT_FONT_SCALE = 1;
const SPACING_SCALE_MIN = 0.7;
const SPACING_SCALE_MAX = 1.4;
const DEFAULT_SPACING_SCALE = 1;
const LAYOUT_SCALE_MIN = 0.7;
const LAYOUT_SCALE_MAX = 1.3;
const DEFAULT_LAYOUT_SCALE = 1;

const fileExtensionByFormat: Record<ExportFormat, string> = {
  pdf: "pdf",
  docx: "docx"
};

const clampFontScale = (value: number): number => {
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
};

const parseFontScale = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampFontScale(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return clampFontScale(parsed);
    }
  }

  return null;
};

const clampInRange = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const parseScaleInRange = (value: unknown, min: number, max: number): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInRange(value, min, max);
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return clampInRange(parsed, min, max);
    }
  }

  return null;
};

const sanitizeFilenameSegment = (value: string): string => {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "cv";
  }

  return cleaned.slice(0, 80);
};

const buildExportDownloadFilename = (title: string | null | undefined, format: ExportFormat): string => {
  const safeTitle = sanitizeFilenameSegment(title ?? "").replace(/\.(pdf|docx)$/i, "");
  return `${safeTitle}.${fileExtensionByFormat[format]}`;
};

export class ExportsService {
  constructor(
    private readonly exportsRepository: ExportsRepository,
    private readonly tailoredCvRepository: TailoredCvRepository,
    private readonly masterCvRepository: MasterCvRepository,
    private readonly templatesService: TemplatesService,
    private readonly renderingService: RenderingService,
    private readonly filesService: FilesService,
    private readonly renderingExportGenerator: RenderingExportGenerator,
    private readonly billingService: BillingService
  ) {}

  async createPdfExport(
    session: SessionContext,
    tailoredCvId: string,
    input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    return this.createExportByFormat(
      session,
      {
        kind: "tailored",
        cv_id: tailoredCvId
      },
      "pdf",
      input
    );
  }

  async createDocxExport(
    session: SessionContext,
    tailoredCvId: string,
    input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    return this.createExportByFormat(
      session,
      {
        kind: "tailored",
        cv_id: tailoredCvId
      },
      "docx",
      input
    );
  }

  async createMasterCvPdfExport(
    session: SessionContext,
    masterCvId: string,
    input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    return this.createExportByFormat(
      session,
      {
        kind: "master",
        cv_id: masterCvId
      },
      "pdf",
      input
    );
  }

  async createMasterCvDocxExport(
    session: SessionContext,
    masterCvId: string,
    input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    return this.createExportByFormat(
      session,
      {
        kind: "master",
        cv_id: masterCvId
      },
      "docx",
      input
    );
  }

  async listTailoredCvExports(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<ListTailoredCvExportsResponse> {
    await this.requireTailoredCv(session.appUser.id, tailoredCvId);

    const exports = await this.exportsRepository.listByTailoredCv(session.appUser.id, tailoredCvId);

    return {
      tailored_cv_id: tailoredCvId,
      exports: exports.map((row) => this.toSummaryItem(row))
    };
  }

  async listMasterCvExports(
    session: SessionContext,
    masterCvId: string
  ): Promise<ListMasterCvExportsResponse> {
    await this.requireMasterCv(session.appUser.id, masterCvId);

    const exports = await this.exportsRepository.listByMasterCv(session.appUser.id, masterCvId);

    return {
      master_cv_id: masterCvId,
      exports: exports.map((row) => this.toSummaryItem(row))
    };
  }

  async getExportDetail(session: SessionContext, exportId: string): Promise<ExportDetailResponse> {
    const exportRow = await this.requireExport(session.appUser.id, exportId);
    const tailoredCv = exportRow.tailored_cv_id
      ? await this.tailoredCvRepository.findById(session.appUser.id, exportRow.tailored_cv_id)
      : null;
    const masterCv = exportRow.master_cv_id
      ? await this.masterCvRepository.findById(session.appUser.id, exportRow.master_cv_id)
      : null;

    const file = exportRow.file_id
      ? await this.filesService.findOwnedFileById(session.appUser.id, exportRow.file_id)
      : null;

    const template = exportRow.template_id
      ? await this.safeGetTemplate(session, exportRow.template_id)
      : null;

    let download = null;
    if (exportRow.status === "completed" && file) {
      const filename = buildExportDownloadFilename(
        tailoredCv?.title ?? masterCv?.title ?? file.original_filename,
        exportRow.format
      );
      download = await this.filesService.createSignedDownloadAccess(file, {
        forcedDownloadFilename: filename
      });
    }

    const resolvedTemplate: ResolvedTemplateSummary = template
      ? {
          resolution: "selected",
          template
        }
      : {
          resolution: "none",
          template: null
        };

    return this.toDetailResponse(exportRow, tailoredCv, masterCv, file, template, resolvedTemplate, download);
  }

  async getExportDownload(session: SessionContext, exportId: string): Promise<ExportDownloadResponse> {
    const exportRow = await this.requireExport(session.appUser.id, exportId);

    if (exportRow.status !== "completed" || !exportRow.file_id) {
      throw new ExportNotReadyError("Export is not ready for download", {
        export_id: exportRow.id,
        status: exportRow.status
      });
    }

    const file = await this.filesService.findOwnedFileById(session.appUser.id, exportRow.file_id);

    if (!file) {
      throw new NotFoundError("Export file metadata was not found", {
        export_id: exportRow.id,
        file_id: exportRow.file_id
      });
    }

    const cvTitle =
      exportRow.tailored_cv_id
        ? (await this.tailoredCvRepository.findById(session.appUser.id, exportRow.tailored_cv_id))?.title ?? null
        : exportRow.master_cv_id
          ? (await this.masterCvRepository.findById(session.appUser.id, exportRow.master_cv_id))?.title ?? null
          : null;

    const download = await this.filesService.createSignedDownloadAccess(file, {
      forcedDownloadFilename: buildExportDownloadFilename(
        cvTitle ?? file.original_filename,
        exportRow.format
      )
    });

    return {
      export_id: exportRow.id,
      format: exportRow.format,
      ...download
    };
  }

  private async createExportByFormat(
    session: SessionContext,
    target: { kind: "tailored" | "master"; cv_id: string },
    format: ExportFormat,
    input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    const userId = session.appUser.id;
    await this.billingService.assertActionAllowed(
      userId,
      format === "pdf" ? "export_pdf" : "export_docx"
    );

    const exportTarget =
      target.kind === "tailored"
        ? {
            kind: "tailored" as const,
            row: await this.requireTailoredCv(userId, target.cv_id)
          }
        : {
            kind: "master" as const,
            row: await this.requireMasterCv(userId, target.cv_id)
          };

    const selectedTemplateId =
      input.template_id !== undefined
        ? await this.templatesService.validateAssignableTemplateId(input.template_id)
        : exportTarget.row.template_id;

    const created = await this.exportsRepository.create({
      user_id: userId,
      master_cv_id: exportTarget.kind === "master" ? exportTarget.row.id : null,
      tailored_cv_id: exportTarget.kind === "tailored" ? exportTarget.row.id : null,
      format,
      status: "processing",
      file_id: null,
      template_id: null,
      error_message: null,
      completed_at: null
    });

    let uploadedStorage: { storage_bucket: string; storage_path: string } | null = null;
    let fileRecord: FileRecord | null = null;
    let resolvedTemplate: TemplateSummary | null = null;

    try {
      const renderingResult = await this.renderingService.buildRendering({
        cv_kind: exportTarget.kind,
        current_content: exportTarget.row.current_content,
        template_id: selectedTemplateId,
        language: exportTarget.row.language,
        document: {
          id: exportTarget.row.id,
          title: exportTarget.row.title,
          updated_at: exportTarget.row.updated_at
        },
        context:
          exportTarget.kind === "tailored"
            ? {
                ...exportTarget.row.current_content.metadata,
                status: exportTarget.row.status,
                master_cv_id: exportTarget.row.master_cv_id,
                job_id: exportTarget.row.job_id,
                last_export_id: created.id
              }
            : {
                ...exportTarget.row.current_content.metadata,
                source_type: exportTarget.row.source_type,
                last_export_id: created.id
              },
        allow_inactive_selected_template: true
      });

      resolvedTemplate = renderingResult.resolved_template.template;
      if (resolvedTemplate && !isTemplateFormatEnabled(resolvedTemplate, format)) {
        throw new ValidationError("Template does not support requested export format", {
          format,
          template_id: resolvedTemplate.id,
          template_slug: resolvedTemplate.slug
        });
      }

      const metadataScale = parseFontScale(exportTarget.row.current_content.metadata?.font_scale);
      const requestedScale = parseFontScale(input.font_scale);
      const resolvedFontScale = requestedScale ?? metadataScale ?? DEFAULT_FONT_SCALE;
      const metadataSpacingScale = parseScaleInRange(
        exportTarget.row.current_content.metadata?.spacing_scale,
        SPACING_SCALE_MIN,
        SPACING_SCALE_MAX
      );
      const requestedSpacingScale = parseScaleInRange(input.spacing_scale, SPACING_SCALE_MIN, SPACING_SCALE_MAX);
      const resolvedSpacingScale = requestedSpacingScale ?? metadataSpacingScale ?? DEFAULT_SPACING_SCALE;
      const metadataLayoutScale = parseScaleInRange(
        exportTarget.row.current_content.metadata?.layout_scale,
        LAYOUT_SCALE_MIN,
        LAYOUT_SCALE_MAX
      );
      const requestedLayoutScale = parseScaleInRange(input.layout_scale, LAYOUT_SCALE_MIN, LAYOUT_SCALE_MAX);
      const resolvedLayoutScale = requestedLayoutScale ?? metadataLayoutScale ?? DEFAULT_LAYOUT_SCALE;
      const layoutDensityFactor = 1 + (resolvedLayoutScale - 1) * 0.12;
      const scaledPresentation = {
        ...renderingResult.presentation,
        theme: {
          ...renderingResult.presentation.theme,
          tokens: {
            ...renderingResult.presentation.theme.tokens,
            body_text_size:
              renderingResult.presentation.theme.tokens.body_text_size *
              resolvedFontScale *
              layoutDensityFactor,
            section_spacing:
              renderingResult.presentation.theme.tokens.section_spacing *
              resolvedSpacingScale *
              layoutDensityFactor,
            block_spacing:
              renderingResult.presentation.theme.tokens.block_spacing *
              resolvedSpacingScale *
              layoutDensityFactor
          }
        }
      };

      const generatedBytes = await this.renderingExportGenerator.generate(
        format,
        scaledPresentation
      );

      const uploaded = await this.filesService.uploadExportObject({
        userId,
        cvKind: exportTarget.kind,
        cvId: exportTarget.row.id,
        exportId: created.id,
        format,
        bytes: generatedBytes
      });

      uploadedStorage = {
        storage_bucket: uploaded.storage_bucket,
        storage_path: uploaded.storage_path
      };

      fileRecord = await this.filesService.createExportFileMetadata({
        userId,
        format,
        storageBucket: uploaded.storage_bucket,
        storagePath: uploaded.storage_path,
        originalFilename: uploaded.original_filename,
        mimeType: uploaded.mime_type,
        sizeBytes: uploaded.size_bytes,
        checksum: uploaded.checksum
      });

      const completedAt = new Date().toISOString();
      const completed = await this.exportsRepository.updateById(userId, created.id, {
        status: "completed",
        file_id: fileRecord.id,
        template_id: resolvedTemplate?.id ?? null,
        error_message: null,
        completed_at: completedAt
      });

      if (!completed) {
        throw new InternalServerError("Failed to finalize export record", {
          export_id: created.id
        });
      }

      if (exportTarget.kind === "tailored") {
        await this.tailoredCvRepository.updateById(userId, exportTarget.row.id, {
          last_exported_at: completedAt
        });
      }

      await this.billingService.recordExportUsage(userId, fileRecord.size_bytes);

      let download = null;
      try {
        download = await this.filesService.createSignedDownloadAccess(fileRecord, {
          forcedDownloadFilename: buildExportDownloadFilename(exportTarget.row.title, format)
        });
      } catch {
        download = null;
      }

      return this.toDetailResponse(
        completed,
        exportTarget.kind === "tailored" ? exportTarget.row : null,
        exportTarget.kind === "master" ? exportTarget.row : null,
        fileRecord,
        resolvedTemplate,
        renderingResult.resolved_template,
        download
      );
    } catch (error) {
      if (fileRecord) {
        await this.filesService.softDeleteFileMetadata(userId, fileRecord.id);
      }

      if (uploadedStorage) {
        await this.filesService.deleteStorageObject(
          uploadedStorage.storage_bucket,
          uploadedStorage.storage_path
        );
      }

      const safeMessage = this.toSafeFailureMessage(error);

      try {
        await this.exportsRepository.updateById(userId, created.id, {
          status: "failed",
          file_id: null,
          template_id: resolvedTemplate?.id ?? null,
          error_message: safeMessage,
          completed_at: null
        });
      } catch {
        // Best effort: preserve main error path if failure state update also fails.
      }

      throw this.toAppError(error);
    }
  }

  private async requireExport(userId: string, exportId: string): Promise<ExportRecord> {
    const row = await this.exportsRepository.findById(userId, exportId);

    if (!row) {
      throw new NotFoundError("Export was not found");
    }

    return row;
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string): Promise<TailoredCvRecord> {
    const row = await this.tailoredCvRepository.findById(userId, tailoredCvId);

    if (!row) {
      throw new NotFoundError("Tailored CV was not found");
    }

    return row;
  }

  private async requireMasterCv(userId: string, masterCvId: string): Promise<MasterCvRecord> {
    const row = await this.masterCvRepository.findById(userId, masterCvId);

    if (!row) {
      throw new NotFoundError("Master CV was not found");
    }

    return row;
  }

  private async safeGetTemplate(
    session: SessionContext,
    templateId: string
  ): Promise<TemplateSummary | null> {
    try {
      const detail = await this.templatesService.getTemplate(session, templateId);
      return detail.template;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }

      throw error;
    }
  }

  private toSummaryItem(row: ExportRecord): ExportSummaryItem {
    return {
      id: row.id,
      format: row.format,
      status: row.status,
      template_id: row.template_id,
      file_id: row.file_id,
      created_at: row.created_at,
      completed_at: row.completed_at,
      error_message: row.status === "failed" ? row.error_message : null,
      download_available: row.status === "completed" && Boolean(row.file_id)
    };
  }

  private toTailoredCvSummary(row: TailoredCvRecord | null): ExportTailoredCvSummary | null {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      template_id: row.template_id,
      updated_at: row.updated_at
    };
  }

  private toMasterCvSummary(row: MasterCvRecord | null): ExportMasterCvSummary | null {
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      source_type: row.source_type,
      template_id: row.template_id,
      updated_at: row.updated_at
    };
  }

  private toFileSummary(file: FileRecord | null): ExportFileSummary | null {
    if (!file) {
      return null;
    }

    return {
      id: file.id,
      file_type: file.file_type,
      original_filename: file.original_filename,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
      created_at: file.created_at
    };
  }

  private toDetailResponse(
    exportRow: ExportRecord,
    tailoredCv: TailoredCvRecord | null,
    masterCv: MasterCvRecord | null,
    file: FileRecord | null,
    template: TemplateSummary | null,
    resolvedTemplate: ResolvedTemplateSummary | null,
    download: ExportDetailResponse["download"]
  ): ExportDetailResponse {
    return {
      export: this.toSummaryItem(exportRow),
      tailored_cv: this.toTailoredCvSummary(tailoredCv),
      master_cv: this.toMasterCvSummary(masterCv),
      file: this.toFileSummary(file),
      template,
      resolved_template: resolvedTemplate,
      download
    };
  }

  private toSafeFailureMessage(error: unknown): string {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      return truncateErrorMessage(error.message);
    }

    if (error instanceof ExportGenerationFailedError) {
      return "Export generation failed";
    }

    if (error instanceof Error) {
      return truncateErrorMessage(error.message);
    }

    return "Export failed";
  }

  private toAppError(error: unknown): AppError {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundError ||
      error instanceof ExportNotReadyError ||
      error instanceof ExportGenerationFailedError ||
      error instanceof InternalServerError
    ) {
      return error;
    }

    if (error && typeof error === "object" && "statusCode" in error && "code" in error) {
      return error as AppError;
    }

    return new ExportGenerationFailedError("Export generation failed", {
      reason: error instanceof Error ? error.message : "unknown_export_error"
    });
  }
}
