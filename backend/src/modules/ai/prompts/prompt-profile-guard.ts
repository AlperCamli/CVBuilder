import type { AppConfig } from "../../../shared/config/env";
import { createSupabaseClients } from "../../../shared/db/supabase";
import type { AiFlowType, AiSuggestionActionType } from "../../../shared/types/domain";
import { SupabaseAiPromptConfigRepository } from "./prompt-config.repository";

interface PromptCoverageTarget {
  flow_type: AiFlowType;
  action_type: AiSuggestionActionType | null;
}

const REQUIRED_PROMPT_TARGETS: PromptCoverageTarget[] = [
  { flow_type: "job_analysis", action_type: null },
  { flow_type: "follow_up_questions", action_type: null },
  { flow_type: "tailored_draft", action_type: null },
  { flow_type: "import_improve", action_type: null },
  { flow_type: "cv_parse", action_type: null },
  { flow_type: "cover_letter_generation", action_type: null },
  { flow_type: "block_compare", action_type: null },
  { flow_type: "multi_option", action_type: "options" },
  { flow_type: "block_suggest", action_type: "improve" },
  { flow_type: "block_suggest", action_type: "rewrite" },
  { flow_type: "block_suggest", action_type: "summarize" },
  { flow_type: "block_suggest", action_type: "shorten" },
  { flow_type: "block_suggest", action_type: "expand" },
  { flow_type: "block_suggest", action_type: "options" }
];

const toCoverageKey = (target: PromptCoverageTarget): string =>
  `${target.flow_type}:${target.action_type ?? ""}`;

export const assertProductionPromptProfileCoverage = async (
  config: AppConfig
): Promise<void> => {
  if (config.appEnv !== "production" || config.ai.provider === "mock") {
    return;
  }

  const { serviceRoleClient } = createSupabaseClients(config);
  const repository = new SupabaseAiPromptConfigRepository(serviceRoleClient);
  const rows = await repository.listActiveByProfile(config.ai.promptProfile);

  const coverageKeys = new Set(
    rows
      .filter(
        (row) => row.provider === config.ai.provider || row.provider === "any"
      )
      .map((row) => toCoverageKey({ flow_type: row.flow_type, action_type: row.action_type }))
  );

  const missingTargets = REQUIRED_PROMPT_TARGETS.filter(
    (target) => !coverageKeys.has(toCoverageKey(target))
  );

  if (missingTargets.length > 0) {
    throw new Error(
      `Invalid AI prompt configuration: missing active prompt rows for profile=${config.ai.promptProfile}, provider=${config.ai.provider}: ${missingTargets
        .map((target) => toCoverageKey(target))
        .join(", ")}`
    );
  }
};
