import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { TemplatesController } from "./templates.controller";
import { templateIdParamSchema } from "./templates.schemas";

export const createTemplatesRouter = (
  templatesController: TemplatesController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/templates", authMiddleware, templatesController.listTemplates);
  router.get(
    "/templates/:templateId",
    authMiddleware,
    validate({ params: templateIdParamSchema }),
    templatesController.getTemplate
  );

  return router;
};
