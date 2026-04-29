import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { AiController } from "./ai.controller";
import {
  aiRunIdParamsSchema,
  aiBlockCompareSchema,
  aiImportImproveSchema,
  aiBlockOptionsSchema,
  aiBlockSuggestSchema,
  aiFollowUpQuestionsSchema,
  aiJobAnalysisSchema,
  aiTailoringRunStartSchema,
  aiTailoredDraftSchema,
  masterCvAiHistoryParamsSchema,
  suggestionIdParamsSchema,
  tailoredCvAiHistoryParamsSchema,
  aiCoverLetterGenerationSchema
} from "./ai.schemas";

export const createAiRouter = (
  aiController: AiController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.post(
    "/ai/tailoring-runs/start",
    authMiddleware,
    validate({ body: aiTailoringRunStartSchema }),
    aiController.postTailoringRunStart
  );

  router.post(
    "/ai/tailoring-runs/:aiRunId/execute",
    authMiddleware,
    validate({ params: aiRunIdParamsSchema }),
    aiController.postTailoringRunExecute
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/status",
    authMiddleware,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunStatus
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/result",
    authMiddleware,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunResult
  );

  router.post(
    "/ai/job-analysis",
    authMiddleware,
    validate({ body: aiJobAnalysisSchema }),
    aiController.postJobAnalysis
  );

  router.post(
    "/ai/follow-up-questions",
    authMiddleware,
    validate({ body: aiFollowUpQuestionsSchema }),
    aiController.postFollowUpQuestions
  );

  router.post(
    "/ai/tailored-cv-draft",
    authMiddleware,
    validate({ body: aiTailoredDraftSchema }),
    aiController.postTailoredCvDraft
  );

  router.post(
    "/ai/import-improve",
    authMiddleware,
    validate({ body: aiImportImproveSchema }),
    aiController.postImportImprove
  );

  router.post(
    "/ai/cover-letters/generate",
    authMiddleware,
    validate({ body: aiCoverLetterGenerationSchema }),
    aiController.postGenerateCoverLetter
  );

  router.post(
    "/ai/blocks/suggest",
    authMiddleware,
    validate({ body: aiBlockSuggestSchema }),
    aiController.postBlockSuggest
  );

  router.post(
    "/ai/blocks/compare",
    authMiddleware,
    validate({ body: aiBlockCompareSchema }),
    aiController.postBlockCompare
  );

  router.post(
    "/ai/blocks/options",
    authMiddleware,
    validate({ body: aiBlockOptionsSchema }),
    aiController.postBlockOptions
  );

  router.get(
    "/ai/suggestions/:suggestionId",
    authMiddleware,
    validate({ params: suggestionIdParamsSchema }),
    aiController.getSuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/apply",
    authMiddleware,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postApplySuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/reject",
    authMiddleware,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postRejectSuggestion
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-history",
    authMiddleware,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiHistory
  );

  router.get(
    "/master-cvs/:masterCvId/ai-history",
    authMiddleware,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiHistory
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-block-versions",
    authMiddleware,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiBlockVersions
  );

  router.get(
    "/master-cvs/:masterCvId/ai-block-versions",
    authMiddleware,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiBlockVersions
  );

  return router;
};
