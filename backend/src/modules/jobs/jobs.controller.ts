import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { JobsService } from "./jobs.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  listJobs = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.listJobs(requireSession(request), request.query);
    sendSuccess(response, data);
  });

  getJobsBoard = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.getJobsBoard(requireSession(request), request.query);
    sendSuccess(response, data);
  });

  getJob = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.getJob(requireSession(request), request.params.jobId);
    sendSuccess(response, data);
  });

  patchJob = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.updateJob(
      requireSession(request),
      request.params.jobId,
      request.body
    );
    sendSuccess(response, data);
  });

  patchJobStatus = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.updateJobStatus(
      requireSession(request),
      request.params.jobId,
      request.body
    );
    sendSuccess(response, data);
  });

  getJobHistory = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.jobsService.getJobHistory(requireSession(request), request.params.jobId);
    sendSuccess(response, data);
  });
}
