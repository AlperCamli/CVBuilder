import type { AiProviderUsage } from "./provider/ai-provider";

// USD per 1M tokens. cached_input defaults to input when a model has no cache discount; cache_write is the
// prompt-cache write rate (OpenAI GPT-5.6 and later, Anthropic) and defaults to input when writes cost nothing extra.
export interface ModelPrice {
  input: number;
  cached_input?: number;
  cache_write?: number;
  output: number;
}

export type ModelPriceTable = Record<string, ModelPrice>;

// Providers often return dated model ids (e.g. "gpt-6-luna-2026-09-01"); the longest
// configured name that prefixes the returned id wins.
export const resolveModelPrice = (
  prices: ModelPriceTable,
  modelName: string
): ModelPrice | null => {
  const exact = prices[modelName];
  if (exact) {
    return exact;
  }

  const match = Object.keys(prices)
    .filter((name) => modelName.startsWith(name))
    .sort((left, right) => right.length - left.length)[0];
  return match ? prices[match] ?? null : null;
};

// Returns null when the model has no configured price, so unknown costs are never shown as $0.
// Reasoning tokens are already included in output_tokens and are billed at the output rate.
// Cache reads and cache writes are both parts of input_tokens; the rest is billed at the input rate.
export const computeRunCostUsd = (
  prices: ModelPriceTable,
  modelName: string,
  usage: AiProviderUsage
): number | null => {
  const price = resolveModelPrice(prices, modelName);
  if (!price) {
    return null;
  }

  const cached = Math.min(usage.cached_input_tokens ?? 0, usage.input_tokens);
  const written = Math.min(usage.cache_write_input_tokens ?? 0, usage.input_tokens - cached);
  const uncachedInput = usage.input_tokens - cached - written;
  const cost =
    (uncachedInput * price.input +
      cached * (price.cached_input ?? price.input) +
      written * (price.cache_write ?? price.input) +
      usage.output_tokens * price.output) /
    1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000;
};

// Configured model names that no price matches. Their runs store cost_usd = null, so the dashboard's AI cost is
// a lower bound until AI_MODEL_PRICING_JSON prices them.
export const unpricedModels = (prices: ModelPriceTable, modelNames: string[]): string[] =>
  [...new Set(modelNames.filter((name) => name && !resolveModelPrice(prices, name)))];
