import { createApp } from "./app/create-app";
import { assertProductionPromptProfileCoverage } from "./modules/ai/prompts/prompt-profile-guard";
import { getConfig } from "./shared/config/env";

const bootstrap = async () => {
  const config = getConfig();
  await assertProductionPromptProfileCoverage(config);

  const app = createApp({ config });
  app.listen(config.port, () => {
    console.log(`${config.appName} listening on port ${config.port}`);
  });
};

void bootstrap().catch((error) => {
  console.error("Failed to bootstrap application", error);
  process.exitCode = 1;
});
