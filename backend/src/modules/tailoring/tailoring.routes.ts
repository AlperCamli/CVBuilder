import { Router } from "express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors/app-error";
import { validate } from "../../shared/validation/validate";
import type { TailoringController } from "./tailoring.controller";
import type { TailoringService } from "./tailoring.service";
import {
  activeTailoringSessionQuerySchema,
  adminSessionsQuerySchema,
  answerQuestionSchema,
  createTailoringSessionSchema,
  refineBlockSchema,
  requirementDecisionSchema,
  runTaskSchema,
  suggestionDecisionSchema,
  tailoringBlockParamsSchema,
  tailoringPreferencesSchema,
  tailoringQuestionParamsSchema,
  tailoringRequirementParamsSchema,
  tailoringSessionParamsSchema,
  tailoringSuggestionParamsSchema,
  tailoringTaskParamsSchema
} from "./tailoring.schemas";

// Session routes live under /ai so they inherit the subscription and AI-privacy guards
// applied to /ai in register-routes.
export const createTailoringRouter = (
  controller: TailoringController,
  service: TailoringService,
  authMiddleware: RequestHandler,
  tailoringRateLimiter: RequestHandler
): Router => {
  const router = Router();
  // Inference endpoints: a dedicated limiter sized for one session's parallel block runs.
  const inference: RequestHandler[] = [authMiddleware, tailoringRateLimiter];
  const requireAdmin = (request: Request, _response: Response, next: NextFunction) => {
    if (!request.auth) {
      next(new UnauthorizedError());
      return;
    }
    next(service.isAdmin(request.auth) ? undefined : new ForbiddenError("Admin access is required."));
  };

  router.post(
    "/ai/tailoring-sessions",
    authMiddleware,
    validate({ body: createTailoringSessionSchema }),
    controller.createSession
  );
  router.get(
    "/ai/tailoring-sessions/active",
    authMiddleware,
    validate({ query: activeTailoringSessionQuerySchema }),
    controller.getActiveSession
  );
  router.patch(
    "/ai/tailoring-preferences",
    authMiddleware,
    validate({ body: tailoringPreferencesSchema }),
    controller.updatePreferences
  );
  router.get(
    "/ai/tailoring-sessions/:sessionId",
    authMiddleware,
    validate({ params: tailoringSessionParamsSchema }),
    controller.getSession
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/analyze",
    ...inference,
    validate({ params: tailoringSessionParamsSchema }),
    controller.analyze
  );
  router.put(
    "/ai/tailoring-sessions/:sessionId/requirements/:requirementId",
    authMiddleware,
    validate({ params: tailoringRequirementParamsSchema, body: requirementDecisionSchema }),
    controller.setRequirementDecision
  );
  router.put(
    "/ai/tailoring-sessions/:sessionId/answers/:questionId",
    authMiddleware,
    validate({ params: tailoringQuestionParamsSchema, body: answerQuestionSchema }),
    controller.answerQuestion
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/questions/complete",
    authMiddleware,
    validate({ params: tailoringSessionParamsSchema }),
    controller.completeQuestions
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/tasks/:taskId/run",
    ...inference,
    validate({ params: tailoringTaskParamsSchema, body: runTaskSchema }),
    controller.runTask
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/blocks/:blockId/refine",
    ...inference,
    validate({ params: tailoringBlockParamsSchema, body: refineBlockSchema }),
    controller.refineBlock
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/suggestions/:suggestionId/decision",
    authMiddleware,
    validate({ params: tailoringSuggestionParamsSchema, body: suggestionDecisionSchema }),
    controller.decideSuggestion
  );
  router.post(
    "/ai/tailoring-sessions/:sessionId/finish",
    authMiddleware,
    validate({ params: tailoringSessionParamsSchema }),
    controller.finish
  );

  router.get(
    "/admin/tailoring-sessions",
    authMiddleware,
    requireAdmin,
    validate({ query: adminSessionsQuerySchema }),
    controller.listAdminSessions
  );
  router.get(
    "/admin/tailoring-sessions/:sessionId/cost",
    authMiddleware,
    requireAdmin,
    validate({ params: tailoringSessionParamsSchema }),
    controller.getAdminCostReport
  );

  return router;
};
