import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiProviderError } from "../../../shared/errors/app-error";
import type { AiFlowType } from "../../../shared/types/domain";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";

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

export class GeminiAiProvider implements AiProvider {
  readonly providerName = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    private readonly defaultModelName: string,
    apiKey: string
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  resolveModelName(_flowType: AiFlowType): string {
    return this.defaultModelName;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    const rawSchema = zodToJsonSchema(request.output_schema as never, {
      target: "jsonSchema7",
      $refStrategy: "none"
    }) as Record<string, unknown>;
    const schema = sanitizeGeminiResponseJsonSchema(rawSchema) as Record<string, unknown>;

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

      const providerStatus =
        typeof (error as { status?: unknown })?.status === "number"
          ? ((error as { status: number }).status as number)
          : null;
      const providerErrorName = error instanceof Error ? error.name : null;

      throw new AiProviderError("Gemini provider request failed", {
        reason: error instanceof Error ? error.message : "Unknown provider error",
        provider_status: providerStatus,
        provider_error_name: providerErrorName
      });
    }
  }
}
