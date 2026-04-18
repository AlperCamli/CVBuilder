import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { TailoredCvService } from "./tailored-cv.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class TailoredCvController {
  constructor(private readonly tailoredCvService: TailoredCvService) {}

  listTailoredCvs = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.listTailoredCvs(requireSession(request), request.query);
    sendSuccess(response, data);
  });

  createTailoredCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.createTailoredCv(requireSession(request), request.body);
    sendSuccess(response, data, {
      statusCode: 201
    });
  });

  getTailoredCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.getTailoredCv(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  patchTailoredCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.updateTailoredCv(
      requireSession(request),
      request.params.tailoredCvId,
      request.body
    );
    sendSuccess(response, data);
  });

  patchTailoredCvTemplate = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.assignTemplate(
      requireSession(request),
      request.params.tailoredCvId,
      request.body.template_id
    );
    sendSuccess(response, data);
  });

  putTailoredCvContent = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.replaceTailoredCvContent(
      requireSession(request),
      request.params.tailoredCvId,
      request.body
    );
    sendSuccess(response, data);
  });

  patchTailoredCvBlock = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.updateTailoredCvBlock(
      requireSession(request),
      request.params.tailoredCvId,
      request.params.blockId,
      request.body
    );
    sendSuccess(response, data);
  });

  deleteTailoredCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.deleteTailoredCv(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  previewTailoredCv = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.getTailoredCvPreview(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  getTailoredCvSource = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.tailoredCvService.getTailoredCvSource(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });
}
