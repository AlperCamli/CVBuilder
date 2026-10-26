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

// Tailoring v2 contracts. All properties are required (nullable where absent) so OpenAI
// strict structured output can enforce them; ids are the short aliases from the compact CV.
const tailoringAliasSchema = z.string().trim().min(1).max(32);

export const tailoringRequirementOutputSchema = z
  .object({
    id: tailoringAliasSchema,
    text: z.string().trim().min(1).max(220),
    keywords: z.array(z.string().trim().min(1).max(60)).max(5),
    importance: z.enum(["must", "nice"]),
    weight: z.number().int().min(1).max(3),
    status: z.enum(["covered", "weak", "missing"]),
    confidence: z.enum(["high", "medium", "low"]),
    evidence_block_ids: z.array(tailoringAliasSchema).max(6),
    reason: z.string().trim().max(280)
  })
  .strict();

export const tailoringQuestionOutputSchema = z
  .object({
    id: tailoringAliasSchema,
    kind: z.enum(["gap", "metric"]),
    text: z.string().trim().min(1).max(320),
    requirement_id: tailoringAliasSchema.nullable(),
    target_block_id: tailoringAliasSchema.nullable()
  })
  .strict();

export const tailoringBlockBriefOutputSchema = z
  .object({
    block_id: tailoringAliasSchema,
    requirement_ids: z.array(tailoringAliasSchema).max(8),
    focus: z.string().trim().max(320),
    terms: z.array(z.string().trim().min(1).max(60)).max(8),
    avoid: z.string().trim().max(240)
  })
  .strict();

export const tailoringAnalysisOutputSchema = z
  .object({
    role_summary: z.string().trim().max(400),
    requirements: z.array(tailoringRequirementOutputSchema).min(1).max(15),
    questions: z.array(tailoringQuestionOutputSchema).max(9),
    block_briefs: z.array(tailoringBlockBriefOutputSchema).max(12)
  })
  .strict();

export const tailoringBlockOutputSchema = z
  .object({
    changed: z.boolean(),
    lines: z.array(z.string().trim().min(1).max(400)).max(8),
    rationale: z.string().trim().max(280),
    requirement_ids: z.array(tailoringAliasSchema).max(10)
  })
  .strict();

// allowed_skill names the allowed_new_skills entry a new skill renders (it may be written
// in the CV language while the entry is in the job language); null for current skills.
export const tailoringSkillOutputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    allowed_skill: z.string().trim().min(1).max(60).nullable()
  })
  .strict();

export const tailoringSkillsOutputSchema = z
  .object({
    changed: z.boolean(),
    skills: z.array(tailoringSkillOutputSchema).max(30),
    rationale: z.string().trim().max(280),
    requirement_ids: z.array(tailoringAliasSchema).max(15)
  })
  .strict();

export const tailoringStructureOutputSchema = z
  .object({
    changed: z.boolean(),
    section_order: z.array(tailoringAliasSchema).max(30),
    hide_section_ids: z.array(tailoringAliasSchema).max(5),
    rationale: z.string().trim().max(280)
  })
  .strict();
