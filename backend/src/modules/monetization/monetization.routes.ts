import { Router } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import { sendSuccess } from "../../shared/http/response";
import { requireCronSecret } from "../../shared/middleware/cron-auth";
import type { MonetizationRefreshService } from "./monetization-refresh.service";

export const createMonetizationRouter = (service: MonetizationRefreshService): Router => {
  const router = Router();
  router.get(
    "/billing/analytics/refresh",
    requireCronSecret,
    asyncHandler(async (_req, res) => {
      sendSuccess(res, await service.refresh());
    })
  );
  return router;
};
