import type { ErrorRequestHandler } from "express";
import type { AppConfig } from "../config/env";
import { normalizeUnknownError } from "../errors/app-error";
import { sendError } from "../http/response";

export const createErrorHandler = (config: AppConfig): ErrorRequestHandler => {
  return (error, request, response, _next) => {
    const normalizedError = normalizeUnknownError(error);

    if (request.log) {
      request.log.error(
        {
          err: error,
          code: normalizedError.code,
          statusCode: normalizedError.statusCode,
          details: normalizedError.details
        },
        normalizedError.message
      );
    }

    const exposeDetails =
      config.appEnv !== "production" || normalizedError.statusCode < 500;

    sendError(response, {
      statusCode: normalizedError.statusCode,
      code: normalizedError.code,
      message: normalizedError.message,
      details: exposeDetails ? normalizedError.details : undefined
    });
  };
};
