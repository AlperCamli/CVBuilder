import type { AiFlowType } from "../../../shared/types/domain";

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
  input_payload: Record<string, unknown>;
}

export interface AiProviderResult {
  provider: string;
  model_name: string;
  output_payload: Record<string, unknown>;
}

export interface AiProvider {
  readonly providerName: string;
  resolveModelName(flowType: AiFlowType): string;
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}
