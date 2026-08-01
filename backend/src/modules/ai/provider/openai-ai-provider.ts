import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiProviderError } from "../../../shared/errors/app-error";
import type { AiFlowType } from "../../../shared/types/domain";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";
import {
  HEAVY_MODEL_FLOW_TYPES,
  LARGE_OUTPUT_FLOW_TYPES,
  asRecord,
  buildSystemMessageText,
  buildUserMessageText,
  clampNonNegativeInteger,
  parseOutputWithSchemaPreference,
  sleep,
  stripJsonSchemaKeys,
  toDebugExcerpt
} from "./provider-shared";

const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MODEL_FALLBACK_HTTP_STATUS_CODES = new Set([500, 503]);
const MAX_PROVIDER_RETRY_HINT_DELAY_MS = 120_000;

// OpenAI json_schema response format rejects the draft-07 marker; other
// constraints are tolerated in non-strict mode, so only "$schema" is dropped.
const OPENAI_SCHEMA_DROPPED_KEYS = new Set(["$schema"]);

export const sanitizeOpenAiResponseJsonSchema = (value: unknown): unknown => {
  return stripJsonSchemaKeys(value, OPENAI_SCHEMA_DROPPED_KEYS);
};

interface OpenAiProviderErrorContext {
  providerStatus: number | null;
  providerErrorName: string | null;
  providerRetryDelayMs: number | null;
  reason: string;
}

const parseRetryAfterMs = (error: unknown): number | null => {
  const headers = (error as { headers?: unknown })?.headers;
  let retryAfter: string | null = null;

  if (headers && typeof (headers as Headers).get === "function") {
    retryAfter = (headers as Headers).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const value = (headers as Record<string, unknown>)["retry-after"];
    retryAfter = typeof value === "string" ? value : null;
  }

  if (!retryAfter) {
    return null;
  }

  const seconds = Number.parseFloat(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(Math.floor(seconds * 1000), MAX_PROVIDER_RETRY_HINT_DELAY_MS);
};

const toOpenAiProviderErrorContext = (error: unknown): OpenAiProviderErrorContext => {
  const providerStatus =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status as number)
      : null;

  return {
    providerStatus,
    providerErrorName: error instanceof Error ? error.name : null,
    providerRetryDelayMs: parseRetryAfterMs(error),
    reason: error instanceof Error ? error.message : "Unknown provider error"
  };
};

const isRetryableProviderError = (context: OpenAiProviderErrorContext): boolean => {
  if (context.providerStatus === null) {
    // Connection/timeout failures surface without a status; treat as transient.
    return true;
  }

  return RETRYABLE_HTTP_STATUS_CODES.has(context.providerStatus);
};

const isModelFallbackEligible = (context: OpenAiProviderErrorContext): boolean => {
  return (
    typeof context.providerStatus === "number" &&
    MODEL_FALLBACK_HTTP_STATUS_CODES.has(context.providerStatus)
  );
};

export class OpenAiAiProvider implements AiProvider {
  readonly providerName = "openai";
  private readonly client: OpenAI;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number[] | null;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly lightModelName: string | null;
  private readonly heavyModelName: string | null;
  private readonly maxOutputTokensLight: number;
  private readonly maxOutputTokensHeavy: number;
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
      lightModelName?: string;
      heavyModelName?: string;
      requestTimeoutMs?: number;
      maxOutputTokensLight?: number;
      maxOutputTokensHeavy?: number;
      randomFn?: () => number;
      sleepFn?: (ms: number) => Promise<void>;
    }
  ) {
    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: clampNonNegativeInteger(options?.requestTimeoutMs ?? 60_000, 60_000)
    });
    this.maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
    this.retryDelayMs = options?.retryDelayMs?.map((value) =>
      clampNonNegativeInteger(value, 0)
    ) ?? null;
    this.baseRetryDelayMs = clampNonNegativeInteger(options?.baseRetryDelayMs ?? 500, 500);
    this.maxRetryDelayMs = clampNonNegativeInteger(options?.maxRetryDelayMs ?? 8_000, 8_000);
    this.lightModelName = options?.lightModelName?.trim() || null;
    this.heavyModelName = options?.heavyModelName?.trim() || null;
    this.maxOutputTokensLight = clampNonNegativeInteger(options?.maxOutputTokensLight ?? 4_096, 4_096);
    this.maxOutputTokensHeavy = clampNonNegativeInteger(options?.maxOutputTokensHeavy ?? 16_384, 16_384);
    this.randomFn = options?.randomFn ?? Math.random;
    this.sleepFn = options?.sleepFn ?? sleep;
  }

  private resolveMaxOutputTokens(flowType: AiFlowType): number {
    return LARGE_OUTPUT_FLOW_TYPES.has(flowType)
      ? this.maxOutputTokensHeavy
      : this.maxOutputTokensLight;
  }

  resolveModelName(flowType: AiFlowType): string {
    if (HEAVY_MODEL_FLOW_TYPES.has(flowType)) {
      return this.heavyModelName ?? this.defaultModelName;
    }

    return this.lightModelName ?? this.defaultModelName;
  }

  private resolveModelCandidates(modelName: string): string[] {
    const unique = new Set<string>();
    unique.add(modelName);

    if (
      this.heavyModelName &&
      this.lightModelName &&
      modelName === this.heavyModelName &&
      this.lightModelName !== this.heavyModelName
    ) {
      unique.add(this.lightModelName);
    }

    return [...unique];
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
    const schema = sanitizeOpenAiResponseJsonSchema(rawSchema) as Record<string, unknown>;

    let lastErrorContext: OpenAiProviderErrorContext | null = null;
    let lastAttemptedModel = request.model_name;
    const attemptedModels: string[] = [];
    const modelCandidates = this.resolveModelCandidates(request.model_name);

    for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
      const candidateModel = modelCandidates[modelIndex] ?? request.model_name;
      attemptedModels.push(candidateModel);

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const response = await this.client.chat.completions.create({
            model: candidateModel,
            messages: [
              { role: "system", content: buildSystemMessageText(request) },
              { role: "user", content: buildUserMessageText(request) }
            ],
            max_completion_tokens: this.resolveMaxOutputTokens(request.flow_type),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "flow_output",
                schema,
                strict: false
              }
            }
          });

          const choice = response.choices[0];
          const refusal = choice?.message?.refusal;
          if (typeof refusal === "string" && refusal.trim()) {
            throw new AiProviderError("OpenAI refused the request", {
              reason: "provider_refusal",
              raw_output_excerpt: toDebugExcerpt(refusal),
              attempted_models: attemptedModels
            });
          }

          const responseText =
            typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";

          if (!responseText) {
            throw new AiProviderError("OpenAI returned an empty response", {
              reason:
                choice?.finish_reason === "length"
                  ? "output_truncated_by_token_limit"
                  : "empty_response",
              raw_output_excerpt: "",
              attempted_models: attemptedModels
            });
          }

          await request.onStage?.("parsing_output");

          const parsedResult = parseOutputWithSchemaPreference(responseText, request.output_schema);
          if (parsedResult.parsed === null) {
            throw new AiProviderError("OpenAI returned non-JSON output", {
              reason: "output_json_unparseable",
              parse_error: parsedResult.parse_error,
              recovery_attempted: true,
              raw_output_excerpt: toDebugExcerpt(responseText),
              attempted_models: attemptedModels
            });
          }

          const outputPayload = asRecord(parsedResult.parsed);
          if (!outputPayload) {
            throw new AiProviderError("OpenAI returned unsupported output shape", {
              raw_output_excerpt: toDebugExcerpt(responseText),
              attempted_models: attemptedModels
            });
          }

          return {
            provider: this.providerName,
            model_name: candidateModel,
            output_payload: outputPayload,
            usage: response.usage
              ? {
                  input_tokens: response.usage.prompt_tokens ?? 0,
                  output_tokens: response.usage.completion_tokens ?? 0,
                  total_tokens: response.usage.total_tokens ?? 0
                }
              : undefined
          };
        } catch (error) {
          if (error instanceof AiProviderError) {
            throw error;
          }

          const context = toOpenAiProviderErrorContext(error);
          lastErrorContext = context;
          lastAttemptedModel = candidateModel;
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

      const canFallbackToNextModel =
        modelIndex < modelCandidates.length - 1 &&
        lastErrorContext !== null &&
        isModelFallbackEligible(lastErrorContext);
      if (!canFallbackToNextModel) {
        break;
      }
    }

    throw new AiProviderError("OpenAI provider request failed", {
      reason: lastErrorContext?.reason ?? "Unknown provider error",
      model_name: lastAttemptedModel,
      attempted_models: attemptedModels,
      provider_status: lastErrorContext?.providerStatus ?? null,
      provider_error_name: lastErrorContext?.providerErrorName ?? null,
      provider_retry_delay_ms: lastErrorContext?.providerRetryDelayMs ?? null
    });
  }
}
