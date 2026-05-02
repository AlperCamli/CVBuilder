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
  authMiddleware: RequestHandler,
  aiRateLimiter: RequestHandler
): Router => {
  const router = Router();
  const guard: RequestHandler[] = [authMiddleware, aiRateLimiter];

  router.post(
    "/ai/tailoring-runs/start",
    ...guard,
    validate({ body: aiTailoringRunStartSchema }),
    aiController.postTailoringRunStart
  );

  router.post(
    "/ai/tailoring-runs/:aiRunId/execute",
    ...guard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.postTailoringRunExecute
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/status",
    ...guard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunStatus
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/result",
    ...guard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunResult
  );

  router.post(
    "/ai/job-analysis",
    ...guard,
    validate({ body: aiJobAnalysisSchema }),
    aiController.postJobAnalysis
  );

  router.post(
    "/ai/follow-up-questions",
    ...guard,
    validate({ body: aiFollowUpQuestionsSchema }),
    aiController.postFollowUpQuestions
  );

  router.post(
    "/ai/tailored-cv-draft",
    ...guard,
    validate({ body: aiTailoredDraftSchema }),
    aiController.postTailoredCvDraft
  );

  router.post(
    "/ai/import-improve",
    ...guard,
    validate({ body: aiImportImproveSchema }),
    aiController.postImportImprove
  );

  router.post(
    "/ai/cover-letters/generate",
    ...guard,
    validate({ body: aiCoverLetterGenerationSchema }),
    aiController.postGenerateCoverLetter
  );

  router.post(
    "/ai/blocks/suggest",
    ...guard,
    validate({ body: aiBlockSuggestSchema }),
    aiController.postBlockSuggest
  );

  router.post(
    "/ai/blocks/compare",
    ...guard,
    validate({ body: aiBlockCompareSchema }),
    aiController.postBlockCompare
  );

  router.post(
    "/ai/blocks/options",
    ...guard,
    validate({ body: aiBlockOptionsSchema }),
    aiController.postBlockOptions
  );

  router.get(
    "/ai/suggestions/:suggestionId",
    ...guard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.getSuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/apply",
    ...guard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postApplySuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/reject",
    ...guard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postRejectSuggestion
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-history",
    ...guard,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiHistory
  );

  router.get(
    "/master-cvs/:masterCvId/ai-history",
    ...guard,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiHistory
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-block-versions",
    ...guard,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiBlockVersions
  );

  router.get(
    "/master-cvs/:masterCvId/ai-block-versions",
    ...guard,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiBlockVersions
  );

  return router;
};
