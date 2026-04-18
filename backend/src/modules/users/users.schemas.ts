import { z } from "zod";

export const updateMeSchema = z
  .object({
    full_name: z.string().trim().min(1).max(120).optional(),
    default_cv_language: z.string().trim().min(2).max(16).optional()
  })
  .strict()
  .refine((input) => input.full_name !== undefined || input.default_cv_language !== undefined, {
    message: "At least one field must be provided"
  });

export const updateSettingsSchema = z
  .object({
    locale: z.enum(["en", "tr"]).optional(),
    default_cv_language: z.string().trim().min(2).max(16).optional(),
    onboarding_completed: z.boolean().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.locale !== undefined ||
      input.default_cv_language !== undefined ||
      input.onboarding_completed !== undefined,
    {
      message: "At least one field must be provided"
    }
  );
