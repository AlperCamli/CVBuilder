import { ApiClientError } from "./api-error";

// Gated actions as reported by the backend in EntitlementExceededError.details.action.
export type EntitlementFeature =
  | "tailored_cv_generation"
  | "export_pdf"
  | "export_docx"
  | "ai_action";

export const isEntitlementExceeded = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError && error.code === "ENTITLEMENT_EXCEEDED";

export const resolveEntitlementFeature = (
  error: ApiClientError,
  fallback: EntitlementFeature
): EntitlementFeature => {
  const action = error.details?.action;
  if (
    action === "tailored_cv_generation" ||
    action === "export_pdf" ||
    action === "export_docx" ||
    action === "ai_action"
  ) {
    return action;
  }
  return fallback;
};
