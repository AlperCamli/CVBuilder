import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { CoverLettersService } from "./cover-letters.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class CoverLettersController {
  constructor(private readonly coverLettersService: CoverLettersService) {}

  listCoverLetters = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.listCoverLetters(requireSession(request));
    sendSuccess(response, data);
  });

  upsertCoverLetterForJob = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.upsertByJob(requireSession(request), request.params.jobId);
    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  getCoverLetter = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.getCoverLetter(
      requireSession(request),
      request.params.coverLetterId
    );
    sendSuccess(response, data);
  });

  putCoverLetterContent = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.updateCoverLetterContent(
      requireSession(request),
      request.params.coverLetterId,
      request.body
    );
    sendSuccess(response, data);
  });

  createPdfExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.createPdfExport(
      requireSession(request),
      request.params.coverLetterId
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  createDocxExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.createDocxExport(
      requireSession(request),
      request.params.coverLetterId
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  listExports = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.listExports(
      requireSession(request),
      request.params.coverLetterId
    );
    sendSuccess(response, data);
  });

  getExportDetail = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.getExportDetail(
      requireSession(request),
      request.params.coverLetterExportId
    );
    sendSuccess(response, data);
  });

  getExportDownload = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.coverLettersService.getExportDownload(
      requireSession(request),
      request.params.coverLetterExportId
    );
    sendSuccess(response, data);
  });
}
