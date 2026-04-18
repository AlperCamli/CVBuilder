import type { ZodError } from "zod";

export const formatZodError = (error: ZodError): Record<string, unknown> => {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code
    }))
  };
};
