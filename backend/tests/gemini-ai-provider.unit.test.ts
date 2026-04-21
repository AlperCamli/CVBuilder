import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../src/shared/errors/app-error";
import { followUpQuestionsOutputSchema } from "../src/modules/ai/flows/flow-contracts";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn()
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: generateContentMock
    }
  }))
}));

import {
  GeminiAiProvider,
  sanitizeGeminiResponseJsonSchema
} from "../src/modules/ai/provider/gemini-ai-provider";

const hasDeepKey = (value: unknown, key: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => hasDeepKey(item, key));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return true;
    }

    return Object.values(record).some((item) => hasDeepKey(item, key));
  }

  return false;
};

describe("GeminiAiProvider", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("sanitizes high-complexity JSON schema constraints while preserving structure", () => {
    const rawSchema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                minLength: 1,
                maxLength: 128
              },
              question_type: {
                type: "string",
                enum: ["single_choice", "multi_select", "text"]
              },
              target_hint: {
                anyOf: [
                  {
                    type: "string",
                    maxLength: 160
                  },
                  {
                    type: "null"
                  }
                ]
              }
            },
            required: ["id", "question_type"],
            additionalProperties: false
          }
        }
      },
      required: ["questions"],
      additionalProperties: false,
      $schema: "http://json-schema.org/draft-07/schema#"
    };

    const sanitized = sanitizeGeminiResponseJsonSchema(rawSchema) as Record<string, unknown>;

    expect(hasDeepKey(sanitized, "$schema")).toBe(false);
    expect(hasDeepKey(sanitized, "maxItems")).toBe(false);
    expect(hasDeepKey(sanitized, "maxLength")).toBe(false);
    expect(hasDeepKey(sanitized, "minLength")).toBe(false);

    const questions = (
      sanitized.properties as Record<string, unknown>
    ).questions as Record<string, unknown>;
    const questionItem = questions.items as Record<string, unknown>;
    const questionType = (
      (questionItem.properties as Record<string, unknown>).question_type as Record<string, unknown>
    ).enum;
    const targetHintAnyOf = (
      (questionItem.properties as Record<string, unknown>).target_hint as Record<string, unknown>
    ).anyOf;

    expect(questionType).toEqual(["single_choice", "multi_select", "text"]);
    expect(Array.isArray(targetHintAnyOf)).toBe(true);
    expect(questionItem.additionalProperties).toBe(false);
  });

  it("uses sanitized schema in Gemini request and returns parsed JSON payload", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");

    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        questions: []
      })
    });

    const result = await provider.generate({
      flow_type: "follow_up_questions",
      model_name: "gemini-3-flash-preview",
      prompt: {
        prompt_key: "follow-up-questions",
        prompt_version: "phase5-v1",
        system_prompt: "Generate follow-up questions",
        user_prompt: "Generate follow-up questions now"
      },
      output_schema: followUpQuestionsOutputSchema,
      input_payload: {
        company_name: "Acme",
        job_title: "Engineer",
        job_description: "Build systems"
      }
    });

    expect(result.output_payload).toEqual({ questions: [] });
    expect(generateContentMock).toHaveBeenCalledTimes(1);

    const requestSchema = generateContentMock.mock.calls[0][0].config
      .responseJsonSchema as Record<string, unknown>;
    expect(hasDeepKey(requestSchema, "maxItems")).toBe(false);
    expect(hasDeepKey(requestSchema, "maxLength")).toBe(false);
    expect(hasDeepKey(requestSchema, "minLength")).toBe(false);
    expect(
      (((requestSchema.properties as Record<string, unknown>).questions as Record<string, unknown>).items as Record<
        string,
        unknown
      >).additionalProperties
    ).toBe(false);
  });

  it("maps provider status and reason into AiProviderError details", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const apiError = new Error("Request contains an invalid argument.") as Error & {
      status: number;
      name: string;
    };
    apiError.status = 400;
    apiError.name = "ApiError";
    generateContentMock.mockRejectedValue(apiError);

    let thrown: unknown;
    try {
      await provider.generate({
        flow_type: "follow_up_questions",
        model_name: "gemini-3-flash-preview",
        prompt: {
          prompt_key: "follow-up-questions",
          prompt_version: "phase5-v1",
          system_prompt: "Generate follow-up questions",
          user_prompt: "Generate follow-up questions now"
        },
        output_schema: followUpQuestionsOutputSchema,
        input_payload: {}
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe("Gemini provider request failed");
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({
        provider_status: 400,
        provider_error_name: "ApiError",
        reason: "Request contains an invalid argument."
      })
    );
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient provider failures and succeeds when a later attempt works", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const transientError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: "This model is currently experiencing high demand.",
          status: "UNAVAILABLE"
        }
      })
    ) as Error & {
      status: number;
      name: string;
    };
    transientError.status = 503;
    transientError.name = "ApiError";

    generateContentMock
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          questions: []
        })
      });

    const result = await provider.generate({
      flow_type: "follow_up_questions",
      model_name: "gemini-3-flash-preview",
      prompt: {
        prompt_key: "follow-up-questions",
        prompt_version: "phase5-v1",
        system_prompt: "Generate follow-up questions",
        user_prompt: "Generate follow-up questions now"
      },
      output_schema: followUpQuestionsOutputSchema,
      input_payload: {}
    });

    expect(result.output_payload).toEqual({ questions: [] });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
