import type { ErrorRequestHandler } from "express";
import { normalizeUnknownError } from "../errors/app-error";
import { sendError } from "../http/response";

export const createErrorHandler = (): ErrorRequestHandler => {
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

    sendError(response, {
      statusCode: normalizedError.statusCode,
      code: normalizedError.code,
      message: normalizedError.message,
      details: normalizedError.details
    });
  };
};
