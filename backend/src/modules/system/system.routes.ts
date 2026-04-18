import { Router } from "express";
import type { SystemController } from "./system.controller";

export const createSystemRouter = (systemController: SystemController): Router => {
  const router = Router();

  router.get("/health", systemController.getHealth);
  router.get("/ready", systemController.getReadiness);
  router.get("/version", systemController.getVersion);

  return router;
};
