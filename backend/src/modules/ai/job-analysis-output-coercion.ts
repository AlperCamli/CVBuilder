const MAX_TOPICS = 20;
const MAX_TOPIC_LENGTH = 160;
const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LENGTH = 80;

const coerceStringList = (value: unknown, maxItems: number, maxLength: number): unknown => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength)
    .slice(0, maxItems);
};

// Providers cannot enforce array/length caps (structured-output modes drop
// maxItems/maxLength), so overflow lists are clamped to the contract limits
// instead of failing the run. Missing or non-array values pass through so the
// Zod contract still reports genuine shape violations.
export const coerceJobAnalysisOutputPayload = (
  payload: Record<string, unknown>
): Record<string, unknown> => {
  return {
    ...payload,
    topics: coerceStringList(payload.topics, MAX_TOPICS, MAX_TOPIC_LENGTH),
    keywords: coerceStringList(payload.keywords, MAX_KEYWORDS, MAX_KEYWORD_LENGTH)
  };
};
