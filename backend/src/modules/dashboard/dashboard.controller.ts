import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { DashboardService } from "./dashboard.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  getDashboard = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.dashboardService.getDashboard(requireSession(request));
    sendSuccess(response, data);
  });

  getActivity = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.dashboardService.getActivity(requireSession(request));
    sendSuccess(response, data);
  });
}
