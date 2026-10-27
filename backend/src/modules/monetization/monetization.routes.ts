import { Router } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import { sendSuccess } from "../../shared/http/response";
import { requireCronSecret } from "../../shared/middleware/cron-auth";
import type { MonetizationBackfillService } from "./monetization-backfill.service";
import type { MonetizationRefreshService } from "./monetization-refresh.service";

// Leaves headroom under the function's 300 s limit; a partial run resumes on the next call.
const BACKFILL_BUDGET_MS = 240_000;

export const createMonetizationRouter = (
  service: MonetizationRefreshService,
  backfill?: MonetizationBackfillService
): Router => {
  const router = Router();
  router.get(
    "/billing/analytics/refresh",
    requireCronSecret,
    asyncHandler(async (_req, res) => {
      sendSuccess(res, await service.refresh());
    })
  );
  if (backfill) {
    router.get(
      "/billing/analytics/backfill",
      requireCronSecret,
      asyncHandler(async (req, res) => {
        sendSuccess(res, await backfill.run({ dryRun: req.query.dry_run === "1", budgetMs: BACKFILL_BUDGET_MS }));
      })
    );
  }
  return router;
};
