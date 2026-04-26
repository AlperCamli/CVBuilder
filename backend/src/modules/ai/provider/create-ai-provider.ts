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

    return new GeminiAiProvider(config.ai.defaultModel, config.ai.geminiApiKey, {
      maxAttempts: config.ai.geminiMaxAttempts,
      baseRetryDelayMs: config.ai.geminiRetryBaseDelayMs,
      maxRetryDelayMs: config.ai.geminiRetryMaxDelayMs,
      lightModelName: config.ai.geminiModelLight,
      heavyModelName: config.ai.geminiModelHeavy,
      requestTimeoutMs: config.ai.geminiRequestTimeoutMs,
      maxOutputTokensLight: config.ai.geminiMaxOutputTokensLight,
      maxOutputTokensHeavy: config.ai.geminiMaxOutputTokensHeavy
    });
  }

  throw new InternalServerError("Unsupported AI provider configuration");
};
