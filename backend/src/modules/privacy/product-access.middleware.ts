import { isExistingCvWorkspaceRequest } from "../billing/subscription-access";
import type { RequestHandler } from "express";
import type { MasterCvService } from "../master-cv/master-cv.service";
import type { PrivacyService } from "./privacy.service";
import { asyncHandler } from "../../shared/utils/async-handler";

export function createProductAccessGuard(privacy: PrivacyService, masterCvs: MasterCvService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const userId = req.auth!.appUser.id;
    const creation = req.method === "POST" && req.path === "/master-cvs";
    const preview = req.method === "POST" && req.path === "/rendering/preview";
    const manualEdit = isExistingCvWorkspaceRequest(req.method, req.path);
    const masterId = /^\/master-cvs\/([^/]+)/.exec(req.path)?.[1];
    if (manualEdit && masterId) await masterCvs.getMasterCv(req.auth!, masterId);
    // These operations do not invoke AI. Keep account restrictions and ownership
    // checks while allowing manual work on existing CVs without AI consent.
    if (creation || preview || manualEdit) {
      await privacy.assertProcessingAvailable(userId);
    } else {
      await privacy.assertProductAccess(userId);
    }
    next();
  });
}
