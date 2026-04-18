import type { RequestHandler } from "express";
import { ERROR_CODES } from "../errors/error-codes";
import { sendError } from "../http/response";

export const notFoundMiddleware: RequestHandler = (_request, response) => {
  sendError(response, {
    statusCode: 404,
    code: ERROR_CODES.ROUTE_NOT_FOUND,
    message: "Route not found"
  });
};
