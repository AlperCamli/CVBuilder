import type { Request, Response } from "express";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { SystemService } from "./system.service";

export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  getHealth = asyncHandler(async (_request: Request, response: Response) => {
    const data = this.systemService.getHealth();
    sendSuccess(response, data);
  });

  getReadiness = asyncHandler(async (_request: Request, response: Response) => {
    const data = await this.systemService.getReadiness();
    sendSuccess(response, data);
  });

  getVersion = asyncHandler(async (_request: Request, response: Response) => {
    const data = this.systemService.getVersion();
    sendSuccess(response, data);
  });
}
