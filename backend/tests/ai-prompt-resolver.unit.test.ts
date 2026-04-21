import { describe, expect, it } from "vitest";
import type { AiPromptConfigRecord, AiPromptConfigRepository } from "../src/modules/ai/prompts/prompt-config.repository";
import { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";

class InMemoryPromptConfigRepository implements AiPromptConfigRepository {
  constructor(private readonly rows: AiPromptConfigRecord[]) {}

  async listActiveByProfile(profile: string): Promise<AiPromptConfigRecord[]> {
    return this.rows.filter((row) => row.profile === profile && row.is_active);
  }
}

const baseRow = (overrides: Partial<AiPromptConfigRecord>): AiPromptConfigRecord => ({
  id: overrides.id ?? "prompt-id",
  profile: overrides.profile ?? "phase3-v1",
  flow_type: overrides.flow_type ?? "block_suggest",
  action_type: overrides.action_type ?? null,
  provider: overrides.provider ?? "gemini",
  model_name: overrides.model_name ?? "gemini-2.5-flash",
  prompt_key: overrides.prompt_key ?? "prompt-key",
  prompt_version: overrides.prompt_version ?? "phase5-v1",
  system_prompt: overrides.system_prompt ?? "System prompt",
  user_prompt_template: overrides.user_prompt_template ?? null,
  is_active: overrides.is_active ?? true,
  created_at: overrides.created_at ?? "2026-04-21T00:00:00.000Z",
  updated_at: overrides.updated_at ?? "2026-04-21T00:00:00.000Z"
});

describe("AiPromptResolver", () => {
  it("uses action-specific config before flow default", async () => {
    const repository = new InMemoryPromptConfigRepository([
      baseRow({
        id: "default",
        action_type: null,
        prompt_key: "block-suggest-default"
      }),
      baseRow({
        id: "improve",
        action_type: "improve",
        prompt_key: "block-suggest-improve"
      })
    ]);

    const resolver = new AiPromptResolver(repository, "phase3-v1", 60_000);

    const resolved = await resolver.resolve({
      flow_type: "block_suggest",
      provider: "gemini",
      action_type: "improve",
      fallback: {
        prompt_key: "fallback",
        prompt_version: "fallback-v1",
        system_prompt: "fallback-system",
        model_name: "fallback-model"
      }
    });

    expect(resolved.prompt_key).toBe("block-suggest-improve");
  });

  it("falls back when no prompt config exists", async () => {
    const repository = new InMemoryPromptConfigRepository([]);
    const resolver = new AiPromptResolver(repository, "phase3-v1", 60_000);

    const resolved = await resolver.resolve({
      flow_type: "job_analysis",
      provider: "gemini",
      fallback: {
        prompt_key: "fallback-key",
        prompt_version: "fallback-v1",
        system_prompt: "fallback-system",
        model_name: "fallback-model"
      }
    });

    expect(resolved).toEqual({
      prompt_key: "fallback-key",
      prompt_version: "fallback-v1",
      system_prompt: "fallback-system",
      model_name: "fallback-model",
      user_prompt_template: null
    });
  });

  it("prefers provider-specific prompt over provider=any", async () => {
    const repository = new InMemoryPromptConfigRepository([
      baseRow({
        id: "any-provider",
        provider: "any",
        prompt_key: "generic-improve",
        action_type: "improve"
      }),
      baseRow({
        id: "gemini-provider",
        provider: "gemini",
        prompt_key: "gemini-improve",
        action_type: "improve"
      })
    ]);

    const resolver = new AiPromptResolver(repository, "phase3-v1", 60_000);

    const resolved = await resolver.resolve({
      flow_type: "block_suggest",
      provider: "gemini",
      action_type: "improve",
      fallback: {
        prompt_key: "fallback-key",
        prompt_version: "fallback-v1",
        system_prompt: "fallback-system",
        model_name: "fallback-model"
      }
    });

    expect(resolved.prompt_key).toBe("gemini-improve");
  });
});
