import type { Logger } from "pino";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors/app-error";
import { buildCvPreview, buildCvSummaryText, normalizeCvContent } from "../../shared/cv-content/cv-content.utils";
import type { ImportRecord, ImportStatus, MasterCvRecord } from "../../shared/types/domain";
import type { CvContent } from "../../shared/cv-content/cv-content.types";
import type { CreateMasterCvPayload, MasterCvRepository } from "../master-cv/master-cv.repository";
import type { AiProvider } from "../ai/provider/ai-provider";
import type { AiPromptResolver } from "../ai/prompts/prompt-resolver";
import { AI_FLOW_REGISTRY } from "../ai/flows/flow-registry";
import { cvParseOutputSchema } from "../ai/flows/flow-contracts";
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
import type {
  CvParser,
  ExtractCvRawTextResult,
  ParseCvFileInput,
  ParseCvFileResult
} from "./parsers/cv-parser";
import { canonicalizeImportedCvContent } from "./import-content-canonicalizer";

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
const AI_PARSE_FLOW_TYPE = "cv_parse";
const DEFAULT_AI_PARSE_USER_PROMPT =
  "Convert raw CV text into strict CV content JSON without inventing facts.";
const MAX_AI_PARSE_RAW_TEXT_LENGTH = 40_000;

interface CvParseAiFlowRunner {
  parseCvContent(
    session: SessionContext,
    input: {
      raw_text: string;
      source_filename: string;
      mime_type: string;
      language_hint: string;
    }
  ): Promise<{
    ai_run_id: string;
    parsed_content: CvContent;
    warnings: string[];
    generation_metadata: {
      provider: string;
      model_name: string;
      flow_type: "cv_parse";
      prompt_key: string;
      prompt_version: string;
    };
  }>;
}

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
    private readonly parser: CvParser,
    private readonly aiProvider?: AiProvider,
    private readonly aiPromptResolver?: AiPromptResolver,
    private readonly aiFlowRunner?: CvParseAiFlowRunner,
    private readonly logger?: Pick<Logger, "info" | "warn">
  ) {}

  async createImportSession(
    session: SessionContext,
    input: CreateImportSessionInput
  ): Promise<ImportDetail> {
    this.assertImportStorageLocation(session.appUser.id, input.storage_bucket, input.storage_path);

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

      const parseInput: ParseCvFileInput = {
        originalFilename: detail.sourceFile.original_filename,
        mimeType: detail.sourceFile.mime_type,
        sizeBytes: detail.sourceFile.size_bytes,
        bytes
      };

      const effectiveParseResult = await this.resolveEffectiveParseResult(parseInput, {
        original_filename: detail.sourceFile.original_filename,
        mime_type: detail.sourceFile.mime_type
      }, session.appUser.default_cv_language || "en", session);
      const canonicalizedContent = canonicalizeImportedCvContent(effectiveParseResult.parsedContent);

      const updated = await this.importsRepository.updateImport(session.appUser.id, importId, {
        status: "parsed",
        parser_name: effectiveParseResult.parserName,
        raw_extracted_text: effectiveParseResult.rawExtractedText,
        parsed_content: canonicalizedContent,
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
          parser_name: effectiveParseResult.parserName,
          status: "parsed",
          raw_text_length: effectiveParseResult.rawExtractedText.length,
          section_count: canonicalizedContent.sections.length,
          block_count: countBlocks(canonicalizedContent),
          warnings: effectiveParseResult.warnings,
          diagnostics: effectiveParseResult.diagnostics ?? null
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
          warnings: [message],
          diagnostics: null
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

  private assertImportStorageLocation(
    userId: string,
    storageBucket: string,
    storagePath: string
  ): void {
    const expectedPrefix = `users/${userId}/imports/`;

    if (
      storageBucket !== DEFAULT_IMPORTS_STORAGE_BUCKET ||
      typeof storagePath !== "string" ||
      !storagePath.startsWith(expectedPrefix) ||
      storagePath.length <= expectedPrefix.length ||
      storagePath.includes("..") ||
      storagePath.includes("\\") ||
      storagePath.includes(" ")
    ) {
      throw new ValidationError("Invalid storage location for import session");
    }
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

  private async resolveEffectiveParseResult(
    parseInput: ParseCvFileInput,
    sourceFile: { original_filename: string; mime_type: string | null },
    defaultLanguage: string,
    session: SessionContext
  ): Promise<ParseCvFileResult> {
    if (!this.aiProvider && !this.aiFlowRunner) {
      return this.parser.parse(parseInput);
    }

    const extraction = await this.extractRawTextForAi(parseInput);
    const aiAttempt = this.aiFlowRunner
      ? await this.tryParseWithAiFlowRunner(
          extraction.extracted,
          sourceFile,
          defaultLanguage,
          session
        )
      : await this.tryParseWithAi(extraction.extracted, sourceFile, defaultLanguage);
    if (aiAttempt.parseResult) {
      return aiAttempt.parseResult;
    }

    const fallbackResult = extraction.precomputedFallbackResult ?? (await this.parser.parse(parseInput));
    if (!aiAttempt.failureWarning) {
      return fallbackResult;
    }

    return {
      ...fallbackResult,
      warnings: [...new Set([...fallbackResult.warnings, aiAttempt.failureWarning])]
    };
  }

  private async extractRawTextForAi(
    parseInput: ParseCvFileInput
  ): Promise<{ extracted: ExtractCvRawTextResult; precomputedFallbackResult: ParseCvFileResult | null }> {
    if (this.parser.extractRawText) {
      const extracted = await this.parser.extractRawText(parseInput);
      return {
        extracted,
        precomputedFallbackResult: null
      };
    }

    const fallbackResult = await this.parser.parse(parseInput);
    return {
      extracted: {
        parserName: fallbackResult.parserName,
        rawExtractedText: fallbackResult.rawExtractedText,
        warnings: fallbackResult.warnings,
        diagnostics: fallbackResult.diagnostics
      },
      precomputedFallbackResult: fallbackResult
    };
  }

  private async tryParseWithAi(
    extractedResult: ExtractCvRawTextResult,
    sourceFile: { original_filename: string; mime_type: string | null },
    defaultLanguage: string
  ): Promise<{
    parseResult: ParseCvFileResult | null;
    failureWarning: string | null;
  }> {
    if (!this.aiProvider || !this.aiPromptResolver) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }

    const rawExtractedText = extractedResult.rawExtractedText.trim();
    if (!rawExtractedText) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }
    const hasNoReadableTextSignal = extractedResult.warnings.some((warning) =>
      /no readable text was extracted/i.test(warning)
    );
    if (hasNoReadableTextSignal) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }

    const flowDefinition = AI_FLOW_REGISTRY[AI_PARSE_FLOW_TYPE];
    const fallbackModelName = this.aiProvider.resolveModelName(AI_PARSE_FLOW_TYPE);

    try {
      const prompt = await this.aiPromptResolver.resolve({
        flow_type: AI_PARSE_FLOW_TYPE,
        provider: this.aiProvider.providerName,
        action_type: null,
        fallback: {
          prompt_key: flowDefinition.prompt_key,
          prompt_version: flowDefinition.prompt_version,
          system_prompt: flowDefinition.system_prompt,
          model_name: fallbackModelName
        }
      });

      const aiResult = await this.aiProvider.generate({
        flow_type: AI_PARSE_FLOW_TYPE,
        model_name: prompt.model_name,
        prompt: {
          prompt_key: prompt.prompt_key,
          prompt_version: prompt.prompt_version,
          system_prompt: prompt.system_prompt,
          user_prompt: prompt.user_prompt_template?.trim() || DEFAULT_AI_PARSE_USER_PROMPT
        },
        output_schema: flowDefinition.output_schema,
        input_payload: {
          raw_text: rawExtractedText.slice(0, MAX_AI_PARSE_RAW_TEXT_LENGTH),
          source_filename: sourceFile.original_filename,
          mime_type: sourceFile.mime_type ?? "application/octet-stream",
          language_hint: defaultLanguage || "en"
        }
      });

      const parsed = cvParseOutputSchema.safeParse(aiResult.output_payload);
      if (!parsed.success) {
        throw new Error("AI CV parsing output did not match contract");
      }

      const normalized = normalizeCvContent(
        parsed.data.parsed_content,
        parsed.data.parsed_content.language || defaultLanguage || "en"
      );
      const mergedWarnings = [
        ...extractedResult.warnings,
        ...(parsed.data.warnings ?? [])
      ];

      return {
        parseResult: {
          parserName: `${this.aiProvider.providerName}_cv_parser_v1`,
          rawExtractedText: extractedResult.rawExtractedText,
          parsedContent: normalized,
          warnings: [...new Set(mergedWarnings)],
          diagnostics: extractedResult.diagnostics
        },
        failureWarning: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown AI parsing error";

      return {
        parseResult: null,
        failureWarning: `AI parser failed; fallback parser output was used (${message.slice(0, 180)}).`
      };
    }
  }

  private async tryParseWithAiFlowRunner(
    extractedResult: ExtractCvRawTextResult,
    sourceFile: { original_filename: string; mime_type: string | null },
    defaultLanguage: string,
    session: SessionContext
  ): Promise<{
    parseResult: ParseCvFileResult | null;
    failureWarning: string | null;
  }> {
    if (!this.aiFlowRunner) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }

    const rawExtractedText = extractedResult.rawExtractedText.trim();
    if (!rawExtractedText) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }

    const hasNoReadableTextSignal = extractedResult.warnings.some((warning) =>
      /no readable text was extracted/i.test(warning)
    );
    if (hasNoReadableTextSignal) {
      return {
        parseResult: null,
        failureWarning: null
      };
    }

    try {
      const aiResult = await this.aiFlowRunner.parseCvContent(session, {
        raw_text: rawExtractedText.slice(0, MAX_AI_PARSE_RAW_TEXT_LENGTH),
        source_filename: sourceFile.original_filename,
        mime_type: sourceFile.mime_type ?? "application/octet-stream",
        language_hint: defaultLanguage || "en"
      });

      const mergedWarnings = [...extractedResult.warnings, ...aiResult.warnings];
      this.logger?.info(
        {
          import_parser: "cv_parse",
          ai_run_id: aiResult.ai_run_id,
          provider: aiResult.generation_metadata.provider,
          model_name: aiResult.generation_metadata.model_name,
          prompt_key: aiResult.generation_metadata.prompt_key,
          prompt_version: aiResult.generation_metadata.prompt_version
        },
        "CV parse AI flow succeeded"
      );

      return {
        parseResult: {
          parserName: `${aiResult.generation_metadata.provider}_cv_parser_v1`,
          rawExtractedText: extractedResult.rawExtractedText,
          parsedContent: aiResult.parsed_content,
          warnings: [...new Set(mergedWarnings)],
          diagnostics: extractedResult.diagnostics
        },
        failureWarning: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown AI parsing error";
      this.logger?.warn(
        {
          import_parser: "cv_parse",
          reason: message.slice(0, 300)
        },
        "CV parse AI flow failed, using fallback parser"
      );

      return {
        parseResult: null,
        failureWarning: `AI parser failed; fallback parser output was used (${message.slice(0, 180)}).`
      };
    }
  }
}
