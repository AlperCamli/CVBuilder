import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { BillingController } from "./billing.controller";
import { billingCheckoutSchema, billingPortalSchema } from "./billing.schemas";

export const createBillingRouter = (
  billingController: BillingController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/billing/plan", authMiddleware, billingController.getPlan);
  router.get("/billing/usage", authMiddleware, billingController.getUsage);
  router.get("/billing/entitlements", authMiddleware, billingController.getEntitlements);

  router.post(
    "/billing/checkout",
    authMiddleware,
    validate({ body: billingCheckoutSchema }),
    billingController.postCheckout
  );

  router.post(
    "/billing/portal",
    authMiddleware,
    validate({ body: billingPortalSchema }),
    billingController.postPortal
  );

  router.post("/billing/webhooks", billingController.postWebhooks);

  return router;
};
