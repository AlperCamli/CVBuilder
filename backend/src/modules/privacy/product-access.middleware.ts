import type { RequestHandler } from "express";
import type { MasterCvService } from "../master-cv/master-cv.service";
import type { PrivacyService } from "./privacy.service";
import { asyncHandler } from "../../shared/utils/async-handler";

export function createProductAccessGuard(privacy: PrivacyService, masterCvs: MasterCvService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const userId = req.auth!.appUser.id;
    const creation = req.method === "POST" && req.path === "/master-cvs";
    const preview = req.method === "POST" && req.path === "/rendering/preview";
    const manualEdit = req.method === "PUT" ? /^\/master-cvs\/([^/]+)\/content$/.exec(req.path)
      : req.method === "PATCH" ? /^\/master-cvs\/([^/]+)(?:\/template|\/blocks\/[^/]+)?$/.exec(req.path) : null;
    // These operations do not invoke AI. Keep account restrictions and ownership
    // checks while allowing the signup-to-blank-editor journey without AI consent.
    if (creation || preview || (manualEdit && (await masterCvs.getMasterCv(req.auth!, manualEdit[1])).source_type === "scratch")) {
      await privacy.assertProcessingAvailable(userId);
    } else {
      await privacy.assertProductAccess(userId);
    }
    next();
  });
}
