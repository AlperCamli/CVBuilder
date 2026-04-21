import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { CoverLettersController } from "./cover-letters.controller";
import {
  coverLetterExportIdParamSchema,
  coverLetterIdParamSchema,
  coverLetterJobIdParamSchema,
  updateCoverLetterContentSchema
} from "./cover-letters.schemas";

export const createCoverLettersRouter = (
  coverLettersController: CoverLettersController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/cover-letters", authMiddleware, coverLettersController.listCoverLetters);

  router.post(
    "/jobs/:jobId/cover-letter",
    authMiddleware,
    validate({ params: coverLetterJobIdParamSchema }),
    coverLettersController.upsertCoverLetterForJob
  );

  router.get(
    "/cover-letters/:coverLetterId",
    authMiddleware,
    validate({ params: coverLetterIdParamSchema }),
    coverLettersController.getCoverLetter
  );

  router.put(
    "/cover-letters/:coverLetterId/content",
    authMiddleware,
    validate({ params: coverLetterIdParamSchema, body: updateCoverLetterContentSchema }),
    coverLettersController.putCoverLetterContent
  );

  router.post(
    "/cover-letters/:coverLetterId/exports/pdf",
    authMiddleware,
    validate({ params: coverLetterIdParamSchema }),
    coverLettersController.createPdfExport
  );

  router.post(
    "/cover-letters/:coverLetterId/exports/docx",
    authMiddleware,
    validate({ params: coverLetterIdParamSchema }),
    coverLettersController.createDocxExport
  );

  router.get(
    "/cover-letters/:coverLetterId/exports",
    authMiddleware,
    validate({ params: coverLetterIdParamSchema }),
    coverLettersController.listExports
  );

  router.get(
    "/cover-letter-exports/:coverLetterExportId",
    authMiddleware,
    validate({ params: coverLetterExportIdParamSchema }),
    coverLettersController.getExportDetail
  );

  router.get(
    "/cover-letter-exports/:coverLetterExportId/download",
    authMiddleware,
    validate({ params: coverLetterExportIdParamSchema }),
    coverLettersController.getExportDownload
  );

  return router;
};
