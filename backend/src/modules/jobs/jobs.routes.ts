import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { JobsController } from "./jobs.controller";
import { jobIdParamSchema, updateJobSchema } from "./jobs.schemas";

export const createJobsRouter = (
  jobsController: JobsController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get(
    "/jobs/:jobId",
    authMiddleware,
    validate({ params: jobIdParamSchema }),
    jobsController.getJob
  );

  router.patch(
    "/jobs/:jobId",
    authMiddleware,
    validate({ params: jobIdParamSchema, body: updateJobSchema }),
    jobsController.patchJob
  );

  return router;
};
