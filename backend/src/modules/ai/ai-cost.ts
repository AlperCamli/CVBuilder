import type { AiProviderUsage } from "./provider/ai-provider";

// USD per 1M tokens. cached_input defaults to input when a model has no cache discount.
export interface ModelPrice {
  input: number;
  cached_input?: number;
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
  const uncachedInput = usage.input_tokens - cached;
  const cost =
    (uncachedInput * price.input +
      cached * (price.cached_input ?? price.input) +
      usage.output_tokens * price.output) /
    1_000_000;

  return Math.round(cost * 1_000_000) / 1_000_000;
};
