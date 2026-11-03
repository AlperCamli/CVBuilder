import { Router, type RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AppConfig } from "../../shared/config/env";
import { sendError } from "../../shared/http/response";
import { validate } from "../../shared/validation/validate";
import type { PromotionsController } from "./promotions.controller";
import { promotionOfferQuerySchema } from "./promotions.schemas";

// Public: an offer page resolves its token a few times per visit, so this only stops token guessing and floods.
export const createPromotionOfferRateLimiter = (config: AppConfig): RequestHandler => {
  if (config.appEnv === "test") return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { forwardedHeader: process.env.VERCEL !== "1" },
    keyGenerator: (request): string => `promo-ip:${ipKeyGenerator(request.ip ?? "")}`,
    handler: (_request, response) => { sendError(response, { statusCode: 429, code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly." }); }
  });
};

export const createPromotionsRouter = (controller: PromotionsController, limiter: RequestHandler): Router => {
  const router = Router();
  router.get("/promotions/offer", limiter, validate({ query: promotionOfferQuerySchema }), controller.getOffer);
  return router;
};
