import { Router, type RequestHandler } from "express";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import { validate } from "../../shared/validation/validate";
import { unsubscribeSchema, type UnsubscribeInput } from "./marketing.contract";
import type { MarketingService } from "./marketing.service";

// Public: the unsubscribe link in a promotional email works without signing in. The answer is the same for
// known and unknown tokens, so the endpoint cannot be used to test which tokens are valid.
export function createMarketingRouter(service: MarketingService, limiter: RequestHandler): Router {
  const router = Router();
  router.post(
    "/marketing/unsubscribe",
    limiter,
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    validate({ body: unsubscribeSchema }),
    asyncHandler(async (req, res) => {
      await service.unsubscribe((req.body as UnsubscribeInput).token);
      sendSuccess(res, { ok: true });
    })
  );
  return router;
}
