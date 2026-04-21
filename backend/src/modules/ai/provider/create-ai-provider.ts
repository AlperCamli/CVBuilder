import type { AppConfig } from "../../../shared/config/env";
import { InternalServerError } from "../../../shared/errors/app-error";
import type { AiProvider } from "./ai-provider";
import { GeminiAiProvider } from "./gemini-ai-provider";
import { MockAiProvider } from "./mock-ai-provider";

export const createAiProvider = (config: AppConfig): AiProvider => {
  if (config.ai.provider === "mock") {
    return new MockAiProvider(config.ai.defaultModel);
  }

  if (config.ai.provider === "gemini") {
    if (!config.ai.geminiApiKey) {
      throw new InternalServerError("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
    }

    return new GeminiAiProvider(config.ai.defaultModel, config.ai.geminiApiKey);
  }

  throw new InternalServerError("Unsupported AI provider configuration");
};
