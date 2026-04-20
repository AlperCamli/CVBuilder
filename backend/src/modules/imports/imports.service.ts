import { ConflictError, NotFoundError } from "../../shared/errors/app-error";
import { buildCvPreview, buildCvSummaryText, normalizeCvContent } from "../../shared/cv-content/cv-content.utils";
import type { ImportRecord, ImportStatus, MasterCvRecord } from "../../shared/types/domain";
import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type { CreateMasterCvPayload, MasterCvRepository } from "../master-cv/master-cv.repository";
import type {
  CreateMasterCvFromImportInput,
  CreateImportSessionInput,
  CreateImportUploadUrlInput,
  ImportDetail,
  ImportResultView,
  ImportUploadUrlTarget,
  ParseSummary,
  SessionContext,
  UpdateImportResultInput
} from "./imports.types";
import type { ImportsRepository } from "./imports.repository";
import type { CvParser } from "./parsers/cv-parser";

const toMasterCvDetail = (row: MasterCvRecord) => {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    source_type: row.source_type,
    template_id: row.template_id,
    summary_text: row.summary_text,
    current_content: row.current_content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    preview: buildCvPreview(row.current_content)
  };
};

const countBlocks = (content: CvContent): number => {
  return content.sections.reduce((sum, section) => sum + section.blocks.length, 0);
};

const DEFAULT_IMPORTS_STORAGE_BUCKET = "imports";

const sanitizeFilename = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-");

  if (!normalized) {
    return "upload.bin";
  }

  return normalized.slice(0, 180);
};

export class ImportsService {
  constructor(
    private readonly importsRepository: ImportsRepository,
    private readonly masterCvRepository: MasterCvRepository,
    private readonly parser: CvParser
  ) {}

  async createImportSession(
    session: SessionContext,
    input: CreateImportSessionInput
  ): Promise<ImportDetail> {
    const sourceFile = await this.importsRepository.createFile({
      user_id: session.appUser.id,
      file_type: "source_upload",
      storage_bucket: input.storage_bucket,
      storage_path: input.storage_path,
      original_filename: input.original_filename,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      checksum: input.checksum ?? null
    });

    const importRow = await this.importsRepository.createImport({
      user_id: session.appUser.id,
      source_file_id: sourceFile.id,
      status: "uploaded"
    });

    return {
      import: importRow,
      source_file: sourceFile,
      target_master_cv: null
    };
  }

  async createImportUploadUrl(
    session: SessionContext,
    input: CreateImportUploadUrlInput
  ): Promise<ImportUploadUrlTarget> {
    const storageBucket = DEFAULT_IMPORTS_STORAGE_BUCKET;
    const fileName = sanitizeFilename(input.original_filename);
    const storagePath = `users/${session.appUser.id}/imports/${Date.now()}-${fileName}`;

    const target = await this.importsRepository.createSignedUploadUrl(storageBucket, storagePath);

    return {
      storage_bucket: storageBucket,
      storage_path: target.storage_path,
      token: target.token
    };
  }

  async getImportDetail(session: SessionContext, importId: string): Promise<ImportDetail> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);

    return {
      import: detail.importRow,
      source_file: detail.sourceFile,
      target_master_cv: detail.targetMasterCv
    };
  }

  async markUploadComplete(session: SessionContext, importId: string): Promise<ImportDetail> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);

    if (detail.importRow.status === "parsing") {
      throw new ConflictError("Import is currently being parsed");
    }

    if (detail.importRow.status === "converted") {
      throw new ConflictError("Import is already converted to a master CV");
    }

    const updated = await this.importsRepository.updateImport(session.appUser.id, importId, {
      status: "uploaded",
      error_message: null
    });

    if (!updated) {
      throw new NotFoundError("Import session was not found");
    }

    return {
      import: updated,
      source_file: detail.sourceFile,
      target_master_cv: detail.targetMasterCv
    };
  }

  async parseImport(
    session: SessionContext,
    importId: string
  ): Promise<{ import: ImportDetail; parse_summary: ParseSummary }> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);

    if (detail.importRow.status === "converted") {
      throw new ConflictError("Converted imports cannot be parsed again");
    }

    await this.importsRepository.updateImport(session.appUser.id, importId, {
      status: "parsing",
      error_message: null
    });

    try {
      const bytes = await this.importsRepository.downloadStorageObject(
        detail.sourceFile.storage_bucket,
        detail.sourceFile.storage_path
      );

      const parseResult = await this.parser.parse({
        originalFilename: detail.sourceFile.original_filename,
        mimeType: detail.sourceFile.mime_type,
        sizeBytes: detail.sourceFile.size_bytes,
        bytes
      });

      const updated = await this.importsRepository.updateImport(session.appUser.id, importId, {
        status: "parsed",
        parser_name: parseResult.parserName,
        raw_extracted_text: parseResult.rawExtractedText,
        parsed_content: parseResult.parsedContent,
        error_message: null
      });

      if (!updated) {
        throw new NotFoundError("Import session was not found");
      }

      const refreshed = await this.requireImportDetail(session.appUser.id, importId);

      return {
        import: {
          import: refreshed.importRow,
          source_file: refreshed.sourceFile,
          target_master_cv: refreshed.targetMasterCv
        },
        parse_summary: {
          parser_name: parseResult.parserName,
          status: "parsed",
          raw_text_length: parseResult.rawExtractedText.length,
          section_count: parseResult.parsedContent.sections.length,
          block_count: countBlocks(parseResult.parsedContent),
          warnings: parseResult.warnings
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import parsing failed";

      const failed = await this.importsRepository.updateImport(session.appUser.id, importId, {
        status: "failed",
        error_message: message,
        parser_name: null
      });

      if (!failed) {
        throw new NotFoundError("Import session was not found");
      }

      const refreshed = await this.requireImportDetail(session.appUser.id, importId);

      return {
        import: {
          import: refreshed.importRow,
          source_file: refreshed.sourceFile,
          target_master_cv: refreshed.targetMasterCv
        },
        parse_summary: {
          parser_name: "simple_cv_parser_v1",
          status: "failed",
          raw_text_length: 0,
          section_count: 0,
          block_count: 0,
          warnings: [message]
        }
      };
    }
  }

  async getImportResult(session: SessionContext, importId: string): Promise<ImportResultView> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);

    return this.toImportResultView(detail.importRow);
  }

  async updateImportResult(
    session: SessionContext,
    importId: string,
    input: UpdateImportResultInput
  ): Promise<ImportResultView> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);

    if (detail.importRow.status === "converted") {
      throw new ConflictError("Converted imports cannot be modified");
    }

    const fallbackLanguage = detail.importRow.parsed_content?.language ?? "en";
    const normalizedContent = normalizeCvContent(input.parsed_content, fallbackLanguage);

    const updated = await this.importsRepository.updateImport(session.appUser.id, importId, {
      parsed_content: normalizedContent,
      status: "reviewed",
      error_message: null
    });

    if (!updated) {
      throw new NotFoundError("Import session was not found");
    }

    return this.toImportResultView(updated);
  }

  async createMasterCvFromImport(
    session: SessionContext,
    importId: string,
    input: CreateMasterCvFromImportInput
  ): Promise<{
    master_cv: ReturnType<typeof toMasterCvDetail>;
    import: Pick<ImportRecord, "id" | "status" | "target_master_cv_id" | "updated_at">;
  }> {
    const detail = await this.requireImportDetail(session.appUser.id, importId);
    const importRow = detail.importRow;

    if (importRow.status === "converted") {
      throw new ConflictError("Import is already converted");
    }

    if (!importRow.parsed_content) {
      throw new ConflictError("Import must be parsed before conversion");
    }

    if (!this.canConvert(importRow.status)) {
      throw new ConflictError("Import result must be parsed or reviewed before conversion", {
        status: importRow.status
      });
    }

    const language = input.language ?? importRow.parsed_content.language;
    const currentContent = normalizeCvContent(importRow.parsed_content, language);
    const title = input.title?.trim() || this.deriveTitleFromFilename(detail.sourceFile.original_filename);

    const payload: CreateMasterCvPayload = {
      user_id: session.appUser.id,
      title,
      language,
      template_id: input.template_id ?? null,
      current_content: currentContent,
      summary_text: buildCvSummaryText(currentContent),
      source_type: "import"
    };

    const createdMasterCv = await this.masterCvRepository.create(payload);

    const updatedImport = await this.importsRepository.updateImport(session.appUser.id, importId, {
      target_master_cv_id: createdMasterCv.id,
      status: "converted",
      parsed_content: currentContent,
      error_message: null
    });

    if (!updatedImport) {
      throw new NotFoundError("Import session was not found");
    }

    return {
      master_cv: toMasterCvDetail(createdMasterCv),
      import: {
        id: updatedImport.id,
        status: updatedImport.status,
        target_master_cv_id: updatedImport.target_master_cv_id,
        updated_at: updatedImport.updated_at
      }
    };
  }

  private async requireImportDetail(userId: string, importId: string) {
    const detail = await this.importsRepository.findImportDetailById(userId, importId);

    if (!detail) {
      throw new NotFoundError("Import session was not found");
    }

    return detail;
  }

  private toImportResultView(importRow: ImportRecord): ImportResultView {
    return {
      status: importRow.status,
      parser_name: importRow.parser_name,
      raw_extracted_text: importRow.raw_extracted_text,
      parsed_content: importRow.parsed_content,
      error_message: importRow.error_message
    };
  }

  private canConvert(status: ImportStatus): boolean {
    return status === "parsed" || status === "reviewed";
  }

  private deriveTitleFromFilename(fileName: string): string {
    const base = fileName.replace(/\.[a-zA-Z0-9]+$/, "").trim();

    if (!base) {
      return "Imported Master CV";
    }

    return base.length <= 160 ? base : `${base.slice(0, 157)}...`;
  }
}
