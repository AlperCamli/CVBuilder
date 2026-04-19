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
    super(options.message);
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
