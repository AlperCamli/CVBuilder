import type { NextFunction, Request, Response, RequestHandler } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import type { AuthService } from "./auth.service";

const getBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

export const createAuthMiddleware = (authService: AuthService): RequestHandler => {
  return async (request: Request, _response: Response, next: NextFunction): Promise<void> => {
    try {
      const token = getBearerToken(request.header("authorization"));

      if (!token) {
        throw new UnauthorizedError("Missing or malformed bearer token");
      }

      // Processing guards and route handlers share this authenticated request.
      // Database/privacy guards still check current state before sensitive work.
      if (request.auth) { next(); return; }

      request.auth = await authService.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  };
};
