import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import type { AdminAnalyticsController } from "./admin-analytics.controller";

export const createAdminAnalyticsRouter = (
  controller: AdminAnalyticsController,
  adminAuth: RequestHandler,
  requireAdmin: RequestHandler,
  ipRateLimiter: RequestHandler,
  adminRateLimiter: RequestHandler,
  // Applies to people CSV exports only (body.format = "csv").
  exportRateLimiter: RequestHandler = (_request, _response, next) => next(),
  // POST /admin/recompute only, on top of the admin limiter (the database throttles runs to one per 5 minutes).
  recomputeRateLimiter: RequestHandler = (_request, _response, next) => next()
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
  // POST so the search text and filters travel in the body, never in URLs or access logs.
  router.post("/admin/people/:name", ...admin, exportRateLimiter, controller.getPeople);

  // Phase 5. Writes are audited by the database in the same transaction.
  router.get("/admin/alerts/rules", ...admin, controller.listAlertRules);
  router.post("/admin/alerts/rules", ...admin, controller.createAlertRule);
  router.patch("/admin/alerts/rules/:id", ...admin, controller.updateAlertRule);
  router.delete("/admin/alerts/rules/:id", ...admin, controller.deleteAlertRule);
  router.get("/admin/alerts/events", ...admin, controller.listAlertEvents);
  router.post("/admin/alerts/events/:id/ack", ...admin, controller.ackAlertEvent);
  router.get("/admin/alerts/summary", ...admin, controller.getAlertSummary);
  router.post("/admin/recompute", ...admin, recomputeRateLimiter, controller.requestRecompute);
  router.get("/admin/recompute/status", ...admin, controller.getRecomputeStatus);
  router.get("/admin/audit/recent", ...admin, controller.getAuditRecent);

  return router;
};
