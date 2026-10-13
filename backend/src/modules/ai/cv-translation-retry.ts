import { ZodError } from "zod";
import { AiProviderError, AppError, ValidationError } from "../../shared/errors/app-error";

export const TRANSLATION_BLOCK_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Retry model/transport failures, never permission or application failures. */
function canRetry(error: unknown): boolean {
  if (error instanceof ZodError || error instanceof ValidationError) return true;
  if (error instanceof AiProviderError) {
    const details = error.details;
    if (["provider_refusal", "usage_record_failed"].includes(String(details?.reason))) return false;
    if (details?.provider_hard_quota_exceeded === true) return false;
    if (details?.provider_status === 429 && (
      /PerDay/i.test(String(details.provider_quota_id)) ||
      /quota exceeded|exceeded.*quota|insufficient_quota|free_tier_requests|billing/i.test(String(details.reason))
    )) return false;
    return typeof details?.provider_status !== "number" || RETRYABLE_STATUS_CODES.has(details.provider_status);
  }
  if (error instanceof AppError) return false;
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return RETRYABLE_STATUS_CODES.has(status);
  return error instanceof Error;
}

/** One worker owns the block and its retries, so concurrency stays bounded. */
export async function retryTranslationBlock<T>(operation: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= TRANSLATION_BLOCK_MAX_ATTEMPTS || !canRetry(error)) throw error;
      const hint = error instanceof AiProviderError ? error.details?.provider_retry_delay_ms : undefined;
      const retryHint = typeof hint === "number" && Number.isFinite(hint) ? Math.max(0, hint) : 0;
      // Very long Retry-After hints cannot fit this request-bound operation.
      if (retryHint > 30_000) throw error;
      const backoff = 1_000 * 2 ** (attempt - 1);
      const delay = Math.max(backoff * (0.75 + Math.random() * 0.25), retryHint);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
}
