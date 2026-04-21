import type { AiFlowType, AiSuggestionActionType } from "../../../shared/types/domain";
import type { AiPromptConfigRepository } from "./prompt-config.repository";

export interface PromptResolutionFallback {
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  model_name: string;
}

export interface ResolveAiPromptInput {
  flow_type: AiFlowType;
  provider: string;
  action_type?: AiSuggestionActionType | null;
  fallback: PromptResolutionFallback;
}

export interface ResolvedAiPrompt {
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  model_name: string;
  user_prompt_template: string | null;
}

interface PromptCacheState {
  expiresAt: number;
  rows: Awaited<ReturnType<AiPromptConfigRepository["listActiveByProfile"]>>;
}

const PROVIDER_ANY = "any";

export class AiPromptResolver {
  private cacheState: PromptCacheState | null = null;

  constructor(
    private readonly repository: AiPromptConfigRepository,
    private readonly profile: string,
    private readonly ttlMs = 30_000
  ) {}

  async resolve(input: ResolveAiPromptInput): Promise<ResolvedAiPrompt> {
    const rows = await this.loadRows();
    const candidate = this.selectCandidate(rows, input);

    if (!candidate) {
      return {
        prompt_key: input.fallback.prompt_key,
        prompt_version: input.fallback.prompt_version,
        system_prompt: input.fallback.system_prompt,
        model_name: input.fallback.model_name,
        user_prompt_template: null
      };
    }

    return {
      prompt_key: candidate.prompt_key,
      prompt_version: candidate.prompt_version,
      system_prompt: candidate.system_prompt,
      model_name: candidate.model_name || input.fallback.model_name,
      user_prompt_template: candidate.user_prompt_template
    };
  }

  invalidateCache(): void {
    this.cacheState = null;
  }

  private async loadRows() {
    const now = Date.now();
    if (this.cacheState && this.cacheState.expiresAt > now) {
      return this.cacheState.rows;
    }

    const rows = await this.repository.listActiveByProfile(this.profile);
    this.cacheState = {
      rows,
      expiresAt: now + this.ttlMs
    };

    return rows;
  }

  private selectCandidate(
    rows: Awaited<ReturnType<AiPromptConfigRepository["listActiveByProfile"]>>,
    input: ResolveAiPromptInput
  ) {
    const flowRows = rows.filter((row) => row.flow_type === input.flow_type);
    if (flowRows.length === 0) {
      return null;
    }

    const exactProviderRows = flowRows.filter((row) => row.provider === input.provider);
    const wildcardProviderRows = flowRows.filter((row) => row.provider === PROVIDER_ANY);

    return (
      this.pickByAction(exactProviderRows, input.action_type ?? null) ??
      this.pickByAction(wildcardProviderRows, input.action_type ?? null)
    );
  }

  private pickByAction(
    rows: Awaited<ReturnType<AiPromptConfigRepository["listActiveByProfile"]>>,
    actionType: AiSuggestionActionType | null
  ) {
    if (rows.length === 0) {
      return null;
    }

    const exactAction = rows.find((row) => (row.action_type ?? null) === actionType);
    if (exactAction) {
      return exactAction;
    }

    return rows.find((row) => row.action_type === null) ?? null;
  }
}
