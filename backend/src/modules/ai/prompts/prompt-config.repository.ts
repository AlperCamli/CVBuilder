import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../../shared/errors/app-error";
import type { AiFlowType, AiSuggestionActionType } from "../../../shared/types/domain";

export interface AiPromptConfigRecord {
  id: string;
  profile: string;
  flow_type: AiFlowType;
  action_type: AiSuggestionActionType | null;
  provider: string;
  model_name: string | null;
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  user_prompt_template: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AiPromptConfigRepository {
  listActiveByProfile(profile: string): Promise<AiPromptConfigRecord[]>;
}

const toAiPromptConfigRecord = (row: Record<string, unknown>): AiPromptConfigRecord => {
  return {
    id: String(row.id),
    profile: String(row.profile),
    flow_type: row.flow_type as AiFlowType,
    action_type: (row.action_type as AiSuggestionActionType | null) ?? null,
    provider: String(row.provider),
    model_name: (row.model_name as string | null) ?? null,
    prompt_key: String(row.prompt_key),
    prompt_version: String(row.prompt_version),
    system_prompt: String(row.system_prompt),
    user_prompt_template: (row.user_prompt_template as string | null) ?? null,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
};

export class SupabaseAiPromptConfigRepository implements AiPromptConfigRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async listActiveByProfile(profile: string): Promise<AiPromptConfigRecord[]> {
    const { data, error } = await this.supabaseClient
      .from("ai_prompt_configs")
      .select("*")
      .eq("profile", profile)
      .eq("is_active", true);

    if (error) {
      throw new InternalServerError("Failed to load AI prompt configs", {
        reason: error.message,
        profile
      });
    }

    return (data ?? []).map((row) => toAiPromptConfigRecord(row as Record<string, unknown>));
  }
}
