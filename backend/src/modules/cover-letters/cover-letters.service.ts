import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  ExportGenerationFailedError,
  ExportNotReadyError,
  InternalServerError,
  NotFoundError,
  type AppError
} from "../../shared/errors/app-error";
import type {
  CoverLetterExportRecord,
  CoverLetterRecord,
  ExportFormat,
  FileRecord,
  JobRecord
} from "../../shared/types/domain";
import type { BillingService } from "../billing/billing.service";
import type { FilesService } from "../files/files.service";
import type { JobWithTailoredRecord, JobsRepository } from "../jobs/jobs.repository";
import type { CoverLettersRepository } from "./cover-letters.repository";
import type {
  CoverLetterDetail,
  CoverLetterExportDetailResponse,
  CoverLetterExportDownloadResponse,
  CoverLetterExportFileSummary,
  CoverLetterExportSummaryItem,
  CoverLetterJobSummary,
  CoverLetterSummary,
  ListCoverLetterExportsResponse,
  SessionContext,
  UpdateCoverLetterContentInput
} from "./cover-letters.types";

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

const toPdfSafeText = (value: string): string => {
  if (!value) {
    return "";
  }

  return value
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "s")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "g")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "u")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "o")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
};

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const normalized = toPdfSafeText(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > 0) {
      let take = remaining.length;

      while (take > 1 && font.widthOfTextAtSize(remaining.slice(0, take), size) > maxWidth) {
        take -= 1;
      }

      lines.push(remaining.slice(0, take));
      remaining = remaining.slice(take);
    }

    current = "";
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
};

const generateCoverLetterPdf = async (title: string, content: string): Promise<Uint8Array> => {
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 48;

  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (height: number): void => {
    if (cursorY - height >= MARGIN) {
      return;
    }

    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_HEIGHT - MARGIN;
  };

  const drawLines = (
    lines: string[],
    options: { size: number; lineHeight: number; bold?: boolean; color?: ReturnType<typeof rgb> }
  ) => {
    const font = options.bold ? boldFont : regularFont;
    const color = options.color ?? rgb(0.12, 0.12, 0.12);

    for (const line of lines) {
      ensureSpace(options.lineHeight);
      page.drawText(line, {
        x: MARGIN,
        y: cursorY,
        size: options.size,
        font,
        color
      });
      cursorY -= options.lineHeight;
    }
  };

  drawLines(wrapText(title, boldFont, 18, PAGE_WIDTH - MARGIN * 2), {
    size: 18,
    lineHeight: 24,
    bold: true,
    color: rgb(0.1, 0.22, 0.39)
  });

  cursorY -= 16;

  const paragraphs = content
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    const lines = wrapText(paragraph, regularFont, 11, PAGE_WIDTH - MARGIN * 2);
    drawLines(lines, { size: 11, lineHeight: 17 });
    cursorY -= 8;
  }

  const bytes = await pdf.save();
  return bytes;
};

const generateCoverLetterDocx = async (title: string, content: string): Promise<Uint8Array> => {
  const paragraphs = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              size: 24
            })
          ],
          spacing: {
            after: 160
          }
        })
    );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 34,
                color: "1f3558"
              })
            ],
            spacing: {
              after: 260
            }
          }),
          ...paragraphs
        ]
      }
    ],
    styles: {
      default: {
        document: {
          run: {
            font: "Calibri",
            size: 24
          },
          paragraph: {
            alignment: AlignmentType.LEFT
          }
        }
      }
    }
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
};

const createInitialContent = (job: JobRecord | JobWithTailoredRecord): string => {
  return `Dear Hiring Manager,\n\nI am writing to express my strong interest in the ${job.job_title} position at ${job.company_name}. With my background and experience, I am confident I would be a valuable addition to your team.\n\nThroughout my career, I have developed expertise that directly aligns with the requirements for this role. My experience has equipped me with the skills necessary to contribute effectively to ${job.company_name}'s goals and objectives.\n\nI am particularly drawn to this opportunity because it represents an ideal match between my capabilities and the position requirements. I am excited about the prospect of bringing my unique blend of skills and experience to your organization.\n\nThank you for considering my application. I look forward to the opportunity to discuss how I can contribute to ${job.company_name}'s continued success.\n\nSincerely,\n[Your Name]`;
};

const hasTailoredTitle = (
  job: JobRecord | JobWithTailoredRecord
): job is JobWithTailoredRecord => "tailored_cv_title" in job;

export class CoverLettersService {
  constructor(
    private readonly coverLettersRepository: CoverLettersRepository,
    private readonly jobsRepository: JobsRepository,
    private readonly filesService: FilesService,
    private readonly billingService: BillingService
  ) {}

  async listCoverLetters(session: SessionContext): Promise<{ items: CoverLetterSummary[] }> {
    const rows = await this.coverLettersRepository.listByUser(session.appUser.id);
    const jobs = await this.jobsRepository.findByIds(
      session.appUser.id,
      rows.map((row) => row.job_id)
    );
    const jobsById = new Map(jobs.map((job) => [job.id, job]));

    return {
      items: rows.map((row) => this.toSummary(row, jobsById.get(row.job_id) ?? null))
    };
  }

  async upsertByJob(session: SessionContext, jobId: string): Promise<CoverLetterDetail> {
    const userId = session.appUser.id;
    const job = await this.jobsRepository.findDetailById(userId, jobId);

    if (!job) {
      throw new NotFoundError("Job was not found");
    }

    if (job.cover_letter_id) {
      const existingById = await this.coverLettersRepository.findById(userId, job.cover_letter_id);
      if (existingById) {
        return this.toDetail(existingById, job);
      }
    }

    const existingByJob = await this.coverLettersRepository.findByJobId(userId, job.id);
    if (existingByJob) {
      if (job.cover_letter_id !== existingByJob.id) {
        await this.jobsRepository.linkCoverLetter(userId, job.id, existingByJob.id);
      }
      return this.toDetail(existingByJob, {
        ...job,
        cover_letter_id: existingByJob.id
      });
    }

    const created = await this.coverLettersRepository.create({
      user_id: userId,
      job_id: job.id,
      tailored_cv_id: job.tailored_cv_id,
      title: `Cover Letter - ${job.company_name}`,
      content: createInitialContent(job),
      status: "draft",
      last_exported_at: null
    });

    await this.jobsRepository.linkCoverLetter(userId, job.id, created.id);

    return this.toDetail(created, {
      ...job,
      cover_letter_id: created.id
    });
  }

  async getCoverLetter(session: SessionContext, coverLetterId: string): Promise<CoverLetterDetail> {
    const coverLetter = await this.requireCoverLetter(session.appUser.id, coverLetterId);
    const job = await this.jobsRepository.findDetailById(session.appUser.id, coverLetter.job_id);

    return this.toDetail(coverLetter, job);
  }

  async updateCoverLetterContent(
    session: SessionContext,
    coverLetterId: string,
    input: UpdateCoverLetterContentInput
  ): Promise<CoverLetterDetail> {
    const userId = session.appUser.id;

    await this.requireCoverLetter(userId, coverLetterId);

    const updated = await this.coverLettersRepository.updateById(userId, coverLetterId, {
      title: input.title,
      content: input.content,
      status: input.status
    });

    if (!updated) {
      throw new NotFoundError("Cover letter was not found");
    }

    const job = await this.jobsRepository.findDetailById(userId, updated.job_id);
    return this.toDetail(updated, job);
  }

  async createPdfExport(
    session: SessionContext,
    coverLetterId: string
  ): Promise<CoverLetterExportDetailResponse> {
    return this.createExportByFormat(session, coverLetterId, "pdf");
  }

  async createDocxExport(
    session: SessionContext,
    coverLetterId: string
  ): Promise<CoverLetterExportDetailResponse> {
    return this.createExportByFormat(session, coverLetterId, "docx");
  }

  async listExports(
    session: SessionContext,
    coverLetterId: string
  ): Promise<ListCoverLetterExportsResponse> {
    await this.requireCoverLetter(session.appUser.id, coverLetterId);

    const exports = await this.coverLettersRepository.listExportsByCoverLetter(
      session.appUser.id,
      coverLetterId
    );

    return {
      cover_letter_id: coverLetterId,
      exports: exports.map((row) => this.toExportSummary(row))
    };
  }

  async getExportDetail(
    session: SessionContext,
    coverLetterExportId: string
  ): Promise<CoverLetterExportDetailResponse> {
    const exportRow = await this.requireExport(session.appUser.id, coverLetterExportId);
    const coverLetter = await this.coverLettersRepository.findById(
      session.appUser.id,
      exportRow.cover_letter_id
    );

    const job = coverLetter
      ? await this.jobsRepository.findDetailById(session.appUser.id, coverLetter.job_id)
      : null;

    const file = exportRow.file_id
      ? await this.filesService.findOwnedFileById(session.appUser.id, exportRow.file_id)
      : null;

    let download = null;
    if (exportRow.status === "completed" && file) {
      download = await this.filesService.createSignedDownloadAccess(file);
    }

    return this.toExportDetailResponse(exportRow, coverLetter, job, file, download);
  }

  async getExportDownload(
    session: SessionContext,
    coverLetterExportId: string
  ): Promise<CoverLetterExportDownloadResponse> {
    const exportRow = await this.requireExport(session.appUser.id, coverLetterExportId);

    if (exportRow.status !== "completed" || !exportRow.file_id) {
      throw new ExportNotReadyError("Cover letter export is not ready for download", {
        cover_letter_export_id: exportRow.id,
        status: exportRow.status
      });
    }

    const file = await this.filesService.findOwnedFileById(session.appUser.id, exportRow.file_id);

    if (!file) {
      throw new NotFoundError("Cover letter export file metadata was not found", {
        cover_letter_export_id: exportRow.id,
        file_id: exportRow.file_id
      });
    }

    const download = await this.filesService.createSignedDownloadAccess(file);

    return {
      cover_letter_export_id: exportRow.id,
      format: exportRow.format,
      ...download
    };
  }

  private async createExportByFormat(
    session: SessionContext,
    coverLetterId: string,
    format: ExportFormat
  ): Promise<CoverLetterExportDetailResponse> {
    const userId = session.appUser.id;
    await this.billingService.assertActionAllowed(userId, format === "pdf" ? "export_pdf" : "export_docx");

    const coverLetter = await this.requireCoverLetter(userId, coverLetterId);
    const job = await this.jobsRepository.findDetailById(userId, coverLetter.job_id);

    const created = await this.coverLettersRepository.createExport({
      user_id: userId,
      cover_letter_id: coverLetter.id,
      format,
      status: "processing",
      file_id: null,
      error_message: null,
      completed_at: null
    });

    let uploadedStorage: { storage_bucket: string; storage_path: string } | null = null;
    let fileRecord: FileRecord | null = null;

    try {
      const bytes =
        format === "pdf"
          ? await generateCoverLetterPdf(coverLetter.title, coverLetter.content)
          : await generateCoverLetterDocx(coverLetter.title, coverLetter.content);

      const uploaded = await this.filesService.uploadCoverLetterExportObject({
        userId,
        coverLetterId: coverLetter.id,
        exportId: created.id,
        format,
        bytes
      });

      uploadedStorage = {
        storage_bucket: uploaded.storage_bucket,
        storage_path: uploaded.storage_path
      };

      fileRecord = await this.filesService.createCoverLetterExportFileMetadata({
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
      const completed = await this.coverLettersRepository.updateExportById(userId, created.id, {
        status: "completed",
        file_id: fileRecord.id,
        error_message: null,
        completed_at: completedAt
      });

      if (!completed) {
        throw new InternalServerError("Failed to finalize cover letter export record", {
          cover_letter_export_id: created.id
        });
      }

      await this.coverLettersRepository.updateById(userId, coverLetter.id, {
        last_exported_at: completedAt
      });

      await this.billingService.recordExportUsage(userId, fileRecord.size_bytes);

      let download = null;
      try {
        download = await this.filesService.createSignedDownloadAccess(fileRecord);
      } catch {
        download = null;
      }

      return this.toExportDetailResponse(completed, coverLetter, job, fileRecord, download);
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
        await this.coverLettersRepository.updateExportById(userId, created.id, {
          status: "failed",
          file_id: null,
          error_message: safeMessage,
          completed_at: null
        });
      } catch {
        // Best effort: preserve main error path if failure state update also fails.
      }

      throw this.toAppError(error);
    }
  }

  private async requireCoverLetter(userId: string, coverLetterId: string): Promise<CoverLetterRecord> {
    const row = await this.coverLettersRepository.findById(userId, coverLetterId);

    if (!row) {
      throw new NotFoundError("Cover letter was not found");
    }

    return row;
  }

  private async requireExport(
    userId: string,
    coverLetterExportId: string
  ): Promise<CoverLetterExportRecord> {
    const row = await this.coverLettersRepository.findExportById(userId, coverLetterExportId);

    if (!row) {
      throw new NotFoundError("Cover letter export was not found");
    }

    return row;
  }

  private toJobSummary(job: JobRecord | JobWithTailoredRecord | null): CoverLetterJobSummary | null {
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      company_name: job.company_name,
      job_title: job.job_title,
      status: job.status,
      tailored_cv_id: job.tailored_cv_id,
      tailored_cv_title: hasTailoredTitle(job) ? job.tailored_cv_title : null,
      cover_letter_id: job.cover_letter_id
    };
  }

  private toSummary(
    row: CoverLetterRecord,
    job: JobRecord | JobWithTailoredRecord | null
  ): CoverLetterSummary {
    return {
      id: row.id,
      job_id: row.job_id,
      tailored_cv_id: row.tailored_cv_id,
      title: row.title,
      status: row.status,
      last_exported_at: row.last_exported_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      job: this.toJobSummary(job)
    };
  }

  private toDetail(
    row: CoverLetterRecord,
    job: JobRecord | JobWithTailoredRecord | null
  ): CoverLetterDetail {
    return {
      ...this.toSummary(row, job),
      content: row.content
    };
  }

  private toExportSummary(row: CoverLetterExportRecord): CoverLetterExportSummaryItem {
    return {
      id: row.id,
      format: row.format,
      status: row.status,
      file_id: row.file_id,
      created_at: row.created_at,
      completed_at: row.completed_at,
      error_message: row.status === "failed" ? row.error_message : null,
      download_available: row.status === "completed" && Boolean(row.file_id)
    };
  }

  private toExportFileSummary(file: FileRecord | null): CoverLetterExportFileSummary | null {
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

  private toExportDetailResponse(
    exportRow: CoverLetterExportRecord,
    coverLetter: CoverLetterRecord | null,
    job: JobRecord | JobWithTailoredRecord | null,
    file: FileRecord | null,
    download: CoverLetterExportDetailResponse["download"]
  ): CoverLetterExportDetailResponse {
    return {
      export: this.toExportSummary(exportRow),
      cover_letter: coverLetter ? this.toSummary(coverLetter, job) : null,
      file: this.toExportFileSummary(file),
      download
    };
  }

  private toSafeFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return truncateErrorMessage(error.message);
    }

    return "Export failed";
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof NotFoundError) {
      return error;
    }

    if (error instanceof ExportGenerationFailedError) {
      return error;
    }

    if (error instanceof InternalServerError) {
      return error;
    }

    return new ExportGenerationFailedError("Failed to generate cover letter export", {
      reason: error instanceof Error ? error.message : "unknown_export_error"
    });
  }
}
