import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createProductAccessGuard } from "../src/modules/privacy/product-access.middleware";
import type { PrivacyService } from "../src/modules/privacy/privacy.service";
import type { MasterCvService } from "../src/modules/master-cv/master-cv.service";
import { ForbiddenError, NotFoundError } from "../src/shared/errors/app-error";

function fixture(sourceType = "scratch", restricted = false) {
  const privacy = {
    assertProcessingAvailable: vi.fn(async () => { if (restricted) throw new ForbiddenError("restricted"); }),
    assertProductAccess: vi.fn(async () => { throw new ForbiddenError("AI permission required"); }),
  };
  const masterCvs = { getMasterCv: vi.fn(async (_session: unknown, id: string) => {
    if (id === "other-account") throw new NotFoundError();
    return { source_type: sourceType };
  }) };
  const app = express();
  app.use((req, res, next) => {
    if (!req.get("Authorization")) { res.sendStatus(401); return; }
    req.auth = { appUser: { id: "owner" } } as NonNullable<typeof req.auth>;
    next();
  });
  app.use(createProductAccessGuard(privacy as unknown as PrivacyService, masterCvs as unknown as MasterCvService));
  app.use((_req, res) => { res.sendStatus(204); });
  app.use(((err, _req, res, _next) => { res.status(err.statusCode ?? 500).json({ message: err.message }); }) as ErrorRequestHandler);
  return { app, privacy, masterCvs };
}

describe("manual CV access without AI consent", () => {
  it.each([
    ["post", "/master-cvs"], ["post", "/rendering/preview"],
    ["put", "/master-cvs/owned/content"], ["patch", "/master-cvs/owned"],
    ["patch", "/master-cvs/owned/template"], ["patch", "/master-cvs/owned/blocks/summary"],
  ] as const)("permits %s %s while checking account restrictions", async (method, path) => {
    const { app, privacy } = fixture();
    expect((await request(app)[method](path).set("Authorization", "Bearer fixture")).status).toBe(204);
    expect(privacy.assertProcessingAvailable).toHaveBeenCalledWith("owner");
    expect(privacy.assertProductAccess).not.toHaveBeenCalled();
  });
  it.each([
    ["post", "/ai/suggest"], ["post", "/imports"], ["post", "/master-cvs/owned/translations"],
    ["post", "/master-cvs/owned/translations/run/execute"], ["post", "/master-cvs/owned/exports/pdf"],
  ] as const)("still requires product AI consent for %s %s", async (method, path) => {
    const { app, privacy } = fixture();
    expect((await request(app)[method](path).set("Authorization", "Bearer fixture")).status).toBe(403);
    expect(privacy.assertProductAccess).toHaveBeenCalledWith("owner");
  });
  it("retains ownership, authentication, and restricted-account checks", async () => {
    const { app } = fixture();
    expect((await request(app).post("/master-cvs")).status).toBe(401);
    expect((await request(app).put("/master-cvs/other-account/content").set("Authorization", "Bearer fixture")).status).toBe(404);
    const blocked = fixture("scratch", true);
    expect((await request(blocked.app).post("/master-cvs").set("Authorization", "Bearer fixture")).status).toBe(403);
  });
  it("keeps the existing consent requirement for editing imported CVs", async () => {
    const { app, privacy } = fixture("import");
    expect((await request(app).put("/master-cvs/owned/content").set("Authorization", "Bearer fixture")).status).toBe(403);
    expect(privacy.assertProductAccess).toHaveBeenCalledWith("owner");
  });
});
