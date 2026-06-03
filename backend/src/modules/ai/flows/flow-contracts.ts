import { z } from "zod";
import { cvContentInputSchema } from "../../../shared/cv-content/cv-content.schemas";

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const flattenTextValues = (value: unknown): string[] => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenTextValues(entry));
  }

  if (isPlainRecord(value)) {
    return Object.values(value).flatMap((entry) => flattenTextValues(entry));
  }

  return [];
};

const hasNonEmptyField = (fields: Record<string, unknown>, key: string): boolean => {
  if (!(key in fields)) {
    return false;
  }

  return flattenTextValues(fields[key]).some((value) => value.trim().length > 0);
};

export const followUpQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    question: z.string().trim().min(1).max(500),
    question_type: z.enum(["short_text", "yes_no"])
  })
  .strict();

export const jobAnalysisOutputSchema = z
  .object({
    topics: z.array(z.string().trim().min(1).max(160)).max(20),
    keywords: z.array(z.string().trim().min(1).max(80)).max(30)
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
        continue;
      }

      const normalizedSectionType =
        typeof section.type === "string"
          ? section.type.trim().toLowerCase().replace(/[\s-]+/g, "_")
          : "";
      if (normalizedSectionType === "education") {
        if (!hasNonEmptyField(block.fields, "degree")) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", sectionIndex, "blocks", blockIndex, "fields", "degree"],
            message: "Education blocks must include a non-empty degree field."
          });
        }

        if (!hasNonEmptyField(block.fields, "field_of_study")) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sections", sectionIndex, "blocks", blockIndex, "fields", "field_of_study"],
            message: "Education blocks must include a non-empty field_of_study field."
          });
        }
      }
    }
  }
});

const importImproveContentSchema = cvContentInputSchema.superRefine((content, context) => {
  if (!Array.isArray(content.sections)) {
    return;
  }

  for (const [sectionIndex, section] of content.sections.entries()) {
    const normalizedSectionType =
      typeof section.type === "string"
        ? section.type.trim().toLowerCase().replace(/[\s-]+/g, "_")
        : "";
    if (normalizedSectionType !== "education" || !Array.isArray(section.blocks)) {
      continue;
    }

    for (const [blockIndex, block] of section.blocks.entries()) {
      if (!isPlainRecord(block.fields)) {
        continue;
      }

      if (!hasNonEmptyField(block.fields, "degree")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "fields", "degree"],
          message: "Education blocks must include a non-empty degree field."
        });
      }

      if (!hasNonEmptyField(block.fields, "field_of_study")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sections", sectionIndex, "blocks", blockIndex, "fields", "field_of_study"],
          message: "Education blocks must include a non-empty field_of_study field."
        });
      }
    }
  }
});

export const tailoredDraftOutputSchema = z
  .object({
    current_content: tailoredDraftContentSchema,
    changed_block_ids: z.array(z.string().trim().min(1).max(128)).max(200)
  })
  .strict();

export const importImproveOutputSchema = z
  .object({
    improved_content: importImproveContentSchema,
    changed_block_ids: z.array(z.string().trim().min(1).max(128)).max(200)
  })
  .strict();

export const blockSuggestOutputSchema = z
  .object({
    suggested_block: z.record(z.unknown())
  })
  .strict();

export const professionalSummaryOutputSchema = z
  .object({
    summary_text: z.string().trim().min(1).max(2000)
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
