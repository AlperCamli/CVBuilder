import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ImportsService } from "../src/modules/imports/imports.service";
import {
  type CreateFilePayload,
  type CreateImportPayload,
  type ImportDetailRow,
  type ImportUpdatePayload,
  type ImportsRepository
} from "../src/modules/imports/imports.repository";
import { type SessionContext } from "../src/modules/imports/imports.types";
import { SimpleCvParser } from "../src/modules/imports/parsers/simple-cv-parser";
import { type CreateMasterCvPayload, type MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type {
  FileRecord,
  ImportRecord,
  ImportStatus,
  MasterCvRecord,
  MasterCvSourceType,
  UserRecord
} from "../src/shared/types/domain";

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
});
