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
    // Admin routes have their own per-IP and per-admin limiters; a dashboard page loads many metrics at once.
    skip: (request: Request): boolean => request.path.startsWith("/admin/"),
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

// Guards against runaway dashboard clients only; a page loads many metrics at once.
export const createAdminRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") {
    return passThrough;
  }

  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request: Request): string => {
      const authUserId = request.adminIdentity?.authUserId;
      return authUserId ? `admin:${authUserId}` : `admin-user-ip:${ipKeyGenerator(request.ip ?? "")}`;
    },
    handler: handleRateLimited
  });
};

// Runs before the admin token check, so unauthenticated probing is capped too.
export const createAdminIpRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") {
    return passThrough;
  }

  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { forwardedHeader: process.env.VERCEL !== "1" },
    keyGenerator: (request: Request): string => `admin-ip:${ipKeyGenerator(request.ip ?? "")}`,
    handler: handleRateLimited
  });
};
