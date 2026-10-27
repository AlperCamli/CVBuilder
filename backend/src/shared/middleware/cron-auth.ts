import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { UnauthorizedError } from "../errors/app-error";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; without a secret every call is refused.
export const requireCronSecret: RequestHandler = (req, _res, next) => {
  const expected = process.env.CRON_SECRET;
  const supplied = req.get("Authorization") ?? "";
  const bearer = expected ? `Bearer ${expected}` : "";
  if (
    !bearer ||
    supplied.length !== bearer.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(bearer))
  ) {
    next(new UnauthorizedError());
    return;
  }
  next();
};
