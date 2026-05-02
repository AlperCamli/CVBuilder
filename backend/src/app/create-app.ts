import cors from "cors";
import express, { Router, type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { getConfig, type AppConfig } from "../shared/config/env";
import { createLogger, createRequestLogger } from "../shared/logging/logger";
import { createErrorHandler } from "../shared/middleware/error-handler";
import { notFoundMiddleware } from "../shared/middleware/not-found";
import { createGlobalRateLimiter } from "../shared/middleware/rate-limit";
import { buildDefaultServices, type AppServices, type ServiceOverrides } from "./build-services";
import { registerV1Routes } from "./register-routes";

interface CreateAppOptions {
  config?: AppConfig;
  logger?: Logger;
  services?: Partial<AppServices>;
  serviceOverrides?: ServiceOverrides;
}

const hasCompleteServiceOverrides = (
  services: Partial<AppServices> | undefined
): services is AppServices => {
  return Boolean(
    services?.authService &&
      services?.usersService &&
      services?.dashboardService &&
      services?.systemService &&
      services?.masterCvService &&
      services?.importsService &&
      services?.jobsService &&
      services?.coverLettersService &&
      services?.tailoredCvService &&
      services?.cvRevisionsService &&
      services?.aiService &&
      services?.aiRepository &&
      services?.templatesService &&
      services?.renderingService &&
      services?.filesService &&
      services?.exportsService &&
      services?.billingService
  );
};

export const createApp = (options?: CreateAppOptions): Express => {
  const config = options?.config ?? getConfig();
  const logger = options?.logger ?? createLogger(config);

  const defaultServices = hasCompleteServiceOverrides(options?.services)
    ? undefined
    : buildDefaultServices(config, logger, options?.serviceOverrides);

  const services: AppServices = {
    authService: options?.services?.authService ?? defaultServices?.authService!,
    usersService: options?.services?.usersService ?? defaultServices?.usersService!,
    dashboardService: options?.services?.dashboardService ?? defaultServices?.dashboardService!,
    systemService: options?.services?.systemService ?? defaultServices?.systemService!,
    masterCvService: options?.services?.masterCvService ?? defaultServices?.masterCvService!,
    importsService: options?.services?.importsService ?? defaultServices?.importsService!,
    jobsService: options?.services?.jobsService ?? defaultServices?.jobsService!,
    coverLettersService: options?.services?.coverLettersService ?? defaultServices?.coverLettersService!,
    tailoredCvService: options?.services?.tailoredCvService ?? defaultServices?.tailoredCvService!,
    cvRevisionsService:
      options?.services?.cvRevisionsService ?? defaultServices?.cvRevisionsService!,
    aiService: options?.services?.aiService ?? defaultServices?.aiService!,
    aiRepository: options?.services?.aiRepository ?? defaultServices?.aiRepository!,
    templatesService: options?.services?.templatesService ?? defaultServices?.templatesService!,
    renderingService: options?.services?.renderingService ?? defaultServices?.renderingService!,
    filesService: options?.services?.filesService ?? defaultServices?.filesService!,
    exportsService: options?.services?.exportsService ?? defaultServices?.exportsService!,
    billingService: options?.services?.billingService ?? defaultServices?.billingService!
  };

  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(createRequestLogger(logger));
  app.use("/api/v1/billing/webhooks", express.raw({ type: "application/json" }));
  app.use(express.json());

  const allowedOrigins = new Set<string>([
    config.frontendAppUrl,
    ...config.corsAllowedOrigins
  ]);
  if (config.appEnv === "development" || config.appEnv === "test") {
    allowedOrigins.add("http://localhost:5173");
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:5173");
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );

  const v1Router = Router();
  v1Router.use(createGlobalRateLimiter(config));
  registerV1Routes(v1Router, services, config);
  app.use("/api/v1", v1Router);

  app.use(notFoundMiddleware);
  app.use(createErrorHandler(config));

  return app;
};
