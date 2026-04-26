import { buildDefaultServices } from "./app/build-services";
import { createApp } from "./app/create-app";
import { startAiRunWatchdog } from "./modules/ai/ai-run-watchdog";
import { assertProductionPromptProfileCoverage } from "./modules/ai/prompts/prompt-profile-guard";
import { getConfig } from "./shared/config/env";
import { createLogger } from "./shared/logging/logger";

const bootstrap = async () => {
  const config = getConfig();
  await assertProductionPromptProfileCoverage(config);

  const logger = createLogger(config);
  const services = buildDefaultServices(config, logger);

  const watchdog = startAiRunWatchdog(services.aiRepository, {
    staleAfterMs: config.ai.runStaleAfterMs,
    sweepIntervalMs: config.ai.runSweepIntervalMs,
    logger
  });

  const app = createApp({ config, logger, services });
  const server = app.listen(config.port, () => {
    console.log(`${config.appName} listening on port ${config.port}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    watchdog.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

void bootstrap().catch((error) => {
  console.error("Failed to bootstrap application", error);
  process.exitCode = 1;
});
