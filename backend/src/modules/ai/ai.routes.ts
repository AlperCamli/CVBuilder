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
  // Apply the AI rate limiter only to endpoints that actually invoke model
  // inference. Read-only status/result/history endpoints are cheap DB reads
  // and are polled aggressively by the tailoring UI; the global limiter
  // already protects them. Keeping them under the AI limiter caused the
  // multi-stage "Tailor for a Job" flow to exhaust the per-user AI budget
  // via UX polling, even when the underlying AI runs succeeded.
  const inferenceGuard: RequestHandler[] = [authMiddleware, aiRateLimiter];
  const readGuard: RequestHandler[] = [authMiddleware];

  router.post(
    "/ai/tailoring-runs/start",
    ...inferenceGuard,
    validate({ body: aiTailoringRunStartSchema }),
    aiController.postTailoringRunStart
  );

  router.post(
    "/ai/tailoring-runs/:aiRunId/execute",
    ...inferenceGuard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.postTailoringRunExecute
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/status",
    ...readGuard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunStatus
  );

  router.get(
    "/ai/tailoring-runs/:aiRunId/result",
    ...readGuard,
    validate({ params: aiRunIdParamsSchema }),
    aiController.getTailoringRunResult
  );

  router.post(
    "/ai/job-analysis",
    ...inferenceGuard,
    validate({ body: aiJobAnalysisSchema }),
    aiController.postJobAnalysis
  );

  router.post(
    "/ai/follow-up-questions",
    ...inferenceGuard,
    validate({ body: aiFollowUpQuestionsSchema }),
    aiController.postFollowUpQuestions
  );

  router.post(
    "/ai/tailored-cv-draft",
    ...inferenceGuard,
    validate({ body: aiTailoredDraftSchema }),
    aiController.postTailoredCvDraft
  );

  router.post(
    "/ai/import-improve",
    ...inferenceGuard,
    validate({ body: aiImportImproveSchema }),
    aiController.postImportImprove
  );

  router.post(
    "/ai/cover-letters/generate",
    ...inferenceGuard,
    validate({ body: aiCoverLetterGenerationSchema }),
    aiController.postGenerateCoverLetter
  );

  router.post(
    "/ai/blocks/suggest",
    ...inferenceGuard,
    validate({ body: aiBlockSuggestSchema }),
    aiController.postBlockSuggest
  );

  router.post(
    "/ai/blocks/compare",
    ...inferenceGuard,
    validate({ body: aiBlockCompareSchema }),
    aiController.postBlockCompare
  );

  router.post(
    "/ai/blocks/options",
    ...inferenceGuard,
    validate({ body: aiBlockOptionsSchema }),
    aiController.postBlockOptions
  );

  router.get(
    "/ai/suggestions/:suggestionId",
    ...readGuard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.getSuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/apply",
    ...readGuard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postApplySuggestion
  );

  router.post(
    "/ai/suggestions/:suggestionId/reject",
    ...readGuard,
    validate({ params: suggestionIdParamsSchema }),
    aiController.postRejectSuggestion
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-history",
    ...readGuard,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiHistory
  );

  router.get(
    "/master-cvs/:masterCvId/ai-history",
    ...readGuard,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiHistory
  );

  router.get(
    "/tailored-cvs/:tailoredCvId/ai-block-versions",
    ...readGuard,
    validate({ params: tailoredCvAiHistoryParamsSchema }),
    aiController.getTailoredCvAiBlockVersions
  );

  router.get(
    "/master-cvs/:masterCvId/ai-block-versions",
    ...readGuard,
    validate({ params: masterCvAiHistoryParamsSchema }),
    aiController.getMasterCvAiBlockVersions
  );

  return router;
};
