import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ImportsService } from "../src/modules/imports/imports.service";
import { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import {
  type CreateFilePayload,
  type CreateImportPayload,
  type ImportDetailRow,
  type ImportUpdatePayload,
  type ImportsRepository
} from "../src/modules/imports/imports.repository";
import { type SessionContext } from "../src/modules/imports/imports.types";
import { SimpleCvParser } from "../src/modules/imports/parsers/simple-cv-parser";
import type {
  CvParser,
  ExtractCvRawTextResult,
  ParseCvFileInput,
  ParseCvFileResult
} from "../src/modules/imports/parsers/cv-parser";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "../src/modules/ai/provider/ai-provider";
import type { AiPromptConfigRepository } from "../src/modules/ai/prompts/prompt-config.repository";
import { type CreateMasterCvPayload, type MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type {
  FileRecord,
  ImportRecord,
  ImportStatus,
  MasterCvRecord,
  MasterCvSourceType,
  UserRecord
} from "../src/shared/types/domain";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const nowIso = (): string => new Date().toISOString();

class InMemoryImportsRepository implements ImportsRepository {
  readonly importId = randomUUID();

  private readonly sourceFile: FileRecord;
  private importRow: ImportRecord;

  constructor(
    private readonly userId: string,
    private readonly bytes: Uint8Array,
    mimeType: string,
    filename: string
  ) {
    this.sourceFile = {
      id: randomUUID(),
      user_id: userId,
      file_type: "source_upload",
      storage_bucket: "uploads",
      storage_path: `imports/${randomUUID()}`,
      original_filename: filename,
      mime_type: mimeType,
      size_bytes: bytes.length,
      checksum: null,
      is_deleted: false,
      created_at: nowIso()
    };

    this.importRow = {
      id: this.importId,
      user_id: userId,
      source_file_id: this.sourceFile.id,
      target_master_cv_id: null,
      status: "uploaded",
      parser_name: null,
      raw_extracted_text: null,
      parsed_content: null,
      error_message: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
  }

  async createFile(payload: CreateFilePayload): Promise<FileRecord> {
    return {
      ...this.sourceFile,
      ...payload,
      id: this.sourceFile.id,
      created_at: this.sourceFile.created_at
    };
  }

  async createImport(payload: CreateImportPayload): Promise<ImportRecord> {
    this.importRow = {
      ...this.importRow,
      ...payload,
      id: this.importRow.id,
      source_file_id: this.sourceFile.id,
      created_at: this.importRow.created_at,
      updated_at: nowIso()
    };

    return this.importRow;
  }

  async findImportDetailById(userId: string, importId: string): Promise<ImportDetailRow | null> {
    if (userId !== this.userId || importId !== this.importRow.id) {
      return null;
    }

    return {
      importRow: this.importRow,
      sourceFile: this.sourceFile,
      targetMasterCv: null
    };
  }

  async updateImport(
    userId: string,
    importId: string,
    payload: ImportUpdatePayload
  ): Promise<ImportRecord | null> {
    if (userId !== this.userId || importId !== this.importRow.id) {
      return null;
    }

    const nextStatus: ImportStatus | undefined = payload.status;

    this.importRow = {
      ...this.importRow,
      ...payload,
      status: nextStatus ?? this.importRow.status,
      updated_at: nowIso()
    };

    return this.importRow;
  }

  async createSignedUploadUrl(storageBucket: string, storagePath: string): Promise<{
    storage_path: string;
    token: string;
  }> {
    return {
      storage_path: storagePath,
      token: `${storageBucket}-token`
    };
  }

  async downloadStorageObject(_storageBucket: string, _storagePath: string): Promise<Uint8Array> {
    return this.bytes;
  }
}

class InMemoryMasterCvRepository implements MasterCvRepository {
  private rows: MasterCvRecord[] = [];

  async listByUser(_userId: string): Promise<MasterCvRecord[]> {
    return this.rows;
  }

  async findById(_userId: string, _masterCvId: string): Promise<MasterCvRecord | null> {
    return null;
  }

  async findAnyById(_userId: string, _masterCvId: string): Promise<MasterCvRecord | null> {
    return null;
  }

  async create(payload: CreateMasterCvPayload): Promise<MasterCvRecord> {
    const row: MasterCvRecord = {
      id: randomUUID(),
      user_id: payload.user_id,
      title: payload.title,
      language: payload.language,
      template_id: payload.template_id,
      current_content: payload.current_content,
      summary_text: payload.summary_text,
      source_type: payload.source_type as MasterCvSourceType,
      is_deleted: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    this.rows.push(row);
    return row;
  }

  async updateById(
    _userId: string,
    _masterCvId: string,
    _payload: {
      title?: string;
      language?: string;
      template_id?: string | null;
      current_content?: MasterCvRecord["current_content"];
      summary_text?: string | null;
      source_type?: MasterCvSourceType;
    }
  ): Promise<MasterCvRecord | null> {
    return null;
  }

  async softDelete(_userId: string, _masterCvId: string): Promise<boolean> {
    return false;
  }
}

const buildSession = (userId: string): SessionContext => {
  const appUser: UserRecord = {
    id: userId,
    auth_user_id: "auth-user-1",
    email: "tester@cvbuilder.dev",
    full_name: "Test User",
    locale: "en",
    default_cv_language: "en",
    onboarding_completed: true,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return {
    authUser: {
      auth_user_id: appUser.auth_user_id,
      email: appUser.email,
      full_name: appUser.full_name,
      locale: appUser.locale
    },
    appUser
  };
};

const createMinimalContent = (summary: string): CvContent => {
  return {
    version: "v1",
    language: "en",
    metadata: {},
    sections: [
      {
        id: "summary-1",
        type: "summary",
        title: "Summary",
        order: 0,
        meta: {},
        blocks: [
          {
            id: "summary-block-1",
            type: "summary",
            order: 0,
            visibility: "visible",
            fields: {
              text: summary
            },
            meta: {}
          }
        ]
      }
    ]
  };
};

const createNonCanonicalContent = (): CvContent => {
  return {
    version: "v1",
    language: "en",
    metadata: {
      name: "Alper Çamlı",
      title: "Computer Science Student",
      github: "github/AlperCamli",
      linkedin: "in/alpercamli"
    },
    sections: [
      {
        id: "personal-1",
        type: "personal_info",
        title: "Personal Information",
        order: 0,
        meta: {},
        blocks: [
          {
            id: "personal-block-1",
            type: "personal_info",
            order: 0,
            visibility: "visible",
            fields: {
              email: "camlialper03@gmail.com",
              phone: "+90 542 592 3911",
              location: "Istanbul, Turkey"
            },
            meta: {}
          }
        ]
      },
      {
        id: "education-1",
        type: "education",
        title: "Education",
        order: 1,
        meta: {},
        blocks: [
          {
            id: "education-block-1",
            type: "education_item",
            order: 0,
            visibility: "visible",
            fields: {
              school: "Sabancı University",
              degree: "Computer Science"
            },
            meta: {}
          }
        ]
      },
      {
        id: "experience-1",
        type: "experience",
        title: "Experience",
        order: 2,
        meta: {},
        blocks: [
          {
            id: "experience-block-1",
            type: "experience_item",
            order: 0,
            visibility: "visible",
            fields: {
              job_title: "Business Intelligence Intern",
              company_name: "Vakıfbank",
              city: "Istanbul"
            },
            meta: {}
          }
        ]
      },
      {
        id: "awards-1",
        type: "awards",
        title: "Awards",
        order: 3,
        meta: {},
        blocks: [
          {
            id: "award-block-1",
            type: "award_item",
            order: 0,
            visibility: "visible",
            fields: {
              title: "National 2nd Prize in Physics",
              issuing_organization: "TUBITAK"
            },
            meta: {}
          }
        ]
      },
      {
        id: "languages-1",
        type: "languages",
        title: "Languages",
        order: 4,
        meta: {},
        blocks: [
          {
            id: "language-block-1",
            type: "languages",
            order: 0,
            visibility: "visible",
            fields: {
              text: "Turkish (Native), English (IELTS 7.5 / C1)"
            },
            meta: {}
          }
        ]
      }
    ]
  };
};

class StubCvParser implements CvParser {
  parseCalls = 0;
  extractCalls = 0;

  constructor(
    private readonly extractionResult: ExtractCvRawTextResult,
    private readonly fallbackResult: ParseCvFileResult,
    private readonly throwOnParse = false
  ) {}

  async extractRawText(_input: ParseCvFileInput): Promise<ExtractCvRawTextResult> {
    this.extractCalls += 1;
    return this.extractionResult;
  }

  async parse(_input: ParseCvFileInput): Promise<ParseCvFileResult> {
    this.parseCalls += 1;
    if (this.throwOnParse) {
      throw new Error("Fallback parser should not be called");
    }

    return this.fallbackResult;
  }
}

class SuccessfulCvParseAiProvider implements AiProvider {
  readonly providerName = "stubai";

  resolveModelName(): string {
    return "stubai-model";
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    expect(request.flow_type).toBe("cv_parse");

    return {
      provider: this.providerName,
      model_name: request.model_name,
      output_payload: {
        parsed_content: createMinimalContent("AI parsed summary."),
        warnings: ["AI parser warning."]
      }
    };
  }
}

class FailingCvParseAiProvider implements AiProvider {
  readonly providerName = "stubai";

  resolveModelName(): string {
    return "stubai-model";
  }

  async generate(_request: AiProviderRequest): Promise<AiProviderResult> {
    throw new Error("simulated AI failure");
  }
}

class NeverCallCvParseAiProvider implements AiProvider {
  readonly providerName = "stubai";

  resolveModelName(): string {
    return "stubai-model";
  }

  async generate(_request: AiProviderRequest): Promise<AiProviderResult> {
    throw new Error("AI parser should have been skipped");
  }
}

class SuccessfulCvParseAiFlowRunner {
  async parseCvContent(
    _session: SessionContext,
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
  }> {
    expect(input.raw_text.length).toBeGreaterThan(0);

    return {
      ai_run_id: "ai-run-cv-parse-1",
      parsed_content: createMinimalContent("AI flow runner parsed summary."),
      warnings: ["AI flow runner warning."],
      generation_metadata: {
        provider: "stubflow",
        model_name: "stubflow-model",
        flow_type: "cv_parse",
        prompt_key: "cv-parse",
        prompt_version: "phase5-v1"
      }
    };
  }
}

class FailingCvParseAiFlowRunner {
  async parseCvContent(
    _session: SessionContext,
    _input: {
      raw_text: string;
      source_filename: string;
      mime_type: string;
      language_hint: string;
    }
  ): Promise<never> {
    throw new Error("simulated cv_parse flow runner failure");
  }
}

const createPromptResolver = (): AiPromptResolver => {
  const repository: AiPromptConfigRepository = {
    async listActiveByProfile(): Promise<[]> {
      return [];
    }
  };

  return new AiPromptResolver(repository, "test-profile");
};

describe("imports service integration checks", () => {
  it("returns parsed status with warnings on low-confidence PDF text and still converts to master CV", async () => {
    const userId = randomUUID();

    const noisyPdf = [
      "%PDF-1.7",
      "1 0 obj",
      "<< /Type /Catalog >>",
      "endobj",
      "stream",
      "@@@@ #### $$$$ %%%%",
      "ABCD ABCD ABCD ABCD ABCD ABCD",
      "endstream",
      "xref",
      "%%EOF"
    ].join("\n");

    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from(noisyPdf, "utf-8")),
      "application/pdf",
      "noisy-cv.pdf"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const service = new ImportsService(importsRepository, masterCvRepository, new SimpleCvParser());
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("smart_pdf_parser_v2");
    expect(parsed.parse_summary.warnings.length).toBeGreaterThan(0);
    expect(parsed.parse_summary.warnings.join("\n")).toMatch(
      /Extraction diagnostics|Low-confidence extraction detected|No readable text/i
    );

    const converted = await service.createMasterCvFromImport(session, importsRepository.importId, {
      title: "Imported CV"
    });

    expect(converted.import.status).toBe("converted");
    expect(converted.master_cv.current_content.sections.length).toBeGreaterThan(0);
    expect(converted.master_cv.title).toBe("Imported CV");
  });

  it("uses AI parsing as primary and does not call heuristic parser when AI succeeds", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("John Doe\nSenior Engineer\nBuilt backend systems.", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "John Doe\nSenior Engineer\nBuilt backend systems.",
        warnings: ["Extraction diagnostics warning."],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "fallback text",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: ["Fallback warning."],
        diagnostics: undefined
      },
      true
    );
    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      new SuccessfulCvParseAiProvider(),
      createPromptResolver()
    );
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("stubai_cv_parser_v1");
    expect(parsed.parse_summary.warnings).toEqual(["Extraction diagnostics warning.", "AI parser warning."]);
    expect(parser.extractCalls).toBe(1);
    expect(parser.parseCalls).toBe(0);
  });

  it("canonicalizes AI-first parsed content before persistence", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("sample raw text", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "sample raw text",
        warnings: [],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "sample raw text",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: [],
        diagnostics: undefined
      },
      true
    );

    const provider: AiProvider = {
      providerName: "stubai",
      resolveModelName: () => "stubai-model",
      async generate(): Promise<AiProviderResult> {
        return {
          provider: "stubai",
          model_name: "stubai-model",
          output_payload: {
            parsed_content: createNonCanonicalContent()
          }
        };
      }
    };

    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      provider,
      createPromptResolver()
    );
    const session = buildSession(userId);

    await service.parseImport(session, importsRepository.importId);
    const result = await service.getImportResult(session, importsRepository.importId);
    const parsedContent = result.parsed_content;

    expect(parsedContent).not.toBeNull();
    expect(parsedContent?.sections.some((section) => section.type === "header")).toBe(true);
    expect(parsedContent?.metadata.full_name).toBe("Alper Çamlı");
    expect(parsedContent?.metadata.headline).toBe("Computer Science Student");
    expect(parsedContent?.metadata.urls).toEqual(
      expect.arrayContaining([
        "https://github.com/AlperCamli",
        "https://www.linkedin.com/in/alpercamli"
      ])
    );
    const awardsSection = parsedContent?.sections.find((section) => section.type === "awards");
    expect(awardsSection?.blocks[0]?.fields.issuer).toBe("TUBITAK");
    const educationSection = parsedContent?.sections.find((section) => section.type === "education");
    expect(educationSection?.blocks[0]?.fields.field_of_study).toBe("Computer Science");
    const experienceSection = parsedContent?.sections.find((section) => section.type === "experience");
    expect(experienceSection?.blocks[0]?.fields.role).toBe("Business Intelligence Intern");
    expect(experienceSection?.blocks[0]?.fields.company).toBe("Vakıfbank");
    const languagesSection = parsedContent?.sections.find((section) => section.type === "languages");
    expect(languagesSection?.blocks).toHaveLength(2);
    expect(languagesSection?.blocks[1]?.fields.certificate).toBe("IELTS 7.5 / C1");
    expect(languagesSection?.blocks[1]?.fields.proficiency).toBe("");
  });

  it("uses AI flow runner as primary parsing path when available", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("Alex Doe\nData Analyst\nBuilt BI dashboards.", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Alex Doe\nData Analyst\nBuilt BI dashboards.",
        warnings: ["Extraction diagnostics warning."],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "fallback text",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: ["Fallback warning."],
        diagnostics: undefined
      },
      true
    );

    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      undefined,
      undefined,
      new SuccessfulCvParseAiFlowRunner()
    );
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("stubflow_cv_parser_v1");
    expect(parsed.parse_summary.warnings).toEqual([
      "Extraction diagnostics warning.",
      "AI flow runner warning."
    ]);
    expect(parser.extractCalls).toBe(1);
    expect(parser.parseCalls).toBe(0);
  });

  it("falls back to heuristic parser when AI parsing fails", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("Jane Doe\nProduct Manager\nLed cross-functional teams.", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Jane Doe\nProduct Manager\nLed cross-functional teams.",
        warnings: ["Extraction diagnostics warning."],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Jane Doe\nProduct Manager\nLed cross-functional teams.",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: ["Fallback warning."],
        diagnostics: undefined
      }
    );
    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      new FailingCvParseAiProvider(),
      createPromptResolver()
    );
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("simple_cv_parser_v1");
    expect(parsed.parse_summary.warnings).toContain("Fallback warning.");
    expect(parsed.parse_summary.warnings.join("\n")).toMatch(
      /AI parser failed; fallback parser output was used/i
    );
    expect(parser.extractCalls).toBe(1);
    expect(parser.parseCalls).toBe(1);
  });

  it("canonicalizes fallback parser content when AI fails", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("Jane Doe\nProduct Manager", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Jane Doe\nProduct Manager",
        warnings: [],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Jane Doe\nProduct Manager",
        parsedContent: createNonCanonicalContent(),
        warnings: [],
        diagnostics: undefined
      }
    );

    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      new FailingCvParseAiProvider(),
      createPromptResolver()
    );
    const session = buildSession(userId);

    await service.parseImport(session, importsRepository.importId);
    const result = await service.getImportResult(session, importsRepository.importId);

    expect(result.parsed_content?.sections.some((section) => section.type === "header")).toBe(true);
    expect(result.parsed_content?.metadata.full_name).toBe("Alper Çamlı");
    const awardsSection = result.parsed_content?.sections.find((section) => section.type === "awards");
    expect(awardsSection?.blocks[0]?.fields.issuer).toBe("TUBITAK");
    const educationSection = result.parsed_content?.sections.find((section) => section.type === "education");
    expect(educationSection?.blocks[0]?.fields.field_of_study).toBe("Computer Science");
    const experienceSection = result.parsed_content?.sections.find((section) => section.type === "experience");
    expect(experienceSection?.blocks[0]?.fields.role).toBe("Business Intelligence Intern");
    expect(experienceSection?.blocks[0]?.fields.company).toBe("Vakıfbank");
  });

  it("falls back to heuristic parser when AI flow runner fails", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("Taylor Doe\nQA Engineer\nBuilt test automation.", "utf-8")),
      "text/plain",
      "resume.txt"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Taylor Doe\nQA Engineer\nBuilt test automation.",
        warnings: ["Extraction diagnostics warning."],
        diagnostics: undefined
      },
      {
        parserName: "simple_cv_parser_v1",
        rawExtractedText: "Taylor Doe\nQA Engineer\nBuilt test automation.",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: ["Fallback warning."],
        diagnostics: undefined
      }
    );

    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      undefined,
      undefined,
      new FailingCvParseAiFlowRunner()
    );
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("simple_cv_parser_v1");
    expect(parsed.parse_summary.warnings).toContain("Fallback warning.");
    expect(parsed.parse_summary.warnings.join("\n")).toMatch(
      /AI parser failed; fallback parser output was used/i
    );
    expect(parser.extractCalls).toBe(1);
    expect(parser.parseCalls).toBe(1);
  });

  it("skips AI parsing and uses heuristic parser when no readable text is extracted", async () => {
    const userId = randomUUID();
    const importsRepository = new InMemoryImportsRepository(
      userId,
      new Uint8Array(Buffer.from("%PDF-1.7", "utf-8")),
      "application/pdf",
      "empty.pdf"
    );
    const masterCvRepository = new InMemoryMasterCvRepository();
    const parser = new StubCvParser(
      {
        parserName: "smart_pdf_parser_v2",
        rawExtractedText: "empty.pdf\napplication/pdf\n9",
        warnings: ["No readable text was extracted from the source file."],
        diagnostics: undefined
      },
      {
        parserName: "smart_pdf_parser_v2",
        rawExtractedText: "empty.pdf\napplication/pdf\n9",
        parsedContent: createMinimalContent("Fallback parsed summary."),
        warnings: ["Fallback warning."],
        diagnostics: undefined
      }
    );
    const service = new ImportsService(
      importsRepository,
      masterCvRepository,
      parser,
      new NeverCallCvParseAiProvider(),
      createPromptResolver()
    );
    const session = buildSession(userId);

    const parsed = await service.parseImport(session, importsRepository.importId);

    expect(parsed.parse_summary.status).toBe("parsed");
    expect(parsed.parse_summary.parser_name).toBe("smart_pdf_parser_v2");
    expect(parsed.parse_summary.warnings).toEqual(["Fallback warning."]);
    expect(parser.extractCalls).toBe(1);
    expect(parser.parseCalls).toBe(1);
  });
});
