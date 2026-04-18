import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { TemplatesService } from "./templates.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  listTemplates = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.templatesService.listTemplates(requireSession(request));
    sendSuccess(response, data);
  });

  getTemplate = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.templatesService.getTemplate(
      requireSession(request),
      request.params.templateId
    );
    sendSuccess(response, data);
  });
}
