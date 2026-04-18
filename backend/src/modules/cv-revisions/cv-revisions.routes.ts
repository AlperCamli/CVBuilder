import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { CvRevisionsController } from "./cv-revisions.controller";
import {
  compareRevisionsSchema,
  revisionIdParamsSchema,
  tailoredCvBlockRevisionsParamsSchema,
  tailoredCvRevisionsParamsSchema
} from "./cv-revisions.schemas";

export const createCvRevisionsRouter = (
  cvRevisionsController: CvRevisionsController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get(
    "/tailored-cvs/:tailoredCvId/revisions",
    authMiddleware,
    validate({ params: tailoredCvRevisionsParamsSchema }),
    cvRevisionsController.listTailoredCvRevisions
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/blocks/:blockId/revisions",
    authMiddleware,
    validate({ params: tailoredCvBlockRevisionsParamsSchema }),
    cvRevisionsController.listBlockRevisions
  );

  router.get(
    "/revisions/:revisionId",
    authMiddleware,
    validate({ params: revisionIdParamsSchema }),
    cvRevisionsController.getRevisionDetail
  );

  router.post(
    "/revisions/:revisionId/restore",
    authMiddleware,
    validate({ params: revisionIdParamsSchema }),
    cvRevisionsController.restoreRevision
  );

  router.post(
    "/revisions/compare",
    authMiddleware,
    validate({ body: compareRevisionsSchema }),
    cvRevisionsController.compareRevisions
  );

  return router;
};
