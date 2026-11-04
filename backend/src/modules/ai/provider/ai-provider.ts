import { AiProviderError } from "../../../shared/errors/app-error";
import type { AiFlowType } from "../../../shared/types/domain";
import type { ZodTypeAny } from "zod";

export interface AiPromptContext {
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  user_prompt: string;
}

export interface AiProviderRequest {
  flow_type: AiFlowType;
  model_name: string;
  prompt: AiPromptContext;
  output_schema: ZodTypeAny;
  input_payload: Record<string, unknown>;
  // A block orchestrator owns retries: make one model attempt and skip fallback.
  // Other requests retain the configured provider retry/fallback policy.
  single_attempt?: boolean;
  // Report received usage before parsing/refusal checks can fail. This is
  // accounting metadata only; CV/provider payloads are never sent to logs.
  onUsage?: (result: Pick<AiProviderResult, "provider" | "model_name" | "usage">) => Promise<void>;
  onStage?: (stage: "parsing_output") => Promise<void> | void;
  // Who the call is for, copied onto every usage-ledger attempt (ids only, never content).
  usage_context?: AiUsageContext;
}

export interface AiUsageContext {
  ai_run_id?: string | null;
  user_id?: string | null;
  subject?: "user" | "guest";
}

// cached_input_tokens / cache_write_input_tokens are parts of input_tokens and reasoning_tokens is part of
// output_tokens, reported only by providers that expose them.
export interface AiProviderUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  reasoning_tokens?: number;
}

export interface AiProviderResult {
  provider: string;
  model_name: string;
  output_payload: Record<string, unknown>;
  usage?: AiProviderUsage;
}

export interface AiProvider {
  readonly providerName: string;
  resolveModelName(flowType: AiFlowType): string;
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}

export async function reportAiUsage(request: AiProviderRequest, result: Pick<AiProviderResult, "provider" | "model_name" | "usage">) {
  try { await request.onUsage?.(result); }
  catch { throw new AiProviderError("AI usage could not be recorded", { reason: "usage_record_failed" }); }
}
