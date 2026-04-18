import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { MasterCvService } from "./master-cv.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class MasterCvController {
  constructor(private readonly masterCvService: MasterCvService) {}

  listMasterCvs = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.listMasterCvs(requireSession(request));
    sendSuccess(response, data);
  });

  createMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.createMasterCv(requireSession(request), request.body);
    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  getMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.getMasterCv(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data);
  });

  patchMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.updateMasterCv(
      requireSession(request),
      request.params.masterCvId,
      request.body
    );
    sendSuccess(response, data);
  });

  patchMasterCvTemplate = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.assignTemplate(
      requireSession(request),
      request.params.masterCvId,
      request.body.template_id
    );
    sendSuccess(response, data);
  });

  putMasterCvContent = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.replaceMasterCvContent(
      requireSession(request),
      request.params.masterCvId,
      request.body
    );
    sendSuccess(response, data);
  });

  patchMasterCvBlock = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.updateMasterCvBlock(
      requireSession(request),
      request.params.masterCvId,
      request.params.blockId,
      request.body
    );
    sendSuccess(response, data);
  });

  duplicateMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.duplicateMasterCv(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  deleteMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.deleteMasterCv(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data);
  });

  previewMasterCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.masterCvService.getMasterCvPreview(
      requireSession(request),
      request.params.masterCvId
    );
    sendSuccess(response, data);
  });
}
