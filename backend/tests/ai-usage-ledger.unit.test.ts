import { beforeEach, describe, expect, it, vi } from "vitest";
import { followUpQuestionsOutputSchema } from "../src/modules/ai/flows/flow-contracts";
import { computeRunCostUsd, unpricedModels } from "../src/modules/ai/ai-cost";

const { chatCompletionsCreateMock, generateContentMock, messagesCreateMock } = vi.hoisted(() => ({
  chatCompletionsCreateMock: vi.fn(),
  generateContentMock: vi.fn(),
  messagesCreateMock: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: chatCompletionsCreateMock } } }))
}));
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent: generateContentMock } }))
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: messagesCreateMock } }))
}));

import { OpenAiAiProvider } from "../src/modules/ai/provider/openai-ai-provider";
import { GeminiAiProvider } from "../src/modules/ai/provider/gemini-ai-provider";
import { AnthropicAiProvider } from "../src/modules/ai/provider/anthropic-ai-provider";
import { createAiProvider } from "../src/modules/ai/provider/create-ai-provider";
import { SupabaseAiUsageSink, toUsageEventRow, type AiUsageEvent, type AiUsageSink } from "../src/modules/ai/provider/ai-usage-ledger";
import { createTestConfig } from "./helpers/in-memory";

const request = {
  flow_type: "follow_up_questions" as const,
  model_name: "gpt-6-luna",
  prompt: { prompt_key: "follow-up-questions", prompt_version: "v1", system_prompt: "Generate", user_prompt: "Generate now" },
  output_schema: followUpQuestionsOutputSchema,
  input_payload: {},
  usage_context: { ai_run_id: "run-1", user_id: "user-1", subject: "user" as const }
};

const ok = (overrides: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  _request_id: "req_1",
  model: "gpt-6-luna-2026-09-01",
  choices: [{ message: { content: JSON.stringify({ questions: [] }), refusal: null }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
    prompt_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
    completion_tokens_details: { reasoning_tokens: 50 }
  },
  ...overrides
});

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, requestID: `req_${status}` });
const timeoutError = () => Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" });

const recordingSink = () => {
  const events: AiUsageEvent[] = [];
  const sink: AiUsageSink = { record: vi.fn(async (event: AiUsageEvent) => { events.push(event); }) };
  return { sink, events };
};

const openAi = (sink: AiUsageSink, options: Record<string, unknown> = {}) =>
  new OpenAiAiProvider("gpt-6-luna", "key", { maxAttempts: 3, retryDelayMs: [0, 0], usageSink: sink, ...options });

const summary = (events: AiUsageEvent[]) =>
  events.map((e) => [e.attempt_no, e.model_requested, e.outcome, e.http_status, e.is_fallback].join(" "));

describe("AI usage ledger: one event per provider attempt", () => {
  beforeEach(() => {
    chatCompletionsCreateMock.mockReset();
    generateContentMock.mockReset();
    messagesCreateMock.mockReset();
  });

  it("records a successful attempt with usage, the reported model, the request id and the run context", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockResolvedValue(ok());
    await openAi(sink).generate(request);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "openai", flow_type: "follow_up_questions", model_requested: "gpt-6-luna", model_reported: "gpt-6-luna-2026-09-01",
      attempt_no: 1, is_fallback: false, outcome: "success", http_status: 200, provider_request_id: "req_1",
      usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200, cached_input_tokens: 400, cache_write_input_tokens: 100, reasoning_tokens: 50 },
      context: { ai_run_id: "run-1", user_id: "user-1", subject: "user" }
    });
    expect(events[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("records 429 then 200 as two attempts of the same call", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockRejectedValueOnce(httpError(429)).mockResolvedValueOnce(ok());
    await openAi(sink).generate(request);
    expect(summary(events)).toEqual(["1 gpt-6-luna http_error 429 false", "2 gpt-6-luna success 200 false"]);
    expect(events[0]).toMatchObject({ usage: null, provider_request_id: "req_429" });
    expect(new Set(events.map((e) => e.call_id)).size).toBe(1);
  });

  it("records timeout, timeout, 200 as three attempts", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockRejectedValueOnce(timeoutError()).mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(ok());
    await openAi(sink).generate(request);
    expect(summary(events)).toEqual(["1 gpt-6-luna timeout  false", "2 gpt-6-luna timeout  false", "3 gpt-6-luna success 200 false"]);
  });

  it("records a heavy-model 500 and the light-model fallback", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(ok({ model: "gpt-6-mini" }));
    const provider = openAi(sink, { maxAttempts: 1, heavyModelName: "gpt-6-luna", lightModelName: "gpt-6-mini" });
    await provider.generate(request);
    expect(summary(events)).toEqual(["1 gpt-6-luna http_error 500 false", "2 gpt-6-mini success 200 true"]);
  });

  it("records refusals and truncation with their billed usage, and connection errors without", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: null, refusal: "No." }, finish_reason: "stop" }] }));
    await expect(openAi(sink).generate(request)).rejects.toThrow("OpenAI refused the request");
    chatCompletionsCreateMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: "{\"questions\": [", refusal: null }, finish_reason: "length" }] }));
    await expect(openAi(sink).generate(request)).rejects.toThrow("truncated");
    chatCompletionsCreateMock.mockRejectedValueOnce(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" }));
    await expect(openAi(sink, { maxAttempts: 1 }).generate(request)).rejects.toThrow("OpenAI provider request failed");
    expect(events.map((e) => [e.outcome, e.usage?.input_tokens ?? null])).toEqual([["refusal", 1000], ["truncated", 1000], ["network_error", null]]);
  });

  it("records an attempt whose run usage could not be stored", async () => {
    const { sink, events } = recordingSink();
    chatCompletionsCreateMock.mockResolvedValue(ok());
    await expect(openAi(sink).generate({ ...request, onUsage: async () => { throw new Error("privacy_subject_unavailable"); } }))
      .rejects.toThrow("AI usage could not be recorded");
    expect(events.map((e) => e.outcome)).toEqual(["usage_not_recorded"]);
  });

  it("never lets a failing or hanging sink break the AI call", async () => {
    vi.useFakeTimers();
    try {
      chatCompletionsCreateMock.mockResolvedValue(ok());
      const throwing: AiUsageSink = { record: () => { throw new Error("sink down"); } };
      const rejecting: AiUsageSink = { record: async () => { throw new Error("sink down"); } };
      const hanging: AiUsageSink = { record: () => new Promise<void>(() => {}) };
      await expect(openAi(throwing).generate(request)).resolves.toMatchObject({ output_payload: { questions: [] } });
      await expect(openAi(rejecting).generate(request)).resolves.toMatchObject({ output_payload: { questions: [] } });
      const pending = openAi(hanging).generate(request);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toMatchObject({ output_payload: { questions: [] } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records Gemini attempts, counting thinking tokens as billed output", async () => {
    const { sink, events } = recordingSink();
    generateContentMock
      .mockRejectedValueOnce(Object.assign(new Error("{\"error\":{\"status\":\"UNAVAILABLE\"}}"), { status: 503 }))
      .mockResolvedValueOnce({
        responseId: "gem-1", modelVersion: "gemini-3.1-flash-lite", text: JSON.stringify({ questions: [] }),
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 100, thoughtsTokenCount: 300, cachedContentTokenCount: 200, totalTokenCount: 1300 }
      });
    const provider = new GeminiAiProvider("gemini-3.1-flash-lite", "key", { maxAttempts: 2, retryDelayMs: [0], usageSink: sink });
    const result = await provider.generate({ ...request, model_name: "gemini-3.1-flash-lite" });
    expect(result.usage).toEqual({ input_tokens: 900, output_tokens: 400, total_tokens: 1300, cached_input_tokens: 200, reasoning_tokens: 300 });
    expect(summary(events)).toEqual(["1 gemini-3.1-flash-lite http_error 503 false", "2 gemini-3.1-flash-lite success 200 false"]);
    expect(events[1].provider_request_id).toBe("gem-1");
  });

  it("records Anthropic attempts, with prompt-cache reads and writes as parts of the input", async () => {
    const { sink, events } = recordingSink();
    messagesCreateMock.mockResolvedValue({
      id: "msg_1", model: "claude-haiku-4-5", stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ questions: [] }) }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 50 }
    });
    const provider = new AnthropicAiProvider("claude-haiku-4-5", "key", { maxAttempts: 1, usageSink: sink });
    await provider.generate({ ...request, model_name: "claude-haiku-4-5" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "success", provider_request_id: "msg_1",
      usage: { input_tokens: 450, output_tokens: 20, total_tokens: 470, cached_input_tokens: 300, cache_write_input_tokens: 50 }
    });
  });
});

describe("AI usage ledger rows", () => {
  it("prices the attempt with the reported model and keeps tokens null without usage", () => {
    const pricing = { "gpt-6-luna": { input: 0.1, cached_input: 0.01, cache_write: 0.125, output: 0.5 } };
    const base: AiUsageEvent = {
      call_id: "call", provider: "openai", flow_type: "cv_parse", model_requested: "gpt-6-luna", model_reported: "gpt-6-luna-2026-09-01",
      attempt_no: 1, is_fallback: false, outcome: "success", http_status: 200, provider_request_id: "req", started_at: new Date("2026-11-05T10:00:00Z"),
      latency_ms: 1234.4, usage: { input_tokens: 1_000_000, cached_input_tokens: 200_000, cache_write_input_tokens: 100_000, output_tokens: 100_000, total_tokens: 1_100_000 },
      context: { ai_run_id: "run", user_id: null, subject: "guest" }
    };
    expect(toUsageEventRow(base, { source: "script", environment: "development", pricing })).toEqual({
      occurred_at: "2026-11-05T10:00:00.000Z", source: "script", environment: "development", call_id: "call", provider: "openai", flow_type: "cv_parse",
      model_requested: "gpt-6-luna", model_reported: "gpt-6-luna-2026-09-01", attempt_no: 1, is_fallback: false, outcome: "success", http_status: 200,
      provider_request_id: "req", input_tokens: 1_000_000, cached_input_tokens: 200_000, cache_write_input_tokens: 100_000, output_tokens: 100_000,
      reasoning_tokens: null, cost_usd: 0.1345, latency_ms: 1234, ai_run_id: "run", user_id: null, subject: "guest"
    });
    expect(toUsageEventRow({ ...base, usage: null, outcome: "timeout", http_status: null }, { source: "app", environment: "production", pricing }))
      .toMatchObject({ input_tokens: null, cached_input_tokens: null, output_tokens: null, cost_usd: null });
  });

  it("logs a failed insert as a warning instead of throwing", async () => {
    const warn = vi.fn();
    const db = { from: () => ({ insert: async () => ({ error: { message: "permission denied" } }) }) } as never;
    const sink = new SupabaseAiUsageSink(db, { source: "app", environment: "production", pricing: {}, logger: { warn } });
    await sink.record({ call_id: "c", provider: "openai", flow_type: "cv_parse", model_requested: "m", model_reported: null, attempt_no: 1,
      is_fallback: false, outcome: "timeout", http_status: null, provider_request_id: null, usage: null, started_at: new Date(), latency_ms: 1 });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: "AI_USAGE_EVENT_NOT_RECORDED", reason: "permission denied" }), expect.any(String));
  });
});

describe("Model pricing", () => {
  it("bills prompt-cache writes at the cache-write rate and defaults them to the input rate", () => {
    const usage = { input_tokens: 1_000_000, cached_input_tokens: 200_000, cache_write_input_tokens: 100_000, output_tokens: 100_000, total_tokens: 1_100_000 };
    // (700k * 0.1 + 200k * 0.01 + 100k * 0.125 + 100k * 0.5) / 1M
    expect(computeRunCostUsd({ m: { input: 0.1, cached_input: 0.01, cache_write: 0.125, output: 0.5 } }, "m", usage)).toBe(0.1345);
    // Without a cache-write price the written tokens cost the input rate: (800k * 0.1 + 200k * 0.01 + 100k * 0.5) / 1M
    expect(computeRunCostUsd({ m: { input: 0.1, cached_input: 0.01, output: 0.5 } }, "m", usage)).toBe(0.132);
  });

  it("lists configured models no price prefixes", () => {
    expect(unpricedModels({ "gpt-6-luna": { input: 0.1, output: 0.5 } }, ["gpt-6-luna-2026-09-01", "gpt-5.6-terra", "gpt-5.6-terra", ""])).toEqual(["gpt-5.6-terra"]);
  });

  it("warns at startup when the active provider's light or heavy model has no price", () => {
    const base = createTestConfig();
    const config = { ...base, ai: { ...base.ai, provider: "openai" as const, openaiApiKey: "key", openaiModelLight: "gpt-6-luna", openaiModelHeavy: "gpt-5.6-terra",
      modelPricing: { "gpt-6-luna": { input: 0.1, output: 0.5 } } } };
    const warn = vi.fn();
    createAiProvider(config, { logger: { warn } });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AI_MODEL_PRICE_MISSING", provider: "openai", models: ["gpt-5.6-terra"] }),
      expect.any(String)
    );
    const pricedWarn = vi.fn();
    createAiProvider({ ...config, ai: { ...config.ai, modelPricing: { "gpt-": { input: 1, output: 1 } } } }, { logger: { warn: pricedWarn } });
    expect(pricedWarn).not.toHaveBeenCalled();
  });
});
