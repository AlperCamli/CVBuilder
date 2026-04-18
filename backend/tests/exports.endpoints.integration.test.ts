import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import type { ExportsService } from "../src/modules/exports/exports.service";
import type {
  CreateExportInput,
  ExportDetailResponse,
  ExportDownloadResponse,
  ListTailoredCvExportsResponse,
  SessionContext
} from "../src/modules/exports/exports.types";
import type { TemplateSummary } from "../src/modules/templates/templates.types";
import { ExportNotReadyError, NotFoundError } from "../src/shared/errors/app-error";
import {
  FakeAuthProvider,
  InMemorySubscriptionsRepository,
  InMemoryUsageRepository,
  InMemoryUsersRepository,
  createTestConfig
} from "./helpers/in-memory";

const USER_A_TAILORED_ID = "10000000-0000-0000-0000-000000000001";
const USER_B_TAILORED_ID = "20000000-0000-0000-0000-000000000001";
const USER_A_EXPORT_COMPLETED_ID = "10000000-0000-0000-0000-000000000111";
const USER_A_EXPORT_PROCESSING_ID = "10000000-0000-0000-0000-000000000112";

const nowIso = (): string => new Date().toISOString();

interface ExportStoreRow {
  id: string;
  user_key: string;
  tailored_cv_id: string;
  format: "pdf" | "docx";
  status: "processing" | "completed" | "failed";
  file_id: string | null;
  template: TemplateSummary | null;
}

class FakeExportsService {
  private readonly rows = new Map<string, ExportStoreRow>();

  constructor() {
    this.rows.set(USER_A_EXPORT_COMPLETED_ID, {
      id: USER_A_EXPORT_COMPLETED_ID,
      user_key: "auth-a",
      tailored_cv_id: USER_A_TAILORED_ID,
      format: "pdf",
      status: "completed",
      file_id: "30000000-0000-0000-0000-000000000999",
      template: {
        id: "40000000-0000-0000-0000-000000000001",
        name: "Modern Clean",
        slug: "modern-clean",
        status: "active",
        preview_config: null,
        export_config: {
          pdf: {
            enabled: true
          }
        },
        created_at: nowIso(),
        updated_at: nowIso()
      }
    });

    this.rows.set(USER_A_EXPORT_PROCESSING_ID, {
      id: USER_A_EXPORT_PROCESSING_ID,
      user_key: "auth-a",
      tailored_cv_id: USER_A_TAILORED_ID,
      format: "docx",
      status: "processing",
      file_id: null,
      template: null
    });
  }

  private toDetail(row: ExportStoreRow): ExportDetailResponse {
    return {
      export: {
        id: row.id,
        format: row.format,
        status: row.status,
        template_id: row.template?.id ?? null,
        file_id: row.file_id,
        created_at: nowIso(),
        completed_at: row.status === "completed" ? nowIso() : null,
        error_message: row.status === "failed" ? "Export failed" : null,
        download_available: row.status === "completed" && Boolean(row.file_id)
      },
      tailored_cv: {
        id: row.tailored_cv_id,
        title: "Tailored CV",
        status: "ready",
        template_id: null,
        updated_at: nowIso()
      },
      file:
        row.status === "completed" && row.file_id
          ? {
              id: row.file_id,
              file_type: row.format === "pdf" ? "export_pdf" : "export_docx",
              original_filename: `export-${row.id}.${row.format}`,
              mime_type:
                row.format === "pdf"
                  ? "application/pdf"
                  : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              size_bytes: 123,
              created_at: nowIso()
            }
          : null,
      template: row.template,
      resolved_template: row.template
        ? {
            resolution: "selected",
            template: row.template
          }
        : {
            resolution: "none",
            template: null
          },
      download:
        row.status === "completed"
          ? {
              download_url: "https://example.com/download",
              expires_at: nowIso(),
              expires_in_seconds: 600
            }
          : null
    };
  }

  async createPdfExport(
    session: SessionContext,
    tailoredCvId: string,
    _input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    if (
      (session.authUser.auth_user_id === "auth-a" && tailoredCvId !== USER_A_TAILORED_ID) ||
      (session.authUser.auth_user_id === "auth-b" && tailoredCvId !== USER_B_TAILORED_ID)
    ) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const id =
      session.authUser.auth_user_id === "auth-a"
        ? "10000000-0000-0000-0000-000000000210"
        : "20000000-0000-0000-0000-000000000210";
    const row: ExportStoreRow = {
      id,
      user_key: session.authUser.auth_user_id,
      tailored_cv_id: tailoredCvId,
      format: "pdf",
      status: "completed",
      file_id: `file-${id}`,
      template: null
    };

    this.rows.set(id, row);
    return this.toDetail(row);
  }

  async createDocxExport(
    session: SessionContext,
    tailoredCvId: string,
    _input: CreateExportInput
  ): Promise<ExportDetailResponse> {
    if (
      (session.authUser.auth_user_id === "auth-a" && tailoredCvId !== USER_A_TAILORED_ID) ||
      (session.authUser.auth_user_id === "auth-b" && tailoredCvId !== USER_B_TAILORED_ID)
    ) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const id =
      session.authUser.auth_user_id === "auth-a"
        ? "10000000-0000-0000-0000-000000000211"
        : "20000000-0000-0000-0000-000000000211";
    const row: ExportStoreRow = {
      id,
      user_key: session.authUser.auth_user_id,
      tailored_cv_id: tailoredCvId,
      format: "docx",
      status: "completed",
      file_id: `file-${id}`,
      template: null
    };

    this.rows.set(id, row);
    return this.toDetail(row);
  }

  async listTailoredCvExports(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<ListTailoredCvExportsResponse> {
    if (
      (session.authUser.auth_user_id === "auth-a" && tailoredCvId !== USER_A_TAILORED_ID) ||
      (session.authUser.auth_user_id === "auth-b" && tailoredCvId !== USER_B_TAILORED_ID)
    ) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const items = [...this.rows.values()]
      .filter(
        (row) =>
          row.user_key === session.authUser.auth_user_id && row.tailored_cv_id === tailoredCvId
      )
      .map((row) => this.toDetail(row).export);

    return {
      tailored_cv_id: tailoredCvId,
      exports: items
    };
  }

  async getExportDetail(session: SessionContext, exportId: string): Promise<ExportDetailResponse> {
    const row = this.rows.get(exportId);

    if (!row || row.user_key !== session.authUser.auth_user_id) {
      throw new NotFoundError("Export was not found");
    }

    return this.toDetail(row);
  }

  async getExportDownload(session: SessionContext, exportId: string): Promise<ExportDownloadResponse> {
    const row = this.rows.get(exportId);

    if (!row || row.user_key !== session.authUser.auth_user_id) {
      throw new NotFoundError("Export was not found");
    }

    if (row.status !== "completed") {
      throw new ExportNotReadyError("Export is not ready for download");
    }

    return {
      export_id: row.id,
      format: row.format,
      download_url: "https://example.com/download",
      expires_at: nowIso(),
      expires_in_seconds: 600
    };
  }
}

const buildApp = () => {
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const usageRepository = new InMemoryUsageRepository();

  const authProvider = new FakeAuthProvider({
    "token-a": {
      auth_user_id: "auth-a",
      email: "a@cvbuilder.dev",
      full_name: "User A",
      locale: "en"
    },
    "token-b": {
      auth_user_id: "auth-b",
      email: "b@cvbuilder.dev",
      full_name: "User B",
      locale: "en"
    }
  });

  const authService = new AuthService(authProvider, usersRepository);
  const exportsService = new FakeExportsService();

  return createApp({
    config: createTestConfig(),
    services: {
      authService,
      exportsService: exportsService as unknown as ExportsService
    },
    serviceOverrides: {
      usersRepository,
      billingSubscriptionsRepository: subscriptionsRepository,
      usageRepository
    }
  });
};

describe("exports endpoints", () => {
  it("requires authentication", async () => {
    const app = buildApp();

    const response = await request(app).get(`/api/v1/exports/${USER_A_EXPORT_COMPLETED_ID}`);

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("supports create/list/detail/download contracts for owner", async () => {
    const app = buildApp();

    const createdPdf = await request(app)
      .post(`/api/v1/tailored-cvs/${USER_A_TAILORED_ID}/exports/pdf`)
      .set("Authorization", "Bearer token-a")
      .send({});

    const createdDocx = await request(app)
      .post(`/api/v1/tailored-cvs/${USER_A_TAILORED_ID}/exports/docx`)
      .set("Authorization", "Bearer token-a")
      .send({});

    const listed = await request(app)
      .get(`/api/v1/tailored-cvs/${USER_A_TAILORED_ID}/exports`)
      .set("Authorization", "Bearer token-a");

    const detailed = await request(app)
      .get(`/api/v1/exports/${USER_A_EXPORT_COMPLETED_ID}`)
      .set("Authorization", "Bearer token-a");

    const download = await request(app)
      .get(`/api/v1/exports/${USER_A_EXPORT_COMPLETED_ID}/download`)
      .set("Authorization", "Bearer token-a");

    expect(createdPdf.status).toBe(201);
    expect(createdPdf.body.success).toBe(true);
    expect(createdPdf.body.data.export.format).toBe("pdf");

    expect(createdDocx.status).toBe(201);
    expect(createdDocx.body.success).toBe(true);
    expect(createdDocx.body.data.export.format).toBe("docx");

    expect(listed.status).toBe(200);
    expect(listed.body.success).toBe(true);
    expect(Array.isArray(listed.body.data.exports)).toBe(true);
    expect(listed.body.data.exports.length).toBeGreaterThan(0);

    expect(detailed.status).toBe(200);
    expect(detailed.body.success).toBe(true);
    expect(detailed.body.data.export.id).toBe(USER_A_EXPORT_COMPLETED_ID);

    expect(download.status).toBe(200);
    expect(download.body.success).toBe(true);
    expect(download.body.data.export_id).toBe(USER_A_EXPORT_COMPLETED_ID);
    expect(download.body.data.download_url).toContain("https://example.com/download");
  });

  it("enforces ownership checks on export resources", async () => {
    const app = buildApp();

    const detail = await request(app)
      .get(`/api/v1/exports/${USER_A_EXPORT_COMPLETED_ID}`)
      .set("Authorization", "Bearer token-b");

    const list = await request(app)
      .get(`/api/v1/tailored-cvs/${USER_A_TAILORED_ID}/exports`)
      .set("Authorization", "Bearer token-b");

    expect(detail.status).toBe(404);
    expect(detail.body.success).toBe(false);
    expect(detail.body.error.code).toBe("NOT_FOUND");

    expect(list.status).toBe(404);
    expect(list.body.success).toBe(false);
    expect(list.body.error.code).toBe("NOT_FOUND");
  });

  it("returns EXPORT_NOT_READY when download is requested before completion", async () => {
    const app = buildApp();

    const response = await request(app)
      .get(`/api/v1/exports/${USER_A_EXPORT_PROCESSING_ID}/download`)
      .set("Authorization", "Bearer token-a");

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("EXPORT_NOT_READY");
  });
});
