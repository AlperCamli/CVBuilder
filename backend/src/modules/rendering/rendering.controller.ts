import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { RenderingService } from "./rendering.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class RenderingController {
  constructor(private readonly renderingService: RenderingService) {}

  buildPreview = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.renderingService.previewFromRawInput(requireSession(request), request.body);
    sendSuccess(response, data);
  });
}
