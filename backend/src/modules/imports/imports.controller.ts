import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { ImportsService } from "./imports.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  createImportSession = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.createImportSession(requireSession(request), request.body);
    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  getImportDetail = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.getImportDetail(requireSession(request), request.params.importId);
    sendSuccess(response, data);
  });

  markUploadComplete = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.markUploadComplete(
      requireSession(request),
      request.params.importId
    );
    sendSuccess(response, data);
  });

  parseImport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.parseImport(requireSession(request), request.params.importId);
    sendSuccess(response, data);
  });

  getImportResult = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.getImportResult(requireSession(request), request.params.importId);
    sendSuccess(response, data);
  });

  patchImportResult = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.updateImportResult(
      requireSession(request),
      request.params.importId,
      request.body
    );
    sendSuccess(response, data);
  });

  createMasterCvFromImport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.importsService.createMasterCvFromImport(
      requireSession(request),
      request.params.importId,
      request.body
    );
    sendSuccess(response, data, {
      statusCode: 201
    });
  });
}
