import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import type { BillingController } from "./billing.controller";
import { billingCheckoutSchema, billingPortalSchema, billingCheckoutConfirmSchema } from "./billing.schemas";

export const createBillingRouter = (
  billingController: BillingController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/billing/prices", (req, res, next) => {
    if (req.header("authorization")) authMiddleware(req, res, next); else next();
  }, billingController.getPrices);
  router.get("/billing/plan", authMiddleware, billingController.getPlan);
  router.get("/billing/usage", authMiddleware, billingController.getUsage);
  router.get("/billing/entitlements", authMiddleware, billingController.getEntitlements);

  router.post(
    "/billing/checkout",
    authMiddleware,
    validate({ body: billingCheckoutSchema }),
    billingController.postCheckout
  );

  router.post("/billing/checkout/cancel", authMiddleware, billingController.postCancelCheckout);
  router.post("/billing/checkout/confirm", authMiddleware, validate({ body: billingCheckoutConfirmSchema }), billingController.postConfirmCheckout);

  router.post(
    "/billing/portal",
    authMiddleware,
    validate({ body: billingPortalSchema }),
    billingController.postPortal
  );

  router.post("/billing/webhooks", billingController.postWebhooks);

  return router;
};
