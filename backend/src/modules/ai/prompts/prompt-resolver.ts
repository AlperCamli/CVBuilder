import type { AiFlowType, AiSuggestionActionType } from "../../../shared/types/domain";
import { InternalServerError } from "../../../shared/errors/app-error";
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
  // Optional per-request profile (e.g. a CV module's prompt profile). When set, rows
  // from this profile are preferred; missing rows fall back to the default profile and
  // then to the in-code flow registry. When absent, behavior is identical to before.
  profile?: string;
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
  private readonly cacheStates = new Map<string, PromptCacheState>();

  constructor(
    private readonly repository: AiPromptConfigRepository,
    private readonly profile: string,
    private readonly ttlMs = 30_000,
    private readonly allowFallback = true
  ) {}

  async resolve(input: ResolveAiPromptInput): Promise<ResolvedAiPrompt> {
    const requestProfile = input.profile?.trim();

    if (requestProfile && requestProfile !== this.profile) {
      const profileRows = await this.loadRows(requestProfile);
      const profileCandidate = this.selectCandidate(profileRows, input);

      if (profileCandidate) {
        return this.toResolvedPrompt(profileCandidate, input);
      }
    }

    const rows = await this.loadRows(this.profile);
    const candidate = this.selectCandidate(rows, input);

    if (!candidate) {
      if (!this.allowFallback) {
        throw new InternalServerError("AI prompt profile is missing an active config", {
          profile: requestProfile ?? this.profile,
          flow_type: input.flow_type,
          provider: input.provider
        });
      }

      return {
        prompt_key: input.fallback.prompt_key,
        prompt_version: input.fallback.prompt_version,
        system_prompt: input.fallback.system_prompt,
        model_name: input.fallback.model_name,
        user_prompt_template: null
      };
    }

    return this.toResolvedPrompt(candidate, input);
  }

  invalidateCache(): void {
    this.cacheStates.clear();
  }

  private toResolvedPrompt(
    candidate: Awaited<ReturnType<AiPromptConfigRepository["listActiveByProfile"]>>[number],
    input: ResolveAiPromptInput
  ): ResolvedAiPrompt {
    return {
      prompt_key: candidate.prompt_key,
      prompt_version: candidate.prompt_version,
      system_prompt: candidate.system_prompt,
      model_name: candidate.model_name || input.fallback.model_name,
      user_prompt_template: candidate.user_prompt_template
    };
  }

  private async loadRows(profile: string) {
    const now = Date.now();
    const cached = this.cacheStates.get(profile);
    if (cached && cached.expiresAt > now) {
      return cached.rows;
    }

    const rows = await this.repository.listActiveByProfile(profile);
    this.cacheStates.set(profile, {
      rows,
      expiresAt: now + this.ttlMs
    });

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
