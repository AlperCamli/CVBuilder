import { z } from "zod";
import { TAILORING_INSTRUCTION_MAX_CHARS, TAILORING_REFINEMENTS } from "./tailoring.types";

const uuid = z.string().uuid();
const shortId = z.string().trim().min(1).max(32);

export const tailoringSessionParamsSchema = z.object({ sessionId: uuid }).strict();

export const tailoringTaskParamsSchema = z.object({ sessionId: uuid, taskId: uuid }).strict();

export const tailoringSuggestionParamsSchema = z.object({ sessionId: uuid, suggestionId: uuid }).strict();

export const tailoringRequirementParamsSchema = z.object({ sessionId: uuid, requirementId: shortId }).strict();

export const tailoringQuestionParamsSchema = z.object({ sessionId: uuid, questionId: shortId }).strict();

// CV block ids are client-generated strings, not necessarily uuids.
export const tailoringBlockParamsSchema = z.object({ sessionId: uuid, blockId: z.string().trim().min(1).max(128) }).strict();

const refinementSchema = z.enum(TAILORING_REFINEMENTS).nullable().optional();
// The candidate's own request; blank means none.
const instructionSchema = z
  .string()
  .trim()
  .max(TAILORING_INSTRUCTION_MAX_CHARS)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

export const createTailoringSessionSchema = z
  .object({
    cv_id: uuid,
    job: z
      .object({
        job_title: z.string().trim().min(1).max(200),
        company_name: z.string().trim().max(200).nullable().optional(),
        job_description: z.string().trim().min(80, "Paste the full job description (at least a few sentences).").max(40_000)
      })
      .strict()
  })
  .strict();

export const activeTailoringSessionQuerySchema = z.object({ tailored_cv_id: uuid }).strict();

export const requirementDecisionSchema = z
  .object({ decision: z.enum(["relevant", "not_relevant"]) })
  .strict();

export const answerQuestionSchema = z
  .object({
    answer: z.enum(["yes", "some", "no"]).nullable(),
    detail: z.string().trim().max(1000).nullable().optional(),
    add_to_main: z.boolean().optional()
  })
  .strict();

export const runTaskSchema = z
  .object({
    regenerate: z.boolean().optional(),
    refinement: refinementSchema,
    instruction: instructionSchema
  })
  .strict()
  .default({});

export const refineBlockSchema = z
  .object({
    refinement: refinementSchema,
    instruction: instructionSchema
  })
  .strict()
  .refine((value) => Boolean(value.refinement || value.instruction), {
    message: "Choose a refinement or describe what to change."
  });

export const suggestionDecisionSchema = z
  .object({
    decision: z.enum(["accept", "reject", "undo"]),
    edited_value: z
      .union([z.string().trim().min(1).max(4000), z.array(z.string().trim().min(1).max(80)).min(1).max(40)])
      .nullable()
      .optional()
  })
  .strict();

export const tailoringPreferencesSchema = z.object({ auto_apply: z.boolean() }).strict();

export const adminSessionsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(200).optional() })
  .strict();
