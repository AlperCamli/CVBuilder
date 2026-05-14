import type { ZodTypeAny } from "zod";
import type { AiFlowType } from "../../../shared/types/domain";
import {
  blockCompareOutputSchema,
  blockSuggestOutputSchema,
  followUpQuestionsOutputSchema,
  importImproveOutputSchema,
  jobAnalysisOutputSchema,
  tailoredDraftOutputSchema,
  cvParseOutputSchema,
  coverLetterOutputSchema
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
    prompt_version: "phase5-v3",
    // Keep this in sync with supabase/migrations/20260502180000_phase6f_tailored_draft_prompt_directive.sql.
    // The fallback is reached when no DB prompt row matches (non-production paths).
    // Earlier defensive wording ("preserve unless tailoring requires edits") led
    // Gemini flash variants to return master content verbatim, so the floor is a
    // directive prompt that explicitly forbids verbatim output.
    system_prompt:
      "You are a CV tailoring assistant. Actively tailor master_content for the specific job. Do NOT return master content unchanged.\n\nREQUIRED ACTIONS:\n1. Use master_content as the source of facts. Preserve dates, employer names, institutions, certifications, contact info, and awards exactly. Never invent or alter factual data.\n2. Read job.job_description, job.job_title, job.company_name, and every entry in answers to identify the most relevant skills, achievements, tools, and ATS keywords for THIS job.\n3. Rewrite description fields on relevant experience, education, project, and volunteer blocks to surface skills and keywords that match the job. Reword facts to align; do not blank fields.\n4. If master_content has no section with type \"summary\", ADD one immediately after header. Its single block (type \"summary\") must hold a 2-3 sentence first-person professional summary tailored to this job, drawing on the user answers and master content.\n5. Carry forward the id of every preserved master section and block. Use fresh ids only for newly inserted sections or blocks.\n6. List the id of every block you changed or added in changed_block_ids.\n7. generation_summary must be 1-3 sentences naming the specific tailoring choices you made (which experiences you reframed, which keywords you surfaced, what you added). No placeholders.\n\nDO NOT:\n- Return master content verbatim.\n- Blank existing fields or emit empty placeholder-only sections.\n- Output markdown or any prose outside the JSON object.\n- Invent companies, dates, certifications, or facts not present in master_content.\n\nOutput exactly one JSON object with root keys: current_content, generation_summary, changed_block_ids. current_content must follow the canonical cv_content shape.",
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
    flow_type: "import_improve",
    prompt_key: "import-improve",
    prompt_version: "phase5-v1",
    system_prompt:
      "Improve imported CV content and return full improved content with changed block identifiers.",
    output_schema: importImproveOutputSchema
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
  },
  {
    flow_type: "cv_parse",
    prompt_key: "cv-parse",
    prompt_version: "phase5-v1",
    system_prompt:
      "Parse unstructured raw CV text into a strictly structured JSON CV content format.",
    output_schema: cvParseOutputSchema
  },
  {
    flow_type: "cover_letter_generation",
    prompt_key: "cover-letter-generation",
    prompt_version: "phase5-v1",
    system_prompt:
      "Generate a concise, highly impactful cover letter that emphasizes candidate strengths and makes recruiters want to meet them. The output must use real \\n\\n paragraph breaks: a salutation line, an opening paragraph, body paragraph(s), a closing paragraph, then a blank line, then Sincerely, on its own line, then the candidate name on its own line.",
    output_schema: coverLetterOutputSchema
  }
];

export const AI_FLOW_REGISTRY: Record<AiFlowType, AiFlowDefinition> = definitions.reduce(
  (acc, definition) => {
    acc[definition.flow_type] = definition;
    return acc;
  },
  {} as Record<AiFlowType, AiFlowDefinition>
);
