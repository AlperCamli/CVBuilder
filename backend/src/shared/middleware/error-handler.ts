import type { ErrorRequestHandler, Request, Response } from "express";
import type { AppConfig } from "../config/env";
import { normalizeUnknownError, type AppError } from "../errors/app-error";
import { sendError } from "../http/response";

/**
 * Opts a request into detailed failure logs: the "Request failed" line then also carries the failure's message and
 * these fields (e.g. the admin area and the people function or metric name). Only for routes whose error messages
 * carry no personal data; the fields must never hold the request body, search text, tokens or other secrets.
 */
export const setErrorLogContext = (response: Response, context: Record<string, string | number | boolean | null>): void => {
  response.locals.errorLogContext = { ...(response.locals.errorLogContext as object | undefined), ...context };
};

interface ErrorSummary {
  name: string;
  code?: string;
  message?: string;
}

// Name, code (SQLSTATE, Node / driver code) and, when the route opted in, message of the failure behind a response.
const summarize = (error: unknown, withMessage: boolean): ErrorSummary => {
  if (!(error instanceof Error)) {
    return { name: typeof error };
  }
  const code = (error as { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === "string" || typeof code === "number" ? { code: String(code) } : {}),
    ...(withMessage ? { message: error.message } : {})
  };
};

// The matched route pattern ("/admin/people/:name"), never the URL with its parameters or query string.
const routeOf = (request: Request): string | null => {
  const path = (request.route as { path?: unknown } | undefined)?.path;
  return typeof path === "string" ? `${request.baseUrl}${path}` : null;
};

// One line per failed request. Server errors (and client errors mapped from a server-side failure, which carry it as
// `cause`) add what is needed to diagnose them; plain client errors stay at code and status.
const logFields = (error: unknown, normalized: AppError, request: Request, response: Response): Record<string, unknown> => {
  const base = { code: normalized.code, statusCode: normalized.statusCode };
  const cause = normalized.cause;
  if (normalized.statusCode < 500 && cause === undefined) {
    return base;
  }
  const context = response.locals.errorLogContext as Record<string, unknown> | undefined;
  return {
    ...base,
    method: request.method,
    route: routeOf(request),
    error: summarize(cause ?? error, context !== undefined),
    ...(context ?? {})
  };
};

export const createErrorHandler = (config: AppConfig): ErrorRequestHandler => {
  return (error, request, response, _next) => {
    const normalizedError = normalizeUnknownError(error);

    if (request.log) {
      request.log.error(logFields(error, normalizedError, request, response), "Request failed");
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
