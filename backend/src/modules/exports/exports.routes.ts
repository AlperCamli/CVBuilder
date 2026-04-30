import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { ExportsController } from "./exports.controller";
import {
  createExportSchema,
  exportIdParamSchema,
  masterCvExportParamsSchema,
  tailoredCvExportParamsSchema
} from "./exports.schemas";

export const createExportsRouter = (
  exportsController: ExportsController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.post(
    "/tailored-cvs/:tailoredCvId/exports/pdf",
    authMiddleware,
    validate({ params: tailoredCvExportParamsSchema, body: createExportSchema }),
    exportsController.createPdfExport
  );

  router.post(
    "/tailored-cvs/:tailoredCvId/exports/docx",
    authMiddleware,
    validate({ params: tailoredCvExportParamsSchema, body: createExportSchema }),
    exportsController.createDocxExport
  );

  router.post(
    "/master-cvs/:masterCvId/exports/pdf",
    authMiddleware,
    validate({ params: masterCvExportParamsSchema, body: createExportSchema }),
    exportsController.createMasterCvPdfExport
  );

  router.post(
    "/master-cvs/:masterCvId/exports/docx",
    authMiddleware,
    validate({ params: masterCvExportParamsSchema, body: createExportSchema }),
    exportsController.createMasterCvDocxExport
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/exports",
    authMiddleware,
    validate({ params: tailoredCvExportParamsSchema }),
    exportsController.listTailoredCvExports
  );

  router.get(
    "/master-cvs/:masterCvId/exports",
    authMiddleware,
    validate({ params: masterCvExportParamsSchema }),
    exportsController.listMasterCvExports
  );

  router.get(
    "/exports/:exportId",
    authMiddleware,
    validate({ params: exportIdParamSchema }),
    exportsController.getExportDetail
  );

  router.get(
    "/exports/:exportId/download",
    authMiddleware,
    validate({ params: exportIdParamSchema }),
    exportsController.getExportDownload
  );

  return router;
};
