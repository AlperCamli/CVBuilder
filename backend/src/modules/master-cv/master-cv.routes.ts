import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { MasterCvController } from "./master-cv.controller";
import {
  assignMasterCvTemplateSchema,
  createMasterCvSchema,
  masterCvBlockParamsSchema,
  masterCvIdParamSchema,
  replaceMasterCvContentSchema,
  updateMasterCvBlockSchema,
  updateMasterCvSchema
} from "./master-cv.schemas";

export const createMasterCvRouter = (
  masterCvController: MasterCvController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/master-cvs", authMiddleware, masterCvController.listMasterCvs);
  router.post(
    "/master-cvs",
    authMiddleware,
    validate({ body: createMasterCvSchema }),
    masterCvController.createMasterCv
  );

  router.get(
    "/master-cvs/:masterCvId/preview",
    authMiddleware,
    validate({ params: masterCvIdParamSchema }),
    masterCvController.previewMasterCv
  );

  router.put(
    "/master-cvs/:masterCvId/content",
    authMiddleware,
    validate({ params: masterCvIdParamSchema, body: replaceMasterCvContentSchema }),
    masterCvController.putMasterCvContent
  );

  router.patch(
    "/master-cvs/:masterCvId/blocks/:blockId",
    authMiddleware,
    validate({ params: masterCvBlockParamsSchema, body: updateMasterCvBlockSchema }),
    masterCvController.patchMasterCvBlock
  );

  router.post(
    "/master-cvs/:masterCvId/duplicate",
    authMiddleware,
    validate({ params: masterCvIdParamSchema }),
    masterCvController.duplicateMasterCv
  );

  router.get(
    "/master-cvs/:masterCvId",
    authMiddleware,
    validate({ params: masterCvIdParamSchema }),
    masterCvController.getMasterCv
  );

  router.patch(
    "/master-cvs/:masterCvId/template",
    authMiddleware,
    validate({ params: masterCvIdParamSchema, body: assignMasterCvTemplateSchema }),
    masterCvController.patchMasterCvTemplate
  );

  router.patch(
    "/master-cvs/:masterCvId",
    authMiddleware,
    validate({ params: masterCvIdParamSchema, body: updateMasterCvSchema }),
    masterCvController.patchMasterCv
  );

  router.delete(
    "/master-cvs/:masterCvId",
    authMiddleware,
    validate({ params: masterCvIdParamSchema }),
    masterCvController.deleteMasterCv
  );

  return router;
};
