import type { RequestHandler } from "express";
import { Router } from "express";
import type { DashboardController } from "./dashboard.controller";

export const createDashboardRouter = (
  dashboardController: DashboardController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/dashboard", authMiddleware, dashboardController.getDashboard);
  router.get("/dashboard/activity", authMiddleware, dashboardController.getActivity);

  return router;
};
