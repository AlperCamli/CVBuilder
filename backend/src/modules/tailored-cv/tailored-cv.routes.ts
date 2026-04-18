import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { TailoredCvController } from "./tailored-cv.controller";
import {
  assignTailoredCvTemplateSchema,
  createTailoredCvSchema,
  listTailoredCvsQuerySchema,
  replaceTailoredCvContentSchema,
  tailoredCvBlockParamsSchema,
  tailoredCvIdParamSchema,
  updateTailoredCvBlockSchema,
  updateTailoredCvSchema
} from "./tailored-cv.schemas";

export const createTailoredCvRouter = (
  tailoredCvController: TailoredCvController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get(
    "/tailored-cvs",
    authMiddleware,
    validate({ query: listTailoredCvsQuerySchema }),
    tailoredCvController.listTailoredCvs
  );

  router.post(
    "/tailored-cvs",
    authMiddleware,
    validate({ body: createTailoredCvSchema }),
    tailoredCvController.createTailoredCv
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/preview",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema }),
    tailoredCvController.previewTailoredCv
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/source",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema }),
    tailoredCvController.getTailoredCvSource
  );

  router.put(
    "/tailored-cvs/:tailoredCvId/content",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema, body: replaceTailoredCvContentSchema }),
    tailoredCvController.putTailoredCvContent
  );

  router.patch(
    "/tailored-cvs/:tailoredCvId/blocks/:blockId",
    authMiddleware,
    validate({ params: tailoredCvBlockParamsSchema, body: updateTailoredCvBlockSchema }),
    tailoredCvController.patchTailoredCvBlock
  );

  router.get(
    "/tailored-cvs/:tailoredCvId",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema }),
    tailoredCvController.getTailoredCv
  );

  router.patch(
    "/tailored-cvs/:tailoredCvId/template",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema, body: assignTailoredCvTemplateSchema }),
    tailoredCvController.patchTailoredCvTemplate
  );

  router.patch(
    "/tailored-cvs/:tailoredCvId",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema, body: updateTailoredCvSchema }),
    tailoredCvController.patchTailoredCv
  );

  router.delete(
    "/tailored-cvs/:tailoredCvId",
    authMiddleware,
    validate({ params: tailoredCvIdParamSchema }),
    tailoredCvController.deleteTailoredCv
  );

  return router;
};
