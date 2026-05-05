import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ExportGenerationFailedError,
  ExportStorageFailedError,
  ValidationError
} from "../src/shared/errors/app-error";
import type {
  ExportFormat,
  ExportRecord,
  ExportStatus,
  FileRecord,
  MasterCvRecord,
  TailoredCvRecord,
  UserRecord
} from "../src/shared/types/domain";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository, TailoredCvUpdatePayload } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { ExportsRepository, CreateExportPayload, UpdateExportPayload } from "../src/modules/exports/exports.repository";
import { ExportsService } from "../src/modules/exports/exports.service";
import type { SessionContext } from "../src/modules/exports/exports.types";
import type { RenderingService } from "../src/modules/rendering/rendering.service";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { TemplateSummary } from "../src/modules/templates/templates.types";
import type { FilesService } from "../src/modules/files/files.service";
import type { RenderingExportGenerator } from "../src/modules/exports/generators/rendering-export-generator";
import type { BillingService } from "../src/modules/billing/billing.service";

const nowIso = (): string => new Date().toISOString();

const noopBillingService = {
  assertActionAllowed: async () => {},
  recordExportUsage: async () => {}
} as unknown as BillingService;

class InMemoryExportsRepository implements ExportsRepository {
  rows = new Map<string, ExportRecord>();

  async create(payload: CreateExportPayload): Promise<ExportRecord> {
    const id = randomUUID();
    const row: ExportRecord = {
      id,
      user_id: payload.user_id,
      master_cv_id: payload.master_cv_id ?? null,
      tailored_cv_id: payload.tailored_cv_id ?? null,
      file_id: payload.file_id ?? null,
      format: payload.format,
      status: payload.status,
      template_id: payload.template_id ?? null,
      error_message: payload.error_message ?? null,
      created_at: nowIso(),
      completed_at: payload.completed_at ?? null
    };

    this.rows.set(id, row);
    return row;
  }

  async updateById(userId: string, exportId: string, payload: UpdateExportPayload): Promise<ExportRecord | null> {
    const existing = this.rows.get(exportId);
    if (!existing || existing.user_id !== userId) {
      return null;
    }

    const updated: ExportRecord = {
      ...existing,
      ...payload,
      file_id: payload.file_id ?? existing.file_id,
      template_id: payload.template_id ?? existing.template_id,
      error_message: payload.error_message ?? existing.error_message,
      completed_at: payload.completed_at ?? existing.completed_at,
      status: (payload.status ?? existing.status) as ExportStatus
    };

    this.rows.set(exportId, updated);
    return updated;
  }

  async findById(userId: string, exportId: string): Promise<ExportRecord | null> {
    const row = this.rows.get(exportId);
    if (!row || row.user_id !== userId) {
      return null;
    }

    return row;
  }

  async listByTailoredCv(userId: string, tailoredCvId: string): Promise<ExportRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.user_id === userId && row.tailored_cv_id === tailoredCvId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  async listByMasterCv(userId: string, masterCvId: string): Promise<ExportRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.user_id === userId && row.master_cv_id === masterCvId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
}

class InMemoryTailoredCvRepository implements TailoredCvRepository {
  rows = new Map<string, TailoredCvRecord>();

  seed(row: TailoredCvRecord): void {
    this.rows.set(row.id, row);
  }

  async listByUser(userId: string): Promise<TailoredCvRecord[]> {
    return [...this.rows.values()].filter((row) => row.user_id === userId && row.is_deleted === false);
  }

  async findById(userId: string, tailoredCvId: string): Promise<TailoredCvRecord | null> {
    const row = this.rows.get(tailoredCvId);
    if (!row || row.user_id !== userId || row.is_deleted) {
      return null;
    }

    return row;
  }

  async create(): Promise<TailoredCvRecord> {
    throw new Error("Not implemented");
  }

  async updateById(
    userId: string,
    tailoredCvId: string,
    payload: TailoredCvUpdatePayload
  ): Promise<TailoredCvRecord | null> {
    const row = this.rows.get(tailoredCvId);
    if (!row || row.user_id !== userId || row.is_deleted) {
      return null;
    }

    const updated: TailoredCvRecord = {
      ...row,
      ...payload,
      updated_at: nowIso(),
      current_content: payload.current_content ?? row.current_content,
      template_id: payload.template_id ?? row.template_id,
      ai_generation_status: payload.ai_generation_status ?? row.ai_generation_status,
      last_exported_at: payload.last_exported_at ?? row.last_exported_at,
      job_id: payload.job_id ?? row.job_id,
      status: payload.status ?? row.status,
      title: payload.title ?? row.title,
      language: payload.language ?? row.language
    };

    this.rows.set(tailoredCvId, updated);
    return updated;
  }

  async softDelete(): Promise<boolean> {
    return false;
  }
}

class InMemoryMasterCvRepository implements MasterCvRepository {
  rows = new Map<string, MasterCvRecord>();

  seed(row: MasterCvRecord): void {
    this.rows.set(row.id, row);
  }

  async listByUser(userId: string): Promise<MasterCvRecord[]> {
    return [...this.rows.values()].filter((row) => row.user_id === userId && row.is_deleted === false);
  }

  async findById(userId: string, masterCvId: string): Promise<MasterCvRecord | null> {
    const row = this.rows.get(masterCvId);
    if (!row || row.user_id !== userId || row.is_deleted) {
      return null;
    }

    return row;
  }

  async findAnyById(userId: string, masterCvId: string): Promise<MasterCvRecord | null> {
    const row = this.rows.get(masterCvId);
    if (!row || row.user_id !== userId) {
      return null;
    }

    return row;
  }

  async create(): Promise<MasterCvRecord> {
    throw new Error("Not implemented");
  }

  async updateById(): Promise<MasterCvRecord | null> {
    return null;
  }

  async softDelete(): Promise<boolean> {
    return false;
  }
}

class FakeTemplatesService {
  constructor(
    private readonly assignableTemplates: Set<string>,
    private readonly templatesById: Map<string, TemplateSummary>
  ) {}

  async validateAssignableTemplateId(templateId: string | null): Promise<string | null> {
    if (templateId === null) {
      return null;
    }

    if (!this.assignableTemplates.has(templateId)) {
      throw new ValidationError("Template is not assignable");
    }

    return templateId;
  }

  async getTemplate(_session: SessionContext, templateId: string) {
    const template = this.templatesById.get(templateId);
    if (!template) {
      throw new ValidationError("Template not found");
    }

    return {
      template
    };
  }
}

class FakeRenderingService {
  template: TemplateSummary | null = null;

  async buildRendering(_input: Parameters<RenderingService["buildRendering"]>[0]) {
    return {
      current_content: {
        version: "v1" as const,
        language: "en",
        metadata: {},
        sections: []
      },
      resolved_template: {
        resolution: this.template ? "selected" : "none",
        template: this.template
      },
      rendering: {
        version: "v1" as const,
        document: {
          kind: "tailored" as const,
          id: "tailored-id",
          title: "Tailored CV",
          language: "en",
          generated_at: nowIso(),
          updated_at: nowIso(),
          context: {
            full_name: "John Doe",
            headline: "Backend Engineer",
            email: "john@example.com"
          }
        },
        template: {
          resolution: this.template ? "selected" : "none",
          template: this.template
        },
        sections: [
          {
            id: "summary-1",
            type: "summary",
            title: "Summary",
            order: 0,
            meta: {},
            plain_text: "Summary content",
            blocks: [
              {
                id: "block-1",
                type: "summary",
                order: 0,
                visibility: "visible" as const,
                fields: { text: "Summary content" },
                meta: {},
                normalized_fields: {
                  text: {
                    raw: "Summary content",
                    text: "Summary content",
                    text_items: ["Summary content"]
                  }
                },
                derived: {
                  headline: "Summary content",
                  subheadline: null,
                  bullets: [],
                  date_range: null,
                  location: null
                },
                plain_text: "Summary content"
              }
            ]
          }
        ],
        plain_text: "Summary content"
      },
      presentation: {
        version: "v1" as const,
        theme: {
          layout: "modern-clean" as const,
          mode: "classic-single-column" as const,
          template_slug: this.template?.slug ?? "modern-clean",
          template_name: this.template?.name ?? "Default",
          tokens: {
            font_family: "Georgia, serif",
            heading_color_hex: "#111827",
            accent_color_hex: "#0f5ea6",
            body_color_hex: "#1f2937",
            muted_color_hex: "#4b5563",
            page_background_hex: "#ffffff",
            section_spacing: 16,
            block_spacing: 12,
            body_text_size: 12,
            compact_density: true as const
          }
        },
        header: {
          name: "John Doe",
          title: "Backend Engineer",
          email: "john@example.com",
          phone: null,
          location: null,
          photo: null,
          contact_items: ["john@example.com"],
          social_links: []
        },
        sections: [
          {
            id: "summary-1",
            type: "summary",
            title: "Professional Summary",
            inline_text: null,
            items: [
              {
                id: "summary-item-1",
                title: null,
                subtitle: null,
                date_range: null,
                location: null,
                metadata_line: null,
                body: "Summary content",
                bullets: []
              }
            ]
          }
        ]
      }
    };
  }
}

class FakeFilesService {
  shouldFailUpload = false;
  createdFiles: FileRecord[] = [];
  lastForcedDownloadFilename: string | undefined = undefined;

  async uploadExportObject(input: {
    userId: string;
    cvKind: "master" | "tailored";
    cvId: string;
    exportId: string;
    format: ExportFormat;
    bytes: Uint8Array;
  }) {
    if (this.shouldFailUpload) {
      throw new ExportStorageFailedError("Failed to upload export file");
    }

    return {
      storage_bucket: "exports",
      storage_path: `users/${input.userId}/${input.cvKind === "master" ? "master-cvs" : "tailored-cvs"}/${input.cvId}/exports/${input.exportId}.${input.format}`,
      mime_type: input.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: input.bytes.byteLength,
      checksum: "checksum",
      original_filename: `${input.cvKind}-cv-export-${input.exportId}.${input.format}`
    };
  }

  async createExportFileMetadata(input: {
    userId: string;
    format: ExportFormat;
    storageBucket: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
  }): Promise<FileRecord> {
    const created: FileRecord = {
      id: randomUUID(),
      user_id: input.userId,
      file_type: input.format === "pdf" ? "export_pdf" : "export_docx",
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      original_filename: input.originalFilename,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      checksum: input.checksum,
      is_deleted: false,
      created_at: nowIso()
    };

    this.createdFiles.push(created);
    return created;
  }

  async findOwnedFileById(_userId: string, fileId: string): Promise<FileRecord | null> {
    return this.createdFiles.find((file) => file.id === fileId) ?? null;
  }

  async createSignedDownloadAccess(
    _file: FileRecord,
    options?: { forcedDownloadFilename?: string }
  ) {
    this.lastForcedDownloadFilename = options?.forcedDownloadFilename;
    return {
      download_url: "https://example.com/download",
      expires_at: new Date(Date.now() + 600000).toISOString(),
      expires_in_seconds: 600
    };
  }

  async deleteStorageObject(_storageBucket: string, _storagePath: string): Promise<void> {
    return;
  }

  async softDeleteFileMetadata(_userId: string, fileId: string): Promise<void> {
    this.createdFiles = this.createdFiles.map((file) =>
      file.id === fileId
        ? {
            ...file,
            is_deleted: true
          }
        : file
    );
  }
}

class FakeRenderingExportGenerator implements RenderingExportGenerator {
  shouldFail = false;
  lastBodyTextSize: number | null = null;

  async generate(
    _format: ExportFormat,
    presentation: Parameters<RenderingExportGenerator["generate"]>[1]
  ): Promise<Uint8Array> {
    this.lastBodyTextSize = presentation.theme.tokens.body_text_size;
    if (this.shouldFail) {
      throw new Error("generator failed");
    }

    return new Uint8Array(Buffer.from("export-bytes", "utf-8"));
  }
}

const buildSession = (userId: string): SessionContext => {
  const appUser: UserRecord = {
    id: userId,
    auth_user_id: `auth-${userId}`,
    email: "user@cvbuilder.dev",
    full_name: "User",
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

const buildTailoredCv = (userId: string): TailoredCvRecord => {
  return {
    id: "tailored-1",
    user_id: userId,
    master_cv_id: "master-1",
    job_id: "job-1",
    title: "Tailored CV",
    language: "en",
    template_id: "template-base",
    current_content: {
      version: "v1",
      language: "en",
      metadata: {
        full_name: "John Doe",
        headline: "Backend Engineer",
        email: "john@example.com"
      },
      sections: []
    },
    status: "ready",
    ai_generation_status: null,
    last_exported_at: null,
    is_deleted: false,
    created_at: nowIso(),
    updated_at: nowIso()
  };
};

const buildMasterCv = (userId: string): MasterCvRecord => {
  return {
    id: "master-1",
    user_id: userId,
    title: "Master CV",
    language: "en",
    template_id: "template-base",
    current_content: {
      version: "v1",
      language: "en",
      metadata: {
        full_name: "John Doe",
        headline: "Backend Engineer",
        email: "john@example.com"
      },
      sections: []
    },
    summary_text: "Master summary",
    source_type: "import",
    is_deleted: false,
    created_at: nowIso(),
    updated_at: nowIso()
  };
};

describe("exports service integration checks", () => {
  it("creates completed PDF and DOCX exports and updates tailored last_exported_at", async () => {
    const userId = randomUUID();
    const session = buildSession(userId);

    const exportsRepository = new InMemoryExportsRepository();
    const tailoredRepository = new InMemoryTailoredCvRepository();
    tailoredRepository.seed(buildTailoredCv(userId));
    const masterRepository = new InMemoryMasterCvRepository();
    masterRepository.seed(buildMasterCv(userId));

    const template: TemplateSummary = {
      id: "template-override",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: {
        pdf: { enabled: true },
        docx: { enabled: true }
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const templatesService = new FakeTemplatesService(new Set(["template-override"]), new Map([[template.id, template]]));
    const renderingService = new FakeRenderingService();
    renderingService.template = template;

    const filesService = new FakeFilesService();
    const generator = new FakeRenderingExportGenerator();

    const service = new ExportsService(
      exportsRepository,
      tailoredRepository,
      masterRepository,
      templatesService as unknown as TemplatesService,
      renderingService as unknown as RenderingService,
      filesService as unknown as FilesService,
      generator,
      noopBillingService
    );

    const pdfResult = await service.createPdfExport(session, "tailored-1", {
      template_id: "template-override"
    });

    const docxResult = await service.createDocxExport(session, "tailored-1", {
      template_id: "template-override"
    });

    expect(pdfResult.export.status).toBe("completed");
    expect(pdfResult.export.format).toBe("pdf");
    expect(pdfResult.download?.download_url).toBe("https://example.com/download");

    expect(docxResult.export.status).toBe("completed");
    expect(docxResult.export.format).toBe("docx");

    const updatedTailored = await tailoredRepository.findById(userId, "tailored-1");
    expect(updatedTailored?.last_exported_at).not.toBeNull();
    expect(updatedTailored?.template_id).toBe("template-base");
  });

  it("applies font scale to presentation theme body size before generation", async () => {
    const userId = randomUUID();
    const session = buildSession(userId);

    const exportsRepository = new InMemoryExportsRepository();
    const tailoredRepository = new InMemoryTailoredCvRepository();
    tailoredRepository.seed(buildTailoredCv(userId));
    const masterRepository = new InMemoryMasterCvRepository();
    masterRepository.seed(buildMasterCv(userId));

    const template: TemplateSummary = {
      id: "template-override",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: {
        pdf: { enabled: true },
        docx: { enabled: true }
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const templatesService = new FakeTemplatesService(new Set(["template-override"]), new Map([[template.id, template]]));
    const renderingService = new FakeRenderingService();
    renderingService.template = template;
    const filesService = new FakeFilesService();
    const generator = new FakeRenderingExportGenerator();

    const service = new ExportsService(
      exportsRepository,
      tailoredRepository,
      masterRepository,
      templatesService as unknown as TemplatesService,
      renderingService as unknown as RenderingService,
      filesService as unknown as FilesService,
      generator,
      noopBillingService
    );

    await service.createPdfExport(session, "tailored-1", {
      template_id: "template-override",
      font_scale: 1.15
    });

    expect(generator.lastBodyTextSize).toBeCloseTo(13.8, 5);
    expect(filesService.lastForcedDownloadFilename).toBe("Tailored CV.pdf");
  });

  it("creates completed master CV export and stores it under master scope", async () => {
    const userId = randomUUID();
    const session = buildSession(userId);

    const exportsRepository = new InMemoryExportsRepository();
    const tailoredRepository = new InMemoryTailoredCvRepository();
    const masterRepository = new InMemoryMasterCvRepository();
    masterRepository.seed(buildMasterCv(userId));

    const template: TemplateSummary = {
      id: "template-override",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: {
        pdf: { enabled: true },
        docx: { enabled: true }
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const templatesService = new FakeTemplatesService(new Set(["template-override"]), new Map([[template.id, template]]));
    const renderingService = new FakeRenderingService();
    renderingService.template = template;

    const filesService = new FakeFilesService();
    const generator = new FakeRenderingExportGenerator();

    const service = new ExportsService(
      exportsRepository,
      tailoredRepository,
      masterRepository,
      templatesService as unknown as TemplatesService,
      renderingService as unknown as RenderingService,
      filesService as unknown as FilesService,
      generator,
      noopBillingService
    );

    const result = await service.createMasterCvPdfExport(session, "master-1", {
      template_id: "template-override"
    });

    expect(result.export.status).toBe("completed");
    expect(result.export.format).toBe("pdf");
    expect(result.master_cv?.id).toBe("master-1");
    expect(result.tailored_cv).toBeNull();
    expect(filesService.createdFiles[0]?.storage_path).toContain("/master-cvs/master-1/exports/");

    const stored = [...exportsRepository.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].master_cv_id).toBe("master-1");
    expect(stored[0].tailored_cv_id).toBeNull();
  });

  it("marks export as failed when generator errors", async () => {
    const userId = randomUUID();
    const session = buildSession(userId);

    const exportsRepository = new InMemoryExportsRepository();
    const tailoredRepository = new InMemoryTailoredCvRepository();
    tailoredRepository.seed(buildTailoredCv(userId));
    const masterRepository = new InMemoryMasterCvRepository();
    masterRepository.seed(buildMasterCv(userId));

    const template: TemplateSummary = {
      id: "template-base",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: {
        pdf: { enabled: true },
        docx: { enabled: true }
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const templatesService = new FakeTemplatesService(new Set(["template-base"]), new Map([[template.id, template]]));
    const renderingService = new FakeRenderingService();
    renderingService.template = template;
    const filesService = new FakeFilesService();

    const generator = new FakeRenderingExportGenerator();
    generator.shouldFail = true;

    const service = new ExportsService(
      exportsRepository,
      tailoredRepository,
      masterRepository,
      templatesService as unknown as TemplatesService,
      renderingService as unknown as RenderingService,
      filesService as unknown as FilesService,
      generator,
      noopBillingService
    );

    await expect(service.createPdfExport(session, "tailored-1", {})).rejects.toBeInstanceOf(
      ExportGenerationFailedError
    );

    const stored = [...exportsRepository.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("failed");
    expect(stored[0].file_id).toBeNull();
  });

  it("marks export as failed when storage upload fails", async () => {
    const userId = randomUUID();
    const session = buildSession(userId);

    const exportsRepository = new InMemoryExportsRepository();
    const tailoredRepository = new InMemoryTailoredCvRepository();
    tailoredRepository.seed(buildTailoredCv(userId));
    const masterRepository = new InMemoryMasterCvRepository();
    masterRepository.seed(buildMasterCv(userId));

    const template: TemplateSummary = {
      id: "template-base",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      preview_config: null,
      export_config: {
        pdf: { enabled: true },
        docx: { enabled: true }
      },
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const templatesService = new FakeTemplatesService(new Set(["template-base"]), new Map([[template.id, template]]));
    const renderingService = new FakeRenderingService();
    renderingService.template = template;
    const filesService = new FakeFilesService();
    filesService.shouldFailUpload = true;

    const service = new ExportsService(
      exportsRepository,
      tailoredRepository,
      masterRepository,
      templatesService as unknown as TemplatesService,
      renderingService as unknown as RenderingService,
      filesService as unknown as FilesService,
      new FakeRenderingExportGenerator(),
      noopBillingService
    );

    await expect(service.createDocxExport(session, "tailored-1", {})).rejects.toBeInstanceOf(
      ExportStorageFailedError
    );

    const stored = [...exportsRepository.rows.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("failed");
    expect(stored[0].file_id).toBeNull();
  });
});
