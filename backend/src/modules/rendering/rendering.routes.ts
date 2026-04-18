import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { RenderingController } from "./rendering.controller";
import { renderingPreviewSchema } from "./rendering.schemas";

export const createRenderingRouter = (
  renderingController: RenderingController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.post(
    "/rendering/preview",
    authMiddleware,
    validate({ body: renderingPreviewSchema }),
    renderingController.buildPreview
  );

  return router;
};
