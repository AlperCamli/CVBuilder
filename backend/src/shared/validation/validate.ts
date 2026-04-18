import type { NextFunction, Request, Response, RequestHandler } from "express";
import { type AnyZodObject, type ZodTypeAny, ZodError } from "zod";
import { ValidationError } from "../errors/app-error";
import { formatZodError } from "./format-zod-error";

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (request: Request, _response: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }

      if (schemas.query) {
        request.query = schemas.query.parse(request.query);
      }

      if (schemas.params) {
        request.params = schemas.params.parse(request.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError("Validation failed", formatZodError(error)));
        return;
      }

      next(error);
    }
  };
};
