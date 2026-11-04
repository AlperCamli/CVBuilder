import { z } from "zod";

export const billingCheckoutConfirmSchema = z.object({ session_id: z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(256) }).strict();

export const billingCheckoutSchema = z
  .object({
    pricing_quote: z.string().max(4096).optional(),
    plan_code: z.string().trim().min(1).max(64),
    success_url: z.string().trim().url().max(2000).optional(),
    cancel_url: z.string().trim().url().max(2000).optional(),
    with_trial: z.boolean().optional(),
    time_zone: z.string().trim().min(1).max(64).optional(),
    promotion_token: z.string().trim().min(1).max(256).optional()
  })
  .strict();

// The offer is resolved and priced on the server; the request only names where Stripe returns to.
export const billingCancelOfferCheckoutSchema = z
  .object({
    success_url: z.string().trim().url().max(2000).optional(),
    cancel_url: z.string().trim().url().max(2000).optional()
  })
  .strict()
  .default({});

export const billingPortalSchema = z
  .object({
    return_url: z.string().trim().url().max(2000).optional(),
    flow: z.enum(["cancel", "payment_method", "change_plan"]).optional(),
    plan_code: z.enum(["weekly", "monthly", "annual"]).optional()
  })
  .strict()
  .refine(body => (body.flow === "change_plan") === (body.plan_code !== undefined), "plan_code goes with flow change_plan")
  .default({});

// A paid plan's offer is resolved and applied on the server; nothing in the request selects it.
export const billingCancelOfferAcceptSchema = z.object({}).strict().default({});

// A downgrade, scheduled for the end of the paid period.
export const billingPlanChangeSchema = z.object({ plan_code: z.enum(["weekly", "monthly", "annual"]) }).strict();
