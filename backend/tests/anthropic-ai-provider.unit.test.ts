import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../src/shared/errors/app-error";
import {
  cvParseOutputSchema,
  followUpQuestionsOutputSchema
} from "../src/modules/ai/flows/flow-contracts";

const { messagesCreateMock } = vi.hoisted(() => ({
  messagesCreateMock: vi.fn()
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: messagesCreateMock
    }
  }))
}));

import {
  AnthropicAiProvider,
  sanitizeAnthropicResponseJsonSchema
} from "../src/modules/ai/provider/anthropic-ai-provider";

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

const baseRequest = {
  flow_type: "follow_up_questions" as const,
  model_name: "claude-haiku-4-5",
  prompt: {
    prompt_key: "follow-up-questions",
    prompt_version: "phase5-v1",
    system_prompt: "Generate follow-up questions",
    user_prompt: "Generate follow-up questions now"
  },
  output_schema: followUpQuestionsOutputSchema,
  input_payload: {}
};

const successResponse = {
  content: [{ type: "text", text: JSON.stringify({ questions: [] }) }],
  stop_reason: "end_turn",
  usage: { input_tokens: 100, output_tokens: 20 }
};

describe("AnthropicAiProvider", () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
  });

  it("strips unsupported schema constraints and closes objects for structured outputs", () => {
    const rawSchema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 128 },
              question_type: { type: "string", enum: ["short_text", "yes_no"] }
            },
            required: ["id", "question_type"]
          }
        }
      },
      required: ["questions"],
      $schema: "http://json-schema.org/draft-07/schema#"
    };

    const sanitized = sanitizeAnthropicResponseJsonSchema(rawSchema) as Record<string, unknown>;

    expect(hasDeepKey(sanitized, "$schema")).toBe(false);
    expect(hasDeepKey(sanitized, "maxItems")).toBe(false);
    expect(hasDeepKey(sanitized, "minLength")).toBe(false);
    expect(sanitized.additionalProperties).toBe(false);

    const questions = (sanitized.properties as Record<string, unknown>).questions as Record<
      string,
      unknown
    >;
    const questionItem = questions.items as Record<string, unknown>;
    expect(questionItem.additionalProperties).toBe(false);
  });

  it("sends system prompt, user message, and output_config schema, then returns parsed payload", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key");
    messagesCreateMock.mockResolvedValue(successResponse);

    const result = await provider.generate(baseRequest);

    expect(result.provider).toBe("anthropic");
    expect(result.output_payload).toEqual({ questions: [] });
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
    expect(messagesCreateMock).toHaveBeenCalledTimes(1);

    const call = messagesCreateMock.mock.calls[0][0];
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.system).toContain("Generate follow-up questions");
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toContain("INPUT_PAYLOAD_JSON");
    expect(call.output_config.format.type).toBe("json_schema");
    expect(hasDeepKey(call.output_config.format.schema, "minLength")).toBe(false);
    expect(hasDeepKey(call.output_config.format.schema, "$schema")).toBe(false);
  });

  it("routes heavy flows to the heavy model with the heavy output cap", async () => {
    const provider = new AnthropicAiProvider("fallback-model", "anthropic-key", {
      lightModelName: "claude-haiku-4-5",
      heavyModelName: "claude-sonnet-5",
      maxOutputTokensLight: 1000,
      maxOutputTokensHeavy: 12000
    });

    expect(provider.resolveModelName("cv_parse")).toBe("claude-sonnet-5");
    expect(provider.resolveModelName("follow_up_questions")).toBe("claude-haiku-4-5");

    messagesCreateMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            parsed_content: { version: "v1", language: "en", metadata: {}, sections: [] },
            warnings: []
          })
        }
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 }
    });

    const result = await provider.generate({
      ...baseRequest,
      flow_type: "cv_parse",
      model_name: provider.resolveModelName("cv_parse"),
      output_schema: cvParseOutputSchema
    });

    expect(result.model_name).toBe("claude-sonnet-5");
    expect(messagesCreateMock.mock.calls[0][0].max_tokens).toBe(12000);
  });

  it("falls back to prompt-embedded schema when the flow schema has record-style objects", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key");

    messagesCreateMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            parsed_content: { version: "v1", language: "en", metadata: {}, sections: [] },
            warnings: []
          })
        }
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 }
    });

    await provider.generate({
      ...baseRequest,
      flow_type: "cv_parse",
      output_schema: cvParseOutputSchema
    });

    const call = messagesCreateMock.mock.calls[0][0];
    // cv_parse uses z.record fields, which structured outputs cannot express.
    expect(call.output_config).toBeUndefined();
    expect(call.system).toContain("<OUTPUT_JSON_SCHEMA>");
  });

  it("ignores thinking blocks and reads the text block", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key");
    messagesCreateMock.mockResolvedValue({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: JSON.stringify({ questions: [] }) }
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 5 }
    });

    const result = await provider.generate(baseRequest);
    expect(result.output_payload).toEqual({ questions: [] });
  });

  it("surfaces refusal stop_reason as non-retryable AiProviderError", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key", {
      maxAttempts: 3
    });
    messagesCreateMock.mockResolvedValue({
      content: [],
      stop_reason: "refusal",
      usage: { input_tokens: 5, output_tokens: 0 }
    });

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe("Anthropic refused the request");
    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
  });

  it("classifies truncated empty responses with a token-limit reason", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key");
    messagesCreateMock.mockResolvedValue({
      content: [],
      stop_reason: "max_tokens",
      usage: { input_tokens: 5, output_tokens: 5 }
    });

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({ reason: "output_truncated_by_token_limit" })
    );
  });

  it("retries transient 529 overloaded errors and succeeds on a later attempt", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const overloadedError = new Error("Overloaded") as Error & { status: number };
    overloadedError.status = 529;

    messagesCreateMock
      .mockRejectedValueOnce(overloadedError)
      .mockResolvedValueOnce(successResponse);

    const result = await provider.generate(baseRequest);
    expect(result.output_payload).toEqual({ questions: [] });
    expect(messagesCreateMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 400 errors and maps error details", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const apiError = new Error("invalid_request_error") as Error & {
      status: number;
      name: string;
    };
    apiError.status = 400;
    apiError.name = "BadRequestError";
    messagesCreateMock.mockRejectedValue(apiError);

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe("Anthropic provider request failed");
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({
        provider_status: 400,
        provider_error_name: "BadRequestError"
      })
    );
    expect(messagesCreateMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from heavy to light model on repeated 529", async () => {
    const provider = new AnthropicAiProvider("claude-sonnet-5", "anthropic-key", {
      maxAttempts: 1,
      heavyModelName: "claude-sonnet-5",
      lightModelName: "claude-haiku-4-5"
    });

    const overloadedError = new Error("Overloaded") as Error & { status: number };
    overloadedError.status = 529;

    messagesCreateMock
      .mockRejectedValueOnce(overloadedError)
      .mockResolvedValueOnce(successResponse);

    const result = await provider.generate({
      ...baseRequest,
      model_name: "claude-sonnet-5"
    });

    expect(result.model_name).toBe("claude-haiku-4-5");
    expect(messagesCreateMock).toHaveBeenCalledTimes(2);
    expect(messagesCreateMock.mock.calls[0][0].model).toBe("claude-sonnet-5");
    expect(messagesCreateMock.mock.calls[1][0].model).toBe("claude-haiku-4-5");
  });
});
