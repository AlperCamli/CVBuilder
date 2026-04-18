import type { ErrorRequestHandler } from "express";
import { AppError, normalizeUnknownError } from "../errors/app-error";
import { sendError } from "../http/response";

export const createErrorHandler = (isProduction: boolean): ErrorRequestHandler => {
  return (error, request, response, _next) => {
    const normalizedError = normalizeUnknownError(error);

    const shouldHideInternalDetails = isProduction && normalizedError.statusCode >= 500;
    const safeError: AppError = shouldHideInternalDetails
      ? new AppError({
          statusCode: 500,
          code: normalizedError.code,
          message: "Internal server error"
        })
      : normalizedError;

    if (request.log) {
      request.log.error(
        {
          err: error,
          code: safeError.code,
          statusCode: safeError.statusCode,
          details: safeError.details
        },
        safeError.message
      );
    }

    sendError(response, {
      statusCode: safeError.statusCode,
      code: safeError.code,
      message: safeError.message,
      details: safeError.details
    });
  };
};
