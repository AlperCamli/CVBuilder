import type { AppConfig } from "../../../shared/config/env";
import { InternalServerError } from "../../../shared/errors/app-error";
import type { AiProvider } from "./ai-provider";
import { AnthropicAiProvider } from "./anthropic-ai-provider";
import { GeminiAiProvider } from "./gemini-ai-provider";
import { MockAiProvider } from "./mock-ai-provider";
import { OpenAiAiProvider } from "./openai-ai-provider";

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

  if (config.ai.provider === "openai") {
    if (!config.ai.openaiApiKey) {
      throw new InternalServerError("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    }

    return new OpenAiAiProvider(config.ai.openaiModelHeavy, config.ai.openaiApiKey, {
      maxAttempts: config.ai.requestMaxAttempts,
      baseRetryDelayMs: config.ai.retryBaseDelayMs,
      maxRetryDelayMs: config.ai.retryMaxDelayMs,
      lightModelName: config.ai.openaiModelLight,
      heavyModelName: config.ai.openaiModelHeavy,
      requestTimeoutMs: config.ai.requestTimeoutMs,
      maxOutputTokensLight: config.ai.maxOutputTokensLight,
      maxOutputTokensHeavy: config.ai.maxOutputTokensHeavy
    });
  }

  if (config.ai.provider === "anthropic") {
    if (!config.ai.anthropicApiKey) {
      throw new InternalServerError("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
    }

    return new AnthropicAiProvider(config.ai.anthropicModelHeavy, config.ai.anthropicApiKey, {
      maxAttempts: config.ai.requestMaxAttempts,
      baseRetryDelayMs: config.ai.retryBaseDelayMs,
      maxRetryDelayMs: config.ai.retryMaxDelayMs,
      lightModelName: config.ai.anthropicModelLight,
      heavyModelName: config.ai.anthropicModelHeavy,
      requestTimeoutMs: config.ai.requestTimeoutMs,
      maxOutputTokensLight: config.ai.maxOutputTokensLight,
      maxOutputTokensHeavy: config.ai.maxOutputTokensHeavy
    });
  }

  throw new InternalServerError("Unsupported AI provider configuration");
};
