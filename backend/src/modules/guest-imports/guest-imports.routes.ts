import { privacyChoicesSchema } from "../privacy/privacy.routes";
import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { validate } from "../../shared/validation/validate";
import { asyncHandler } from "../../shared/utils/async-handler";
import { sendSuccess } from "../../shared/http/response";
import { UnauthorizedError } from "../../shared/errors/app-error";
import type { GuestImportsService } from "./guest-imports.service";
import {
  guestAnswersSchema,
  guestCreateSchema,
  guestIdSchema,
} from "./guest-imports.schemas";

export function createGuestImportsRouter(
  service: GuestImportsService,
  auth: RequestHandler,
) {
  const router = Router();
  router.use((_, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const uploadLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { forwardedHeader: process.env.VERCEL !== "1" },
  });
  const processLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { forwardedHeader: process.env.VERCEL !== "1" },
  });
  const token = (req: Parameters<RequestHandler>[0]) =>
    req.get("X-Guest-Token") ?? "";
  router.get(
    "/guest-imports/cleanup",
    asyncHandler(async (req, res) => {
      const expected = process.env.CRON_SECRET;
      const supplied = req.get("Authorization") ?? "";
      const bearer = expected ? `Bearer ${expected}` : "";
      if (
        !bearer ||
        supplied.length !== bearer.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(bearer))
      )
        throw new UnauthorizedError();
      sendSuccess(res, { removed: await service.cleanup() });
    }),
  );
  router.post(
    "/guest-imports",
    uploadLimit,
    validate({ body: guestCreateSchema }),
    asyncHandler(async (req, res) => {
      sendSuccess(res, await service.create(req.body), { statusCode: 201 });
    }),
  );
  router.get(
    "/guest-imports/:id",
    validate({ params: guestIdSchema }),
    asyncHandler(async (req, res) => {
      sendSuccess(res, await service.status(req.params.id, token(req)));
    }),
  );
  router.patch(
    "/guest-imports/:id/answers",
    validate({ params: guestIdSchema, body: guestAnswersSchema }),
    asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.saveAnswers(req.params.id, token(req), req.body),
      );
    }),
  );
  router.post(
    "/guest-imports/:id/process",
    processLimit,
    validate({ params: guestIdSchema }),
    asyncHandler(async (req, res) => {
      sendSuccess(res, await service.process(req.params.id, token(req)));
    }),
  );
  router.patch("/guest-imports/:id/privacy", validate({ params: guestIdSchema, body: privacyChoicesSchema }), asyncHandler(async (req, res) => { sendSuccess(res, await service.updatePrivacy(req.params.id, token(req), req.body)); }));
  router.delete("/guest-imports/:id", validate({ params: guestIdSchema }), asyncHandler(async (req, res) => { sendSuccess(res, await service.delete(req.params.id, token(req))); }));
  router.post(
    "/guest-imports/:id/claim",
    auth,
    validate({ params: guestIdSchema }),
    asyncHandler(async (req, res) => {
      if (!req.auth) throw new UnauthorizedError();
      sendSuccess(
        res,
        await service.claim(req.params.id, token(req), req.auth.appUser.id),
      );
    }),
  );
  return router;
}
