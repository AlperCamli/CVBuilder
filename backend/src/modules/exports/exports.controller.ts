import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { ExportsService } from "./exports.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  createPdfExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.createPdfExport(
      requireSession(request),
      request.params.tailoredCvId,
      request.body
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  createMasterCvPdfExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.createMasterCvPdfExport(
      requireSession(request),
      request.params.masterCvId,
      request.body
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  createDocxExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.createDocxExport(
      requireSession(request),
      request.params.tailoredCvId,
      request.body
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  createMasterCvDocxExport = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.createMasterCvDocxExport(
      requireSession(request),
      request.params.masterCvId,
      request.body
    );

    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  listTailoredCvExports = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.listTailoredCvExports(
      requireSession(request),
      request.params.tailoredCvId
    );

    sendSuccess(response, data);
  });

  listMasterCvExports = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.listMasterCvExports(
      requireSession(request),
      request.params.masterCvId
    );

    sendSuccess(response, data);
  });

  getExportDetail = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.getExportDetail(requireSession(request), request.params.exportId);
    sendSuccess(response, data);
  });

  getExportDownload = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.exportsService.getExportDownload(
      requireSession(request),
      request.params.exportId
    );

    sendSuccess(response, data);
  });
}
