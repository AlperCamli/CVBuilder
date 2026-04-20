import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { ImportsController } from "./imports.controller";
import {
  createImportSessionSchema,
  createImportUploadUrlSchema,
  createMasterCvFromImportSchema,
  importIdParamSchema,
  updateImportResultSchema
} from "./imports.schemas";

export const createImportsRouter = (
  importsController: ImportsController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.post(
    "/imports/upload-url",
    authMiddleware,
    validate({ body: createImportUploadUrlSchema }),
    importsController.createImportUploadUrl
  );

  router.post(
    "/imports",
    authMiddleware,
    validate({ body: createImportSessionSchema }),
    importsController.createImportSession
  );

  router.get(
    "/imports/:importId",
    authMiddleware,
    validate({ params: importIdParamSchema }),
    importsController.getImportDetail
  );

  router.post(
    "/imports/:importId/upload-complete",
    authMiddleware,
    validate({ params: importIdParamSchema }),
    importsController.markUploadComplete
  );

  router.post(
    "/imports/:importId/parse",
    authMiddleware,
    validate({ params: importIdParamSchema }),
    importsController.parseImport
  );

  router.get(
    "/imports/:importId/result",
    authMiddleware,
    validate({ params: importIdParamSchema }),
    importsController.getImportResult
  );

  router.patch(
    "/imports/:importId/result",
    authMiddleware,
    validate({ params: importIdParamSchema, body: updateImportResultSchema }),
    importsController.patchImportResult
  );

  router.post(
    "/imports/:importId/create-master-cv",
    authMiddleware,
    validate({ params: importIdParamSchema, body: createMasterCvFromImportSchema }),
    importsController.createMasterCvFromImport
  );

  return router;
};
