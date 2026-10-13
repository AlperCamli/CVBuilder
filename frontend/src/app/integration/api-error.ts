import { i18n, translate } from "../localization/i18n";
export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  isUnauthorized: boolean;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    const localized = translate(options.message);
    const generic: Record<string, string> = { AUTH_REQUIRED: "Please sign in to continue.", AUTH_INVALID_TOKEN: "Your session expired. Please sign in again.", VALIDATION_ERROR: "Check the information you entered and try again.", ENTITLEMENT_EXCEEDED: "Your plan limit has been reached.", FORBIDDEN: "This action is unavailable for your account.", NOT_FOUND: "The requested item was not found.", BILLING_CONFIG_INVALID: "Pricing is temporarily unavailable" };
    super(i18n.language === "tr" && localized === options.message ? translate(generic[options.code] ?? "We couldn't complete this action. Please retry.") : localized);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.isUnauthorized =
      this.status === 401 || this.code === "AUTH_REQUIRED" || this.code === "AUTH_INVALID_TOKEN";
  }
}

export const isApiClientError = (value: unknown): value is ApiClientError =>
  value instanceof ApiClientError;
