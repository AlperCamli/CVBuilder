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

const onboardingStepIdSchema = z.enum([
  "create_cv",
  "customize",
  "job_details",
  "template",
  "layout",
  "export"
]);

const onboardingStateSchema = z
  .object({
    steps: z.record(onboardingStepIdSchema, z.string().datetime({ offset: true })).optional(),
    skipped_at: z.string().datetime({ offset: true }).optional(),
    completed_at: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    locale: z.enum(["en", "tr"]).optional(),
    default_cv_language: z.string().trim().min(2).max(16).optional(),
    onboarding_completed: z.boolean().optional(),
    onboarding_state: onboardingStateSchema.optional()
  })
  .strict()
  .refine(
    (input) =>
      input.locale !== undefined ||
      input.default_cv_language !== undefined ||
      input.onboarding_completed !== undefined ||
      input.onboarding_state !== undefined,
    {
      message: "At least one field must be provided"
    }
  );
