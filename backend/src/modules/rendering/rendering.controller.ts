import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { CvPhotosService } from "../cv-photos/cv-photos.service";
import type { RenderingService } from "./rendering.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class RenderingController {
  constructor(
    private readonly renderingService: RenderingService,
    private readonly cvPhotosService: CvPhotosService
  ) {}

  buildPreview = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    const data = await this.renderingService.previewFromRawInput(session, request.body);

    // The stored photo reference is a managed files.id (or a legacy data URI); resolve it to
    // a signed URL so the preview can render the image directly.
    data.presentation.header.photo = await this.cvPhotosService.resolveSignedUrl(
      session.appUser.id,
      data.presentation.header.photo
    );

    sendSuccess(response, data);
  });
}
