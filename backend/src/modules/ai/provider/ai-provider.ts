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
  // Report received usage before parsing/refusal checks can fail. This is
  // accounting metadata only; CV/provider payloads are never sent to logs.
  onUsage?: (result: Pick<AiProviderResult, "provider" | "model_name" | "usage">) => Promise<void>;
  onStage?: (stage: "parsing_output") => Promise<void> | void;
}

export interface AiProviderResult {
  provider: string;
  model_name: string;
  output_payload: Record<string, unknown>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
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
