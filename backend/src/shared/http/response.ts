import type { Response } from "express";
import type { ApiErrorResponse, ApiSuccessResponse } from "../types/api";

export const sendSuccess = <TData>(
  response: Response,
  data: TData,
  options?: {
    statusCode?: number;
    meta?: Record<string, unknown>;
  }
): Response<ApiSuccessResponse<TData>> => {
  const payload: ApiSuccessResponse<TData> = {
    success: true,
    data,
    ...(options?.meta ? { meta: options.meta } : {})
  };

  return response.status(options?.statusCode ?? 200).json(payload);
};

export const sendError = (
  response: Response,
  options: {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }
): Response<ApiErrorResponse> => {
  const payload: ApiErrorResponse = {
    success: false,
    error: {
      code: options.code,
      message: options.message,
      ...(options.details ? { details: options.details } : {})
    }
  };

  return response.status(options.statusCode).json(payload);
};
