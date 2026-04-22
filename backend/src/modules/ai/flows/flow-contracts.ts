import { z } from "zod";
import { cvContentInputSchema } from "../../../shared/cv-content/cv-content.schemas";

export const followUpQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    question: z.string().trim().min(1).max(500),
    question_type: z.enum(["single_choice", "multi_select", "text"]),
    choices: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            label: z.string().trim().min(1).max(240)
          })
          .strict()
      )
      .max(10)
      .optional(),
    target_hint: z.string().trim().max(160).nullable().optional()
  })
  .strict();

export const jobAnalysisOutputSchema = z
  .object({
    keywords: z.array(z.string().trim().min(1).max(80)).max(30),
    requirements: z.array(z.string().trim().min(1).max(300)).max(20),
    strengths: z.array(z.string().trim().min(1).max(300)).max(20),
    gaps: z.array(z.string().trim().min(1).max(300)).max(20),
    summary: z.string().trim().min(1).max(2000),
    fit_score: z.number().int().min(0).max(100).nullable()
  })
  .strict();

export const followUpQuestionsOutputSchema = z
  .object({
    questions: z.array(followUpQuestionSchema).max(20)
  })
  .strict();

export const tailoredDraftOutputSchema = z
  .object({
    current_content: cvContentInputSchema,
    generation_summary: z.string().trim().min(1).max(2000),
    changed_block_ids: z.array(z.string().trim().min(1).max(128)).max(200)
  })
  .strict();

export const importImproveOutputSchema = z
  .object({
    improved_content: cvContentInputSchema,
    generation_summary: z.string().trim().min(1).max(2000),
    changed_block_ids: z.array(z.string().trim().min(1).max(128)).max(200)
  })
  .strict();

export const blockSuggestionVariantSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    rationale: z.string().trim().min(1).max(1000),
    suggested_block: z.record(z.unknown())
  })
  .strict();

export const blockSuggestOutputSchema = z
  .object({
    suggestions: z.array(blockSuggestionVariantSchema).min(1).max(8)
  })
  .strict();

export const blockCompareOutputSchema = z
  .object({
    comparison_summary: z.string().trim().min(1).max(1500),
    gap_highlights: z.array(z.string().trim().min(1).max(300)).max(20),
    improvement_guidance: z.array(z.string().trim().min(1).max(300)).max(20),
    matched_keywords: z.array(z.string().trim().min(1).max(80)).max(30),
    missing_keywords: z.array(z.string().trim().min(1).max(80)).max(30)
  })
  .strict();
