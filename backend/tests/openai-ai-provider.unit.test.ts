import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../src/shared/errors/app-error";
import {
  cvParseOutputSchema,
  followUpQuestionsOutputSchema
} from "../src/modules/ai/flows/flow-contracts";

const { chatCompletionsCreateMock } = vi.hoisted(() => ({
  chatCompletionsCreateMock: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: chatCompletionsCreateMock
      }
    }
  }))
}));

import { OpenAiAiProvider } from "../src/modules/ai/provider/openai-ai-provider";

const baseRequest = {
  flow_type: "follow_up_questions" as const,
  model_name: "gpt-5.6-luna",
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
  choices: [
    {
      message: { content: JSON.stringify({ questions: [] }), refusal: null },
      finish_reason: "stop"
    }
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
};

describe("OpenAiAiProvider", () => {
  beforeEach(() => {
    chatCompletionsCreateMock.mockReset();
  });

  it("sends system/user messages with json_schema response format and returns parsed payload", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key");
    chatCompletionsCreateMock.mockResolvedValue(successResponse);

    const result = await provider.generate(baseRequest);

    expect(result.provider).toBe("openai");
    expect(result.output_payload).toEqual({ questions: [] });
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(1);

    const call = chatCompletionsCreateMock.mock.calls[0][0];
    expect(call.model).toBe("gpt-5.6-luna");
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toContain("Generate follow-up questions");
    // Constraints stripped from the enforced schema must still reach the model
    expect(call.messages[0].content).toContain("<OUTPUT_JSON_SCHEMA>");
    expect(call.messages[0].content).toContain("maxItems");
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toContain("INPUT_PAYLOAD_JSON");
    expect(call.reasoning_effort).toBe("low");
    expect(call.response_format.type).toBe("json_schema");
    expect(call.response_format.json_schema.schema.properties.questions).toBeDefined();
    expect(JSON.stringify(call.response_format.json_schema.schema)).not.toContain("$schema");
    // follow_up_questions is all-required with closed objects -> strict enforcement
    expect(call.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(call.response_format.json_schema.schema)).not.toContain("maxItems");
    expect(call.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it("routes heavy flows to the heavy model with the heavy output cap", async () => {
    const provider = new OpenAiAiProvider("fallback-model", "openai-key", {
      lightModelName: "gpt-5.6-luna",
      heavyModelName: "gpt-5.6-terra",
      maxOutputTokensLight: 1000,
      maxOutputTokensHeavy: 12000
    });

    expect(provider.resolveModelName("cv_parse")).toBe("gpt-5.6-terra");
    expect(provider.resolveModelName("follow_up_questions")).toBe("gpt-5.6-luna");

    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              parsed_content: { version: "v1", language: "en", metadata: {}, sections: [] },
              warnings: []
            }),
            refusal: null
          },
          finish_reason: "stop"
        }
      ]
    });

    const result = await provider.generate({
      ...baseRequest,
      flow_type: "cv_parse",
      model_name: provider.resolveModelName("cv_parse"),
      output_schema: cvParseOutputSchema
    });

    expect(result.model_name).toBe("gpt-5.6-terra");
    expect(chatCompletionsCreateMock.mock.calls[0][0].max_completion_tokens).toBe(12000);
    // cv_parse uses z.record fields, which strict mode cannot express
    expect(chatCompletionsCreateMock.mock.calls[0][0].response_format.json_schema.strict).toBe(
      false
    );
  });

  it("recovers JSON payload from wrapper text", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key");
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          message: { content: "Here is the result: {\"questions\": [],}", refusal: null },
          finish_reason: "stop"
        }
      ]
    });

    const result = await provider.generate(baseRequest);
    expect(result.output_payload).toEqual({ questions: [] });
  });

  it("retries transient 503 errors and succeeds on a later attempt", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const transientError = new Error("Service unavailable") as Error & { status: number };
    transientError.status = 503;

    chatCompletionsCreateMock
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(successResponse);

    const result = await provider.generate(baseRequest);
    expect(result.output_payload).toEqual({ questions: [] });
    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 400 errors and maps error details", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key", {
      maxAttempts: 3,
      retryDelayMs: [0, 0]
    });

    const apiError = new Error("Invalid request") as Error & { status: number; name: string };
    apiError.status = 400;
    apiError.name = "BadRequestError";
    chatCompletionsCreateMock.mockRejectedValue(apiError);

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe("OpenAI provider request failed");
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({
        provider_status: 400,
        provider_error_name: "BadRequestError",
        reason: "Invalid request"
      })
    );
    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(1);
  });

  it("falls back from heavy to light model on repeated 503", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key", {
      maxAttempts: 1,
      heavyModelName: "gpt-5.6-terra",
      lightModelName: "gpt-5.6-luna"
    });

    const unavailableError = new Error("Service unavailable") as Error & { status: number };
    unavailableError.status = 503;

    chatCompletionsCreateMock
      .mockRejectedValueOnce(unavailableError)
      .mockResolvedValueOnce(successResponse);

    const result = await provider.generate({
      ...baseRequest,
      model_name: "gpt-5.6-terra"
    });

    expect(result.model_name).toBe("gpt-5.6-luna");
    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(2);
    expect(chatCompletionsCreateMock.mock.calls[0][0].model).toBe("gpt-5.6-terra");
    expect(chatCompletionsCreateMock.mock.calls[1][0].model).toBe("gpt-5.6-luna");
  });

  it("surfaces model refusals as non-retryable AiProviderError", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key", { maxAttempts: 3 });
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          message: { content: null, refusal: "I cannot help with this request." },
          finish_reason: "stop"
        }
      ]
    });

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe("OpenAI refused the request");
    expect(chatCompletionsCreateMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast on truncated partial JSON instead of passing it downstream", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key");
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          // Parseable-looking fragment that would fail contract validation later
          message: { content: "{\"topics\": [\"a\", \"b\"]", refusal: null },
          finish_reason: "length"
        }
      ]
    });

    let thrown: unknown;
    try {
      await provider.generate(baseRequest);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderError);
    expect((thrown as AiProviderError).message).toBe(
      "OpenAI output was truncated by the output token limit"
    );
    expect((thrown as AiProviderError).details).toEqual(
      expect.objectContaining({ reason: "output_truncated_by_token_limit" })
    );
  });

  it("classifies truncated empty responses with a token-limit reason", async () => {
    const provider = new OpenAiAiProvider("gpt-5.6-terra", "openai-key");
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [{ message: { content: "", refusal: null }, finish_reason: "length" }]
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
});
