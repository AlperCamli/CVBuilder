import type { AppConfig } from "../../../shared/config/env";
import { InternalServerError } from "../../../shared/errors/app-error";
import type { AiProvider } from "./ai-provider";
import { MockAiProvider } from "./mock-ai-provider";

export const createAiProvider = (config: AppConfig): AiProvider => {
  if (config.ai.provider === "mock") {
    return new MockAiProvider(config.ai.defaultModel);
  }

  throw new InternalServerError("Unsupported AI provider configuration");
};
