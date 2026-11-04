import type { Logger } from "pino";
import type { AppConfig } from "../../../shared/config/env";
import { InternalServerError } from "../../../shared/errors/app-error";
import { unpricedModels } from "../ai-cost";
import type { AiProvider } from "./ai-provider";
import type { AiUsageSink } from "./ai-usage-ledger";
import { AnthropicAiProvider } from "./anthropic-ai-provider";
import { GeminiAiProvider } from "./gemini-ai-provider";
import { MockAiProvider } from "./mock-ai-provider";
import { OpenAiAiProvider } from "./openai-ai-provider";

export interface CreateAiProviderOptions {
  // Receives one event per provider HTTP attempt (public.ai_usage_events); omitted, attempts are not recorded.
  usageSink?: AiUsageSink | null;
  logger?: Pick<Logger, "warn">;
}

const tierModels = (config: AppConfig): string[] => {
  switch (config.ai.provider) {
    case "openai": return [config.ai.openaiModelLight, config.ai.openaiModelHeavy];
    case "gemini": return [config.ai.geminiModelLight, config.ai.geminiModelHeavy];
    case "anthropic": return [config.ai.anthropicModelLight, config.ai.anthropicModelHeavy];
    default: return [];
  }
};

// A missing price is not fatal: those runs store cost_usd = null and the dashboard counts them as unpriced.
const warnOnUnpricedModels = (config: AppConfig, logger: Pick<Logger, "warn"> | undefined) => {
  const models = unpricedModels(config.ai.modelPricing ?? {}, tierModels(config));
  if (models.length) {
    logger?.warn(
      { code: "AI_MODEL_PRICE_MISSING", provider: config.ai.provider, models },
      "AI_MODEL_PRICING_JSON has no price for the active AI models; their cost is not recorded"
    );
  }
};

export const createAiProvider = (config: AppConfig, options: CreateAiProviderOptions = {}): AiProvider => {
  if (config.ai.provider === "mock") {
    return new MockAiProvider(config.ai.defaultModel);
  }

  warnOnUnpricedModels(config, options.logger);
  const usageSink = options.usageSink ?? null;

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
      maxOutputTokensHeavy: config.ai.geminiMaxOutputTokensHeavy,
      usageSink
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
      maxOutputTokensHeavy: config.ai.maxOutputTokensHeavy,
      reasoningEffort: config.ai.openaiReasoningEffort,
      usageSink
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
      maxOutputTokensHeavy: config.ai.maxOutputTokensHeavy,
      usageSink
    });
  }

  throw new InternalServerError("Unsupported AI provider configuration");
};
