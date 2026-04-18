import type { ZodTypeAny } from "zod";
import type { AiFlowType } from "../../../shared/types/domain";
import {
  blockCompareOutputSchema,
  blockSuggestOutputSchema,
  followUpQuestionsOutputSchema,
  jobAnalysisOutputSchema,
  tailoredDraftOutputSchema
} from "./flow-contracts";

export interface AiFlowDefinition {
  flow_type: AiFlowType;
  prompt_key: string;
  prompt_version: string;
  system_prompt: string;
  output_schema: ZodTypeAny;
}

const definitions: AiFlowDefinition[] = [
  {
    flow_type: "job_analysis",
    prompt_key: "job-analysis",
    prompt_version: "phase3-v1",
    system_prompt:
      "Analyze job descriptions against a master CV and return structured requirements, strengths, and gaps.",
    output_schema: jobAnalysisOutputSchema
  },
  {
    flow_type: "follow_up_questions",
    prompt_key: "follow-up-questions",
    prompt_version: "phase3-v1",
    system_prompt:
      "Generate structured follow-up questions that help tailor a CV to a specific job posting.",
    output_schema: followUpQuestionsOutputSchema
  },
  {
    flow_type: "tailored_draft",
    prompt_key: "tailored-draft",
    prompt_version: "phase3-v1",
    system_prompt:
      "Generate a complete tailored CV snapshot from the source master CV, job context, and user answers.",
    output_schema: tailoredDraftOutputSchema
  },
  {
    flow_type: "block_suggest",
    prompt_key: "block-suggest",
    prompt_version: "phase3-v1",
    system_prompt:
      "Generate contextual block-level edit suggestions without directly mutating stored CV content.",
    output_schema: blockSuggestOutputSchema
  },
  {
    flow_type: "block_compare",
    prompt_key: "block-compare",
    prompt_version: "phase3-v1",
    system_prompt:
      "Compare a CV block against job requirements and produce actionable gap feedback.",
    output_schema: blockCompareOutputSchema
  },
  {
    flow_type: "multi_option",
    prompt_key: "block-options",
    prompt_version: "phase3-v1",
    system_prompt: "Generate multiple alternative rewrite options for one CV block.",
    output_schema: blockSuggestOutputSchema
  },
  {
    flow_type: "summary",
    prompt_key: "summary",
    prompt_version: "phase3-v1",
    system_prompt: "Create concise, high-quality summary rewrites for CV blocks.",
    output_schema: blockSuggestOutputSchema
  },
  {
    flow_type: "improve",
    prompt_key: "improve",
    prompt_version: "phase3-v1",
    system_prompt: "Improve clarity, impact, and relevance of CV block content.",
    output_schema: blockSuggestOutputSchema
  }
];

export const AI_FLOW_REGISTRY: Record<AiFlowType, AiFlowDefinition> = definitions.reduce(
  (acc, definition) => {
    acc[definition.flow_type] = definition;
    return acc;
  },
  {} as Record<AiFlowType, AiFlowDefinition>
);
