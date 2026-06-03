import type { ZodTypeAny } from "zod";
import type { AiFlowType } from "../../../shared/types/domain";
import {
  blockSuggestOutputSchema,
  followUpQuestionsOutputSchema,
  importImproveOutputSchema,
  jobAnalysisOutputSchema,
  tailoredDraftOutputSchema,
  cvParseOutputSchema,
  coverLetterOutputSchema,
  professionalSummaryOutputSchema
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
    prompt_version: "phase6-v1",
    system_prompt:
      "You are an expert at choosing CV keywords and topics recruiters expect to see. Analyze the provided job description for the target role and return only the most useful CV topics and ATS keywords. Output strict JSON with root keys topics and keywords.",
    output_schema: jobAnalysisOutputSchema
  },
  {
    flow_type: "follow_up_questions",
    prompt_key: "follow-up-questions",
    prompt_version: "phase6-v1",
    system_prompt:
      "Generate concise follow-up questions based only on selected CV topics and keywords. Ask how the user wants those topics reflected in the CV. Prefer short answers; use yes_no only for true yes/no questions. Output strict JSON with questions only.",
    output_schema: followUpQuestionsOutputSchema
  },
  {
    flow_type: "tailored_draft",
    prompt_key: "tailored-draft",
    prompt_version: "phase6-v1",
    system_prompt:
      "You are a CV tailoring assistant. Tailor the sanitized master_cv body for the target role using selected_topics, selected_keywords, and answered_questions. Use the same language as the source CV content. Preserve facts; never invent employers, dates, institutions, certifications, awards, or achievements. The CV header/contact data is intentionally omitted and will be restored by the backend, so do not create a header/contact section. Keep existing alias ids for unchanged or rewritten sections/blocks. Add new simple alias ids only for new blocks/sections. If the source CV has no skills section, you may add a concise Skills section using selected keywords/topics that are truthful skill signals. If an answer is negative or says the user lacks something, do not mention the weakness; find the best truthful fit using the existing CV content and selected signals. Output exactly one JSON object with root keys current_content and changed_block_ids. Do not output generation_summary, markdown, or prose outside JSON.",
    output_schema: tailoredDraftOutputSchema
  },
  {
    flow_type: "block_suggest",
    prompt_key: "block-suggest",
    prompt_version: "phase8-v2",
    system_prompt:
      "Update one CV block for the requested action while preserving truthful facts, IDs, type, order, visibility, and the original field shape. For narrative blocks, improve only the existing narrative fields and do not add standalone technical skills lists inside descriptions. Do not add unrelated fields such as skills, items, or text unless the original block already uses that field as primary content. Return strict JSON with one root key suggested_block only. Do not include rationale, labels, summaries, options, markdown, or prose.",
    output_schema: blockSuggestOutputSchema
  },
  {
    flow_type: "import_improve",
    prompt_key: "import-improve",
    prompt_version: "phase7-v1",
    system_prompt:
      "Parent orchestration flow for imported CV improvement. The backend fans out block-level improvement, skills generation, and professional summary runs, then returns one improved CV snapshot. This parent flow is not sent to the model.",
    output_schema: importImproveOutputSchema
  },
  {
    flow_type: "professional_summary",
    prompt_key: "professional-summary",
    prompt_version: "phase1-v1",
    system_prompt:
      "Write a concise professional CV summary from sanitized cv_body only. Use the same language as the source CV content. Preserve facts; never invent employers, dates, degrees, certifications, metrics, tools, awards, or achievements. Header/contact data is intentionally omitted, so do not include names, email, phone, location, links, or a header. Output strict JSON with one root key summary_text only.",
    output_schema: professionalSummaryOutputSchema
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
