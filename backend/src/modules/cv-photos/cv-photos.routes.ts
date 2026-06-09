import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { CvPhotosController } from "./cv-photos.controller";
import {
  completeCvPhotoUploadSchema,
  createCvPhotoUploadUrlSchema,
  cvPhotoIdParamSchema
} from "./cv-photos.schemas";

export const createCvPhotosRouter = (
  cvPhotosController: CvPhotosController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.post(
    "/cv-photos/upload-url",
    authMiddleware,
    validate({ body: createCvPhotoUploadUrlSchema }),
    cvPhotosController.createUploadUrl
  );

  router.post(
    "/cv-photos/:fileId/complete",
    authMiddleware,
    validate({ params: cvPhotoIdParamSchema, body: completeCvPhotoUploadSchema }),
    cvPhotosController.completeUpload
  );

  router.get(
    "/cv-photos/:fileId/url",
    authMiddleware,
    validate({ params: cvPhotoIdParamSchema }),
    cvPhotosController.getUrl
  );

  router.delete(
    "/cv-photos/:fileId",
    authMiddleware,
    validate({ params: cvPhotoIdParamSchema }),
    cvPhotosController.remove
  );

  return router;
};
