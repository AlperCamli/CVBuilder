import express, { Router, type RequestHandler } from "express";
import { asyncHandler } from "../../shared/utils/async-handler";
import { validate } from "../../shared/validation/validate";
import { funnelEventSchema, isBotUserAgent } from "./funnel-events.contract";
import type { FunnelEventsService } from "./funnel-events.service";

// Anonymous funnel counter: no authentication or consent (no identifiers are kept), and the IP and
// user agent are only used in memory for the rate limit and the bot check, never stored or logged.
export function createFunnelEventsRouter(service: FunnelEventsService, limiter: RequestHandler): Router {
  const router = Router();
  router.post(
    "/funnel-events",
    limiter,
    // sendBeacon sends an application/json Blob (parsed by the app-wide JSON parser); accept text/plain too.
    express.json({ type: "text/plain", limit: "2kb" }),
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (isBotUserAgent(req.get("user-agent"))) {
        res.status(204).end();
        return;
      }
      next();
    },
    validate({ body: funnelEventSchema }),
    asyncHandler(async (req, res) => {
      await service.record(req.body);
      res.status(204).end();
    })
  );
  return router;
}
