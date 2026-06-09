import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { CvPhotosService } from "./cv-photos.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class CvPhotosController {
  constructor(private readonly cvPhotosService: CvPhotosService) {}

  createUploadUrl = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    const data = await this.cvPhotosService.createUploadTarget(session.appUser.id, {
      contentType: request.body.content_type,
      sizeBytes: request.body.size_bytes
    });
    sendSuccess(response, data);
  });

  completeUpload = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    const data = await this.cvPhotosService.completeUpload(session.appUser.id, request.params.fileId, {
      storagePath: request.body.storage_path
    });
    sendSuccess(response, data);
  });

  getUrl = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    const data = await this.cvPhotosService.getSignedUrl(session.appUser.id, request.params.fileId);
    sendSuccess(response, data);
  });

  remove = asyncHandler(async (request: Request, response: Response) => {
    const session = requireSession(request);
    await this.cvPhotosService.remove(session.appUser.id, request.params.fileId);
    sendSuccess(response, { deleted: true });
  });
}
