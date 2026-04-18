import { Router } from "express";
import type { RequestHandler } from "express";
import { validate } from "../../shared/validation/validate";
import { updateMeSchema, updateSettingsSchema } from "./users.schemas";
import type { UsersController } from "./users.controller";

export const createUsersRouter = (
  usersController: UsersController,
  authMiddleware: RequestHandler
): Router => {
  const router = Router();

  router.get("/me", authMiddleware, usersController.getMe);
  router.patch("/me", authMiddleware, validate({ body: updateMeSchema }), usersController.patchMe);
  router.get("/me/settings", authMiddleware, usersController.getSettings);
  router.patch(
    "/me/settings",
    authMiddleware,
    validate({ body: updateSettingsSchema }),
    usersController.patchSettings
  );
  router.get("/me/usage", authMiddleware, usersController.getUsage);

  return router;
};
