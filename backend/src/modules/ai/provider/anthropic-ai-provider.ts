import Anthropic from "@anthropic-ai/sdk";
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

// 529 is Anthropic's overloaded_error.
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 529]);
const MODEL_FALLBACK_HTTP_STATUS_CODES = new Set([500, 503, 529]);
const MAX_PROVIDER_RETRY_HINT_DELAY_MS = 120_000;

// Anthropic structured outputs reject numeric/string/array constraints; objects
// must carry additionalProperties: false.
const ANTHROPIC_SCHEMA_DROPPED_KEYS = new Set([
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

const enforceClosedObjects = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => enforceClosedObjects(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = enforceClosedObjects(item);
    }

    if (result.type === "object" || result.properties) {
      result.additionalProperties = false;
    }

    return result;
  }

  return value;
};

export const sanitizeAnthropicResponseJsonSchema = (value: unknown): unknown => {
  return enforceClosedObjects(stripJsonSchemaKeys(value, ANTHROPIC_SCHEMA_DROPPED_KEYS));
};

// Record-style objects (z.record → object-valued additionalProperties) cannot be
// expressed under Anthropic structured outputs, which require every object to be
// closed. Flows with such schemas fall back to prompt-embedded schema + recovery.
export const schemaHasOpenObjects = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => schemaHasOpenObjects(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const additionalProperties = record.additionalProperties;
    if (
      additionalProperties === true ||
      (typeof additionalProperties === "object" && additionalProperties !== null)
    ) {
      return true;
    }
    if (record.patternProperties) {
      return true;
    }

    return Object.values(record).some((item) => schemaHasOpenObjects(item));
  }

  return false;
};

interface AnthropicProviderErrorContext {
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

const toAnthropicProviderErrorContext = (error: unknown): AnthropicProviderErrorContext => {
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

const isRetryableProviderError = (context: AnthropicProviderErrorContext): boolean => {
  if (context.providerStatus === null) {
    // Connection/timeout failures surface without a status; treat as transient.
    return true;
  }

  return RETRYABLE_HTTP_STATUS_CODES.has(context.providerStatus);
};

const isModelFallbackEligible = (context: AnthropicProviderErrorContext): boolean => {
  return (
    typeof context.providerStatus === "number" &&
    MODEL_FALLBACK_HTTP_STATUS_CODES.has(context.providerStatus)
  );
};

export class AnthropicAiProvider implements AiProvider {
  readonly providerName = "anthropic";
  private readonly client: Anthropic;
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
    this.client = new Anthropic({
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
    const useStructuredOutput = !schemaHasOpenObjects(rawSchema);
    const schema = useStructuredOutput
      ? (sanitizeAnthropicResponseJsonSchema(rawSchema) as Record<string, unknown>)
      : null;
    const promptSchema = stripJsonSchemaKeys(rawSchema, new Set(["$schema"]));
    const systemText = useStructuredOutput
      ? buildSystemMessageText(request)
      : [
          buildSystemMessageText(request),
          "<OUTPUT_JSON_SCHEMA>",
          JSON.stringify(promptSchema),
          "</OUTPUT_JSON_SCHEMA>"
        ].join("\n\n");

    let lastErrorContext: AnthropicProviderErrorContext | null = null;
    let lastAttemptedModel = request.model_name;
    const attemptedModels: string[] = [];
    const modelCandidates = this.resolveModelCandidates(request.model_name);

    for (let modelIndex = 0; modelIndex < modelCandidates.length; modelIndex += 1) {
      const candidateModel = modelCandidates[modelIndex] ?? request.model_name;
      attemptedModels.push(candidateModel);

      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const response = await this.client.messages.create({
            model: candidateModel,
            max_tokens: this.resolveMaxOutputTokens(request.flow_type),
            system: systemText,
            messages: [{ role: "user", content: buildUserMessageText(request) }],
            ...(schema
              ? {
                  output_config: {
                    format: {
                      type: "json_schema" as const,
                      schema
                    }
                  }
                }
              : {})
          });

          if (response.stop_reason === "refusal") {
            throw new AiProviderError("Anthropic refused the request", {
              reason: "provider_refusal",
              attempted_models: attemptedModels
            });
          }

          const responseText = response.content
            .filter(
              (block): block is Extract<typeof block, { type: "text" }> => block.type === "text"
            )
            .map((block) => block.text)
            .join("")
            .trim();

          if (!responseText) {
            throw new AiProviderError("Anthropic returned an empty response", {
              reason:
                response.stop_reason === "max_tokens"
                  ? "output_truncated_by_token_limit"
                  : "empty_response",
              raw_output_excerpt: "",
              attempted_models: attemptedModels
            });
          }

          await request.onStage?.("parsing_output");

          const parsedResult = parseOutputWithSchemaPreference(responseText, request.output_schema);
          if (parsedResult.parsed === null) {
            throw new AiProviderError("Anthropic returned non-JSON output", {
              reason: "output_json_unparseable",
              parse_error: parsedResult.parse_error,
              recovery_attempted: true,
              raw_output_excerpt: toDebugExcerpt(responseText),
              attempted_models: attemptedModels
            });
          }

          const outputPayload = asRecord(parsedResult.parsed);
          if (!outputPayload) {
            throw new AiProviderError("Anthropic returned unsupported output shape", {
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
                  input_tokens: response.usage.input_tokens ?? 0,
                  output_tokens: response.usage.output_tokens ?? 0,
                  total_tokens:
                    (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0)
                }
              : undefined
          };
        } catch (error) {
          if (error instanceof AiProviderError) {
            throw error;
          }

          const context = toAnthropicProviderErrorContext(error);
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

    throw new AiProviderError("Anthropic provider request failed", {
      reason: lastErrorContext?.reason ?? "Unknown provider error",
      model_name: lastAttemptedModel,
      attempted_models: attemptedModels,
      provider_status: lastErrorContext?.providerStatus ?? null,
      provider_error_name: lastErrorContext?.providerErrorName ?? null,
      provider_retry_delay_ms: lastErrorContext?.providerRetryDelayMs ?? null
    });
  }
}
