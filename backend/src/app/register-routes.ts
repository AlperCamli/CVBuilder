import { isExistingCvWorkspaceRequest } from "../modules/billing/subscription-access";
import { createPrivacyRouter } from "../modules/privacy/privacy.routes";
import { createProductAccessGuard } from "../modules/privacy/product-access.middleware";
import { asyncHandler } from "../shared/utils/async-handler";
import { createGuestImportsRouter } from "../modules/guest-imports/guest-imports.routes";
import type { Router } from "express";
import type { AppConfig } from "../shared/config/env";
import {
  createAdminExportRateLimiter,
  createAdminIpRateLimiter,
  createAdminRateLimiter,
  createAiRateLimiter,
  createTailoringRateLimiter
} from "../shared/middleware/rate-limit";
import { createRequireAdmin } from "../shared/middleware/require-admin";
import { AdminAnalyticsController } from "../modules/admin-analytics/admin-analytics.controller";
import { createAdminAnalyticsRouter } from "../modules/admin-analytics/admin-analytics.routes";
import { createAdminAuthMiddleware } from "../modules/admin-analytics/admin-identity";
import { TailoringController } from "../modules/tailoring/tailoring.controller";
import { createTailoringRouter } from "../modules/tailoring/tailoring.routes";
import { createAuthMiddleware } from "../modules/auth/auth.middleware";
import { AiController } from "../modules/ai/ai.controller";
import { createAiRouter } from "../modules/ai/ai.routes";
import { CvRevisionsController } from "../modules/cv-revisions/cv-revisions.controller";
import { createCvRevisionsRouter } from "../modules/cv-revisions/cv-revisions.routes";
import { DashboardController } from "../modules/dashboard/dashboard.controller";
import { createDashboardRouter } from "../modules/dashboard/dashboard.routes";
import { ImportsController } from "../modules/imports/imports.controller";
import { createImportsRouter } from "../modules/imports/imports.routes";
import { JobsController } from "../modules/jobs/jobs.controller";
import { createJobsRouter } from "../modules/jobs/jobs.routes";
import { CoverLettersController } from "../modules/cover-letters/cover-letters.controller";
import { createCoverLettersRouter } from "../modules/cover-letters/cover-letters.routes";
import { MasterCvController } from "../modules/master-cv/master-cv.controller";
import { createMasterCvRouter } from "../modules/master-cv/master-cv.routes";
import { SystemController } from "../modules/system/system.controller";
import { createSystemRouter } from "../modules/system/system.routes";
import { TailoredCvController } from "../modules/tailored-cv/tailored-cv.controller";
import { createTailoredCvRouter } from "../modules/tailored-cv/tailored-cv.routes";
import { TemplatesController } from "../modules/templates/templates.controller";
import { createTemplatesRouter } from "../modules/templates/templates.routes";
import { UsersController } from "../modules/users/users.controller";
import { createUsersRouter } from "../modules/users/users.routes";
import { RenderingController } from "../modules/rendering/rendering.controller";
import { createRenderingRouter } from "../modules/rendering/rendering.routes";
import { CvPhotosController } from "../modules/cv-photos/cv-photos.controller";
import { createCvPhotosRouter } from "../modules/cv-photos/cv-photos.routes";
import { ExportsController } from "../modules/exports/exports.controller";
import { createExportsRouter } from "../modules/exports/exports.routes";
import { BillingController } from "../modules/billing/billing.controller";
import { createBillingRouter } from "../modules/billing/billing.routes";
import { createMonetizationRouter } from "../modules/monetization/monetization.routes";
import type { AppServices } from "./build-services";

export const registerV1Routes = (
  router: Router,
  services: AppServices,
  config: AppConfig
): void => {
  const authMiddleware = createAuthMiddleware(services.authService);
  const aiRateLimiter = createAiRateLimiter(config);

  const systemController = new SystemController(services.systemService);
  const usersController = new UsersController(services.usersService);
  const dashboardController = new DashboardController(services.dashboardService);
  const masterCvController = new MasterCvController(services.masterCvService);
  const importsController = new ImportsController(services.importsService);
  const jobsController = new JobsController(services.jobsService);
  const coverLettersController = new CoverLettersController(services.coverLettersService);
  const tailoredCvController = new TailoredCvController(services.tailoredCvService);
  const cvRevisionsController = new CvRevisionsController(services.cvRevisionsService);
  const aiController = new AiController(services.aiService, services.renderingService, services.cvPhotosService);
  const templatesController = new TemplatesController(services.templatesService);
  const renderingController = new RenderingController(services.renderingService, services.cvPhotosService);
  const cvPhotosController = new CvPhotosController(services.cvPhotosService);
  const exportsController = new ExportsController(services.exportsService);
  const billingController = new BillingController(services.billingService, config);

  router.use(createSystemRouter(systemController));
  if (services.privacyService) {
    router.use(createPrivacyRouter(services.privacyService, authMiddleware));
    router.use(asyncHandler(async (req, _res, next) => {
      if (req.method === "POST" && ["/imports/upload-url", "/imports", "/cv-photos/upload-url"].includes(req.path)) await services.privacyService!.assertCollection(false);
      next();
    }));
  }
  if (services.guestImportsService) router.use(createGuestImportsRouter(services.guestImportsService, authMiddleware));
  if (services.monetizationRefreshService) router.use(createMonetizationRouter(services.monetizationRefreshService, services.monetizationBackfillService));
  // Admin analytics stays outside the product-access/consent guards below and
  // authenticates the Supabase identity only, never creating a product account.
  if (services.adminAnalyticsService && services.adminIdentityProvider) {
    router.use(
      createAdminAnalyticsRouter(
        new AdminAnalyticsController(services.adminAnalyticsService),
        createAdminAuthMiddleware(services.adminIdentityProvider),
        createRequireAdmin(config.adminEmails ?? []),
        createAdminIpRateLimiter(config),
        createAdminRateLimiter(config),
        createAdminExportRateLimiter(config)
      )
    );
  }
  // Onboarding may claim/read an import and save account answers before activation.
  // Existing users retain their manual CV workspace; creation, AI, tailoring and exports stay paid.
  router.use((req, res, next) => {
    // Express routes accept case variations and a trailing slash by default.
    const path = req.path.toLowerCase().replace(/\/+$/, "") || "/";
    const applicationRoute = /^\/(dashboard|master-cvs|tailored-cvs|jobs|cover-letters|cv-revisions|revisions|ai|rendering|cv-photos|exports)(\/|$)/.test(path);
    const importMutation = /^\/imports(?:\/|$)/.test(path) && !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (!applicationRoute && !importMutation) { next(); return; }
    authMiddleware(req, res, error => {
      if (error) { next(error); return; }
      void services.billingService.assertSubscriptionAccess(req.auth!.appUser.id, isExistingCvWorkspaceRequest(req.method, req.path), { action: "app_access", surface: path.split("/")[1] }).then(() => next(), next);
    });
  });
  if (services.privacyService) router.use((req, res, next) => {
    if (!["POST", "PATCH", "PUT"].includes(req.method) || !/^\/(imports|ai|master-cvs|tailored-cvs|jobs|cover-letters|cv-photos|exports|rendering)(\/|$)/.test(req.path)) { next(); return; }
    authMiddleware(req, res, error => {
      if (error) { next(error); return; }
      createProductAccessGuard(services.privacyService!, services.masterCvService)(req, res, next);
    });
  });
  router.use(createUsersRouter(usersController, authMiddleware));
  router.use(createDashboardRouter(dashboardController, authMiddleware));
  router.use(createMasterCvRouter(masterCvController, authMiddleware));
  router.use(createImportsRouter(importsController, authMiddleware));
  router.use(createTailoredCvRouter(tailoredCvController, authMiddleware));
  router.use(createJobsRouter(jobsController, authMiddleware));
  router.use(createCoverLettersRouter(coverLettersController, authMiddleware));
  router.use(createCvRevisionsRouter(cvRevisionsController, authMiddleware));
  router.use(createAiRouter(aiController, authMiddleware, aiRateLimiter));
  if (services.tailoringService) {
    router.use(
      createTailoringRouter(
        new TailoringController(services.tailoringService),
        services.tailoringService,
        authMiddleware,
        createTailoringRateLimiter(config)
      )
    );
  }
  router.use(createTemplatesRouter(templatesController, authMiddleware));
  router.use(createRenderingRouter(renderingController, authMiddleware));
  router.use(createCvPhotosRouter(cvPhotosController, authMiddleware));
  router.use(createExportsRouter(exportsController, authMiddleware));
  router.use(createBillingRouter(billingController, authMiddleware));
};
