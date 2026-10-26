import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AppConfig } from "../config/env";
import { sendError } from "../http/response";

const ONE_MINUTE_MS = 60_000;

const handleRateLimited = (_request: Request, response: Response): void => {
  sendError(response, {
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Too many requests. Please slow down and try again shortly."
  });
};

const passThrough: RequestHandler = (
  _request: Request,
  _response: Response,
  next: NextFunction
): void => {
  next();
};

export const createGlobalRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") {
    return passThrough;
  }

  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    // Vercel supplies the trusted X-Forwarded-For header. The alternative
    // Forwarded header is deliberately ignored, including client forgeries.
    validate: { forwardedHeader: process.env.VERCEL !== "1" },
    handler: handleRateLimited
  });
};

// One tailoring session runs its block suggestions in parallel (and users tailor many
// applications a day), so it gets its own per-user budget instead of the 10/min AI limit.
export const createTailoringRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") {
    return passThrough;
  }

  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request: Request): string => {
      const userId = request.auth?.appUser.id;
      return userId ? `tailoring:${userId}` : `tailoring-ip:${ipKeyGenerator(request.ip ?? "")}`;
    },
    handler: handleRateLimited
  });
};

export const createAiRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") {
    return passThrough;
  }

  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request: Request): string => {
      const userId = request.auth?.appUser.id;
      if (userId) {
        return `user:${userId}`;
      }
      return `ip:${ipKeyGenerator(request.ip ?? "")}`;
    },
    handler: handleRateLimited
  });
};
