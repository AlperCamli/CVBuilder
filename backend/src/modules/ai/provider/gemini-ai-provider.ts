import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiProviderError } from "../../../shared/errors/app-error";
import type { AiFlowType } from "../../../shared/types/domain";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";

const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_PROVIDER_STATUS_CODES = new Set([
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "INTERNAL"
]);
const MAX_PROVIDER_RETRY_HINT_DELAY_MS = 120_000;

const GEMINI_SCHEMA_DROPPED_KEYS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties"
]);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

export const sanitizeGeminiResponseJsonSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiResponseJsonSchema(item));
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (GEMINI_SCHEMA_DROPPED_KEYS.has(key)) {
        continue;
      }
      sanitized[key] = sanitizeGeminiResponseJsonSchema(item);
    }

    return sanitized;
  }

  return value;
};

const toPromptText = (request: AiProviderRequest): string => {
  return [
    "You are an expert CV writing assistant.",
    request.prompt.system_prompt,
    request.prompt.user_prompt,
    "Return only valid JSON that strictly matches the requested schema.",
    "Always produce English output.",
    `flow_type: ${request.flow_type}`,
    `input_payload: ${JSON.stringify(request.input_payload)}`
  ].join("\n\n");
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const clampNonNegativeInteger = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
};

interface GeminiProviderErrorContext {
  providerStatus: number | null;
  providerErrorName: string | null;
  providerStatusCode: string | null;
  quotaId: string | null;
  quotaMetric: string | null;
  providerRetryDelayMs: number | null;
  isHardQuotaExceeded: boolean;
  reason: string;
}

interface ParsedGeminiErrorPayload {
  error?: {
    status?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

const parseGeminiErrorPayload = (message: string): ParsedGeminiErrorPayload | null => {
  if (!message.trim()) {
    return null;
  }

  try {
    return JSON.parse(message) as ParsedGeminiErrorPayload;
  } catch {
    return null;
  }
};

const parseProviderStatusCode = (payload: ParsedGeminiErrorPayload | null): string | null => {
  return typeof payload?.error?.status === "string" ? payload.error.status : null;
};

const parseQuotaContext = (
  payload: ParsedGeminiErrorPayload | null
): { quotaId: string | null; quotaMetric: string | null } => {
  const details = Array.isArray(payload?.error?.details) ? payload?.error?.details : [];

  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) {
      continue;
    }

    const violations = (detail as { violations?: unknown }).violations;
    if (!Array.isArray(violations)) {
      continue;
    }

    for (const violation of violations) {
      if (typeof violation !== "object" || violation === null) {
        continue;
      }

      const quotaId =
        typeof (violation as { quotaId?: unknown }).quotaId === "string"
          ? (violation as { quotaId: string }).quotaId
          : null;
      const quotaMetric =
        typeof (violation as { quotaMetric?: unknown }).quotaMetric === "string"
          ? (violation as { quotaMetric: string }).quotaMetric
          : null;

      if (quotaId || quotaMetric) {
        return { quotaId, quotaMetric };
      }
    }
  }

  return { quotaId: null, quotaMetric: null };
};

const parseRetryDelayMs = (payload: ParsedGeminiErrorPayload | null): number | null => {
  const details = Array.isArray(payload?.error?.details) ? payload?.error?.details : [];

  for (const detail of details) {
    if (typeof detail !== "object" || detail === null) {
      continue;
    }

    const typedDetail = detail as {
      "@type"?: unknown;
      retryDelay?: unknown;
      retry_delay?: unknown;
    };

    const typeName = typeof typedDetail["@type"] === "string" ? typedDetail["@type"] : "";
    if (!typeName.includes("google.rpc.RetryInfo")) {
      continue;
    }

    const retryDelay =
      typeof typedDetail.retryDelay === "string"
        ? typedDetail.retryDelay
        : typeof typedDetail.retry_delay === "string"
          ? typedDetail.retry_delay
          : null;

    if (!retryDelay || !retryDelay.endsWith("s")) {
      continue;
    }

    const seconds = Number.parseFloat(retryDelay.slice(0, -1));
    if (!Number.isFinite(seconds) || seconds < 0) {
      continue;
    }

    const milliseconds = Math.floor(seconds * 1000);
    if (milliseconds > 0) {
      return Math.min(milliseconds, MAX_PROVIDER_RETRY_HINT_DELAY_MS);
    }
  }

  return null;
};

const toGeminiProviderErrorContext = (error: unknown): GeminiProviderErrorContext => {
  const providerStatus =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status as number)
      : null;
  const providerErrorName = error instanceof Error ? error.name : null;
  const reason = error instanceof Error ? error.message : "Unknown provider error";
  const parsedPayload = parseGeminiErrorPayload(reason);
  const providerStatusCode = parseProviderStatusCode(parsedPayload);
  const { quotaId, quotaMetric } = parseQuotaContext(parsedPayload);
  const providerRetryDelayMs = parseRetryDelayMs(parsedPayload);
  const normalizedReason = reason.toLowerCase();
  const isHardQuotaExceeded =
    (typeof providerStatus === "number" && providerStatus === 429) &&
    (normalizedReason.includes("quota exceeded") ||
      normalizedReason.includes("free_tier_requests") ||
      (typeof quotaId === "string" && quotaId.includes("PerDay")));

  return {
    providerStatus,
    providerErrorName,
    providerStatusCode,
    quotaId,
    quotaMetric,
    providerRetryDelayMs,
    isHardQuotaExceeded,
    reason
  };
};

const isRetryableProviderError = (context: GeminiProviderErrorContext): boolean => {
  if (context.isHardQuotaExceeded) {
    return false;
  }

  if (
    typeof context.providerStatus === "number" &&
    RETRYABLE_HTTP_STATUS_CODES.has(context.providerStatus)
  ) {
    return true;
  }

  if (
    typeof context.providerStatusCode === "string" &&
    RETRYABLE_PROVIDER_STATUS_CODES.has(context.providerStatusCode)
  ) {
    return true;
  }

  return false;
};

export class GeminiAiProvider implements AiProvider {
  readonly providerName = "gemini";
  private readonly client: GoogleGenAI;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number[] | null;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly randomFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    private readonly defaultModelName: string,
    apiKey: string,
    options?: {
      maxAttempts?: number;
      retryDelayMs?: number[];
      baseRetryDelayMs?: number;
      maxRetryDelayMs?: number;
      randomFn?: () => number;
      sleepFn?: (ms: number) => Promise<void>;
    }
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
    this.retryDelayMs = options?.retryDelayMs?.map((value) =>
      clampNonNegativeInteger(value, 0)
    ) ?? null;
    this.baseRetryDelayMs = clampNonNegativeInteger(options?.baseRetryDelayMs ?? 500, 500);
    this.maxRetryDelayMs = clampNonNegativeInteger(options?.maxRetryDelayMs ?? 8_000, 8_000);
    this.randomFn = options?.randomFn ?? Math.random;
    this.sleepFn = options?.sleepFn ?? sleep;
  }

  resolveModelName(_flowType: AiFlowType): string {
    return this.defaultModelName;
  }

  private computeRetryDelayMs(attempt: number): number {
    if (this.retryDelayMs && this.retryDelayMs.length > 0) {
      return this.retryDelayMs[Math.min(attempt - 1, this.retryDelayMs.length - 1)] ?? 0;
    }

    const capped = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * 2 ** (attempt - 1));
    if (!Number.isFinite(capped) || capped <= 0) {
      return 0;
    }

    // Full jitter strategy to prevent synchronized retry waves across concurrent requests.
    return Math.floor(this.randomFn() * capped);
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const rawSchema = zodToJsonSchema(request.output_schema as never, {
      target: "jsonSchema7",
      $refStrategy: "none"
    }) as Record<string, unknown>;
    const schema = sanitizeGeminiResponseJsonSchema(rawSchema) as Record<string, unknown>;

    let lastErrorContext: GeminiProviderErrorContext | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.client.models.generateContent({
          model: request.model_name,
          contents: toPromptText(request),
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: schema
          }
        });

        const responseText =
          typeof response.text === "string" ? response.text.trim() : "";

        if (!responseText) {
          throw new AiProviderError("Gemini returned an empty response");
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(responseText);
        } catch (error) {
          throw new AiProviderError("Gemini returned non-JSON output", {
            reason: error instanceof Error ? error.message : "Unknown parse error"
          });
        }

        const outputPayload = asRecord(parsed);
        if (!outputPayload) {
          throw new AiProviderError("Gemini returned unsupported output shape");
        }

        return {
          provider: this.providerName,
          model_name: request.model_name,
          output_payload: outputPayload
        };
      } catch (error) {
        if (error instanceof AiProviderError) {
          throw error;
        }

        const context = toGeminiProviderErrorContext(error);
        lastErrorContext = context;
        const shouldRetry =
          attempt < this.maxAttempts && isRetryableProviderError(context);

        if (!shouldRetry) {
          break;
        }

        const nextDelayMs = Math.max(
          this.computeRetryDelayMs(attempt),
          context.providerRetryDelayMs ?? 0
        );
        if (nextDelayMs > 0) {
          await this.sleepFn(nextDelayMs);
        }
      }
    }

    throw new AiProviderError("Gemini provider request failed", {
      reason: lastErrorContext?.reason ?? "Unknown provider error",
      provider_status: lastErrorContext?.providerStatus ?? null,
      provider_error_name: lastErrorContext?.providerErrorName ?? null,
      provider_status_code: lastErrorContext?.providerStatusCode ?? null,
      provider_quota_id: lastErrorContext?.quotaId ?? null,
      provider_quota_metric: lastErrorContext?.quotaMetric ?? null,
      provider_retry_delay_ms: lastErrorContext?.providerRetryDelayMs ?? null
    });
  }
}
