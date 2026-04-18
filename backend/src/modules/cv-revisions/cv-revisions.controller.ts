import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { CvRevisionsService } from "./cv-revisions.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class CvRevisionsController {
  constructor(private readonly cvRevisionsService: CvRevisionsService) {}

  listTailoredCvRevisions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.cvRevisionsService.listTailoredCvRevisions(
      requireSession(request),
      request.params.tailoredCvId
    );
    sendSuccess(response, data);
  });

  listBlockRevisions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.cvRevisionsService.listBlockRevisions(
      requireSession(request),
      request.params.tailoredCvId,
      request.params.blockId
    );
    sendSuccess(response, data);
  });

  getRevisionDetail = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.cvRevisionsService.getRevisionDetail(
      requireSession(request),
      request.params.revisionId
    );
    sendSuccess(response, data);
  });

  restoreRevision = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.cvRevisionsService.restoreRevision(
      requireSession(request),
      request.params.revisionId
    );
    sendSuccess(response, data);
  });

  compareRevisions = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.cvRevisionsService.compareRevisions(
      requireSession(request),
      request.body.from_revision_id,
      request.body.to_revision_id
    );
    sendSuccess(response, data);
  });
}
