import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { asyncHandler } from "../../shared/utils/async-handler";
import { sendSuccess } from "../../shared/http/response";
import { validate } from "../../shared/validation/validate";
import { guestAnswersSchema } from "../guest-imports/guest-imports.schemas";
import type { PrivacyService } from "./privacy.service";
import { requireFreshAuthentication } from "./reauthentication";

export const privacyChoicesSchema = z.object({ notice_version: z.string().max(40), ai_processing: z.boolean().optional(), analytics: z.boolean() }).strict();
export function createPrivacyRouter(service: PrivacyService, auth: RequestHandler) {
  const router = Router();
  router.use((_, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.get("/privacy/config", asyncHandler(async (_, res) => { sendSuccess(res, service.config()); }));
  router.get("/privacy/health", asyncHandler(async (_, res) => {
    const health = await service.health();
    res.status(health.overdue || health.failures > 0 ? 503 : 200);
    sendSuccess(res, { healthy: !health.overdue && health.failures === 0 }, { statusCode: health.overdue || health.failures ? 503 : 200 });
  }));
  router.get("/me/privacy", auth, asyncHandler(async (req, res) => { sendSuccess(res, await service.preferences(req.auth!.appUser.id)); }));
  router.patch("/me/privacy", auth, validate({ body: privacyChoicesSchema }), asyncHandler(async (req, res) => {
    await service.record(req.auth!.appUser.id, null, req.body);
    sendSuccess(res, await service.preferences(req.auth!.appUser.id));
  }));
  router.patch("/me/onboarding-answers", auth, validate({ body: guestAnswersSchema }), asyncHandler(async (req, res) => { sendSuccess(res, await service.updateAnswers(req.auth!.appUser.id, req.body)); }));
  router.post("/me/privacy/exports", auth, asyncHandler(async (req, res) => { sendSuccess(res, await service.requestExport(req.auth!.appUser.id), { statusCode: 202 }); }));
  router.get("/me/privacy/exports/:id", auth, validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => { sendSuccess(res, await service.exportStatus(req.auth!.appUser.id, req.params.id)); }));
  router.get("/me/privacy/exports/:id/download", auth, validate({ params: z.object({ id: z.string().uuid() }) }), asyncHandler(async (req, res) => { sendSuccess(res, await service.exportDownload(req.auth!.appUser.id, req.params.id)); }));
  router.post("/me/privacy/deletion", auth, validate({ body: z.object({ confirmation: z.literal("DELETE") }).strict() }), asyncHandler(async (req, res) => {
    const jwt = req.get("Authorization")!.slice(7);
    requireFreshAuthentication(jwt, req.auth!.authUser.auth_user_id);
    sendSuccess(res, await service.requestDeletion(req.auth!.appUser.id, req.auth!.authUser.auth_user_id, jwt), { statusCode: 202 });
  }));
  return router;
}
