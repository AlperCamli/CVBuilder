import { z } from "zod";
import { cvContentInputSchema } from "../../../shared/cv-content/cv-content.schemas";

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizedHintSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed;
}, z.string().max(160).nullable().optional());

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
    target_hint: normalizedHintSchema
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

const tailoredDraftContentSchema = cvContentInputSchema.superRefine((content, context) => {
  if (!Array.isArray(content.sections) || content.sections.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sections"],
      message: "Tailored draft output must include at least one section."
    });
    return;
  }

  for (const [sectionIndex, section] of content.sections.entries()) {
    if (typeof section.type !== "string" || section.type.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", sectionIndex, "type"],
        message: "Section type is required."
      });
    }

    if (!Array.isArray(section.blocks) || section.blocks.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sections", sectionIndex, "blocks"],
        message: "Section blocks are required."
      });
      continue;
    }

    for (const [blockIndex, block] of section.blocks.entries()) {
      if (typeof block.type !== "string" || block.type.trim().length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "type"],
          message: "Block type is required."
        });
      }

      if (!isPlainRecord(block.fields)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "fields"],
          message: "Block fields must be an object."
        });
      }
    }
  }
});

export const tailoredDraftOutputSchema = z
  .object({
    current_content: tailoredDraftContentSchema,
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

export const cvParseOutputSchema = z
  .object({
    parsed_content: cvContentInputSchema,
    warnings: z.array(z.string()).max(20).optional()
  })
  .strict();

export const coverLetterOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    content: z.string().trim().min(1)
  })
  .strict();
