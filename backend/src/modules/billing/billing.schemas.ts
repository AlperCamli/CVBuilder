import { z } from "zod";

export const billingCheckoutSchema = z
  .object({
    plan_code: z.string().trim().min(1).max(64),
    success_url: z.string().trim().url().max(2000).optional(),
    cancel_url: z.string().trim().url().max(2000).optional()
  })
  .strict();

export const billingPortalSchema = z
  .object({
    return_url: z.string().trim().url().max(2000).optional()
  })
  .strict()
  .default({});
