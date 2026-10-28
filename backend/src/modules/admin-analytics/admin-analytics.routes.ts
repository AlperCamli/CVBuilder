import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import type { AdminAnalyticsController } from "./admin-analytics.controller";

export const createAdminAnalyticsRouter = (
  controller: AdminAnalyticsController,
  adminAuth: RequestHandler,
  requireAdmin: RequestHandler,
  ipRateLimiter: RequestHandler,
  adminRateLimiter: RequestHandler
): Router => {
  const router = Router();
  const admin: RequestHandler[] = [adminAuth, requireAdmin, adminRateLimiter];

  // Admin data must never be cached, including error responses.
  router.use("/admin", (_request: Request, response: Response, next: NextFunction) => {
    response.set("Cache-Control", "no-store");
    next();
  }, ipRateLimiter);

  router.get("/admin/me", adminAuth, controller.getMe);
  router.get("/admin/catalog", ...admin, controller.getCatalog);
  router.get("/admin/metrics/:name", ...admin, controller.getMetric);

  return router;
};
