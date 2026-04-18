import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { UsersService } from "./users.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  getMe = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.usersService.getMe(requireSession(request));
    sendSuccess(response, data);
  });

  patchMe = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.usersService.updateMe(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  getSettings = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.usersService.getSettings(requireSession(request));
    sendSuccess(response, data);
  });

  patchSettings = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.usersService.updateSettings(requireSession(request), request.body);
    sendSuccess(response, data);
  });

  getUsage = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.usersService.getUsage(requireSession(request));
    sendSuccess(response, data);
  });
}
