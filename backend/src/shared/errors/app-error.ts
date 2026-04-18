import { ERROR_CODES, type ErrorCode } from "./error-codes";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(options: {
    statusCode: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", details?: Record<string, unknown>) {
    super({
      statusCode: 401,
      code: ERROR_CODES.AUTH_REQUIRED,
      message,
      details
    });
  }
}

export class InvalidTokenError extends AppError {
  constructor(message = "Invalid or expired token", details?: Record<string, unknown>) {
    super({
      statusCode: 401,
      code: ERROR_CODES.AUTH_INVALID_TOKEN,
      message,
      details
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", details?: Record<string, unknown>) {
    super({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
      message,
      details
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: Record<string, unknown>) {
    super({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
      message,
      details
    });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ERROR_CODES.CONFLICT,
      message,
      details
    });
  }
}

export class BillingPlanValidationError extends AppError {
  constructor(message = "Invalid billing plan", details?: Record<string, unknown>) {
    super({
      statusCode: 400,
      code: ERROR_CODES.BILLING_PLAN_INVALID,
      message,
      details
    });
  }
}

export class BillingConfigurationError extends AppError {
  constructor(message = "Billing is not configured", details?: Record<string, unknown>) {
    super({
      statusCode: 503,
      code: ERROR_CODES.BILLING_NOT_CONFIGURED,
      message,
      details
    });
  }
}

export class BillingProviderError extends AppError {
  constructor(message = "Billing provider request failed", details?: Record<string, unknown>) {
    super({
      statusCode: 502,
      code: ERROR_CODES.BILLING_PROVIDER_ERROR,
      message,
      details
    });
  }
}

export class BillingWebhookSignatureError extends AppError {
  constructor(message = "Invalid billing webhook signature", details?: Record<string, unknown>) {
    super({
      statusCode: 400,
      code: ERROR_CODES.BILLING_WEBHOOK_SIGNATURE_INVALID,
      message,
      details
    });
  }
}

export class EntitlementExceededError extends AppError {
  constructor(message = "Usage limit exceeded", details?: Record<string, unknown>) {
    super({
      statusCode: 403,
      code: ERROR_CODES.ENTITLEMENT_EXCEEDED,
      message,
      details
    });
  }
}

export class AiProviderError extends AppError {
  constructor(message = "AI provider failed", details?: Record<string, unknown>) {
    super({
      statusCode: 502,
      code: ERROR_CODES.AI_PROVIDER_ERROR,
      message,
      details
    });
  }
}

export class AiFlowFailedError extends AppError {
  constructor(message = "AI flow failed", details?: Record<string, unknown>) {
    super({
      statusCode: 502,
      code: ERROR_CODES.AI_FLOW_FAILED,
      message,
      details
    });
  }
}

export class RevisionNotApplicableError extends AppError {
  constructor(message = "Revision is not applicable", details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ERROR_CODES.REVISION_NOT_APPLICABLE,
      message,
      details
    });
  }
}

export class SuggestionNotApplicableError extends AppError {
  constructor(message = "Suggestion is not applicable", details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ERROR_CODES.SUGGESTION_NOT_APPLICABLE,
      message,
      details
    });
  }
}

export class ExportGenerationFailedError extends AppError {
  constructor(message = "Failed to generate export", details?: Record<string, unknown>) {
    super({
      statusCode: 500,
      code: ERROR_CODES.EXPORT_GENERATION_FAILED,
      message,
      details
    });
  }
}

export class ExportStorageFailedError extends AppError {
  constructor(message = "Failed to store export", details?: Record<string, unknown>) {
    super({
      statusCode: 500,
      code: ERROR_CODES.EXPORT_STORAGE_FAILED,
      message,
      details
    });
  }
}

export class ExportNotReadyError extends AppError {
  constructor(message = "Export is not ready", details?: Record<string, unknown>) {
    super({
      statusCode: 409,
      code: ERROR_CODES.EXPORT_NOT_READY,
      message,
      details
    });
  }
}

export class InternalServerError extends AppError {
  constructor(message = "Internal server error", details?: Record<string, unknown>) {
    super({
      statusCode: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      message,
      details
    });
  }
}

export const normalizeUnknownError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalServerError("Internal server error", {
      reason: error.message
    });
  }

  return new InternalServerError();
};
