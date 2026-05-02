import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../src/shared/errors/app-error";
import { followUpQuestionsOutputSchema } from "../src/modules/ai/flows/flow-contracts";
import { createAiProvider } from "../src/modules/ai/provider/create-ai-provider";
import type { AppConfig } from "../src/shared/config/env";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn()
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: generateContentMock
    }
  })),
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
    HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
    HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT"
  },
  HarmBlockThreshold: {
    BLOCK_NONE: "BLOCK_NONE"
  }
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

  it("recovers JSON payload from non-JSON wrapper text using one repair pass", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");

    generateContentMock.mockResolvedValue({
      text: "Here is the result: {\"questions\": [],}"
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
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("recovers the first balanced JSON object when response has trailing garbage", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");

    generateContentMock.mockResolvedValue({
      text: "Result => {\"questions\": []} trailing }}} notes"
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
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("prefers schema-matching JSON candidate when multiple JSON objects are present", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");

    generateContentMock.mockResolvedValue({
      text: [
        "Header object:",
        "{\"full_name\":\"Alper Camli\",\"email\":\"test@example.com\"}",
        "Tailored payload:",
        "{\"questions\":[]}"
      ].join("\n")
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
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("classifies unrecoverable JSON output as output_json_unparseable", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");
    generateContentMock.mockResolvedValue({
      text: "This is not JSON at all."
    });

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
    expect((thrown as AiProviderError).message).toBe("Gemini returned non-JSON output");
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({
        reason: "output_json_unparseable"
      })
    );
  });

  it("emits parsing_output stage callback before JSON parsing", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key");
    const onStage = vi.fn();

    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        questions: []
      })
    });

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
      input_payload: {},
      onStage
    });

    expect(onStage).toHaveBeenCalledWith("parsing_output");
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

  it("applies exponential backoff with jitter between retries", async () => {
    const observedDelays: number[] = [];
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 3,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 1_000,
      randomFn: () => 0.5,
      sleepFn: async (ms) => {
        observedDelays.push(ms);
      }
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
    expect(generateContentMock).toHaveBeenCalledTimes(3);
    expect(observedDelays).toEqual([50, 100]);
  });

  it("honors provider retry hints when present", async () => {
    const observedDelays: number[] = [];
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 2,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 1_000,
      randomFn: () => 0.1,
      sleepFn: async (ms) => {
        observedDelays.push(ms);
      }
    });

    const hintedTransientError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: "Service unavailable",
          status: "UNAVAILABLE",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.RetryInfo",
              retryDelay: "2.000s"
            }
          ]
        }
      })
    ) as Error & {
      status: number;
      name: string;
    };
    hintedTransientError.status = 503;
    hintedTransientError.name = "ApiError";

    generateContentMock
      .mockRejectedValueOnce(hintedTransientError)
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
    expect(observedDelays).toEqual([2000]);
  });

  it("does not retry hard quota-exceeded 429 errors", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const quotaError = new Error(
      JSON.stringify({
        error: {
          code: 429,
          message:
            "You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaMetric:
                    "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
                }
              ]
            }
          ]
        }
      })
    ) as Error & {
      status: number;
      name: string;
    };
    quotaError.status = 429;
    quotaError.name = "ApiError";
    generateContentMock.mockRejectedValue(quotaError);

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
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({
        provider_status: 429,
        provider_status_code: "RESOURCE_EXHAUSTED",
        provider_quota_id: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        provider_quota_metric:
          "generativelanguage.googleapis.com/generate_content_free_tier_requests"
      })
    );
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from heavy to light model when heavy returns UNAVAILABLE", async () => {
    const provider = new GeminiAiProvider("gemini-3-flash-preview", "gemini-key", {
      maxAttempts: 1,
      heavyModelName: "gemini-2.5-flash",
      lightModelName: "gemini-3-flash"
    });

    const unavailableError = new Error(
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
    unavailableError.status = 503;
    unavailableError.name = "ApiError";

    generateContentMock
      .mockRejectedValueOnce(unavailableError)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          questions: []
        })
      });

    const result = await provider.generate({
      flow_type: "job_analysis",
      model_name: "gemini-2.5-flash",
      prompt: {
        prompt_key: "job-analysis",
        prompt_version: "phase5-v1",
        system_prompt: "Analyze job fit",
        user_prompt: "Analyze now"
      },
      output_schema: followUpQuestionsOutputSchema,
      input_payload: {}
    });

    expect(result.model_name).toBe("gemini-3-flash");
    expect(result.output_payload).toEqual({ questions: [] });
    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(generateContentMock.mock.calls[0][0].model).toBe("gemini-2.5-flash");
    expect(generateContentMock.mock.calls[1][0].model).toBe("gemini-3-flash");
  });

  it("uses configured max-attempts through createAiProvider", async () => {
    const config: AppConfig = {
      appName: "cv-builder-backend",
      appEnv: "test",
      appVersion: "0.1.0-test",
      port: 4000,
      logLevel: "silent",
      frontendAppUrl: "http://localhost:5173",
      corsAllowedOrigins: [],
      ai: {
        provider: "gemini",
        defaultModel: "gemini-3-flash-preview",
        promptProfile: "phase3-v1",
        geminiApiKey: "gemini-key",
        geminiModelLight: "gemini-3-flash",
        geminiModelHeavy: "gemini-2.5-flash",
        geminiMaxAttempts: 3,
        geminiRetryBaseDelayMs: 1000,
        geminiRetryMaxDelayMs: 16000,
        geminiRequestTimeoutMs: 60000,
        geminiMaxOutputTokensLight: 4096,
        geminiMaxOutputTokensHeavy: 16384,
        runStaleAfterMs: 300000,
        runSweepIntervalMs: 60000
      },
      exports: {
        storageBucket: "exports",
        downloadUrlTtlSeconds: 600
      },
      billing: {
        provider: "stripe",
        stripeSecretKey: null,
        stripeWebhookSecret: null,
        stripeProPriceId: null,
        checkoutSuccessUrl: "http://localhost:5173/app/pricing?checkout=success",
        checkoutCancelUrl: "http://localhost:5173/app/pricing?checkout=cancel",
        portalReturnUrl: "http://localhost:5173/app/pricing"
      },
      supabase: {
        url: "https://example.supabase.co",
        anonKey: "anon",
        serviceRoleKey: "service"
      }
    };

    const provider = createAiProvider(config);

    const transientError = new Error(
      JSON.stringify({
        error: {
          code: 503,
          message: "Service unavailable",
          status: "UNAVAILABLE"
        }
      })
    ) as Error & {
      status: number;
      name: string;
    };
    transientError.status = 503;
    transientError.name = "ApiError";
    generateContentMock.mockRejectedValue(transientError);

    await expect(
      provider.generate({
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
      })
    ).rejects.toBeInstanceOf(AiProviderError);

    expect(generateContentMock).toHaveBeenCalledTimes(3);
  });
});
