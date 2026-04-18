import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { JobsController } from "./jobs.controller";
import {
  jobIdParamSchema,
  jobsBoardQuerySchema,
  listJobsQuerySchema,
  updateJobSchema,
  updateJobStatusSchema
} from "./jobs.schemas";

export const createJobsRouter = (
  jobsController: JobsController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/jobs", authMiddleware, validate({ query: listJobsQuerySchema }), jobsController.listJobs);

  router.get(
    "/jobs/board",
    authMiddleware,
    validate({ query: jobsBoardQuerySchema }),
    jobsController.getJobsBoard
  );

  router.get(
    "/jobs/:jobId/history",
    authMiddleware,
    validate({ params: jobIdParamSchema }),
    jobsController.getJobHistory
  );

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

  router.patch(
    "/jobs/:jobId/status",
    authMiddleware,
    validate({ params: jobIdParamSchema, body: updateJobStatusSchema }),
    jobsController.patchJobStatus
  );

  return router;
};
