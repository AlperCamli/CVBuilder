import { z } from "zod";

const uuid = z.string().uuid();
const shortId = z.string().trim().min(1).max(32);

export const tailoringSessionParamsSchema = z.object({ sessionId: uuid }).strict();

export const tailoringTaskParamsSchema = z.object({ sessionId: uuid, taskId: uuid }).strict();

export const tailoringSuggestionParamsSchema = z.object({ sessionId: uuid, suggestionId: uuid }).strict();

export const tailoringRequirementParamsSchema = z.object({ sessionId: uuid, requirementId: shortId }).strict();

export const tailoringQuestionParamsSchema = z.object({ sessionId: uuid, questionId: shortId }).strict();

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
    refinement: z.enum(["shorter", "more_impact", "more_keywords"]).nullable().optional()
  })
  .strict()
  .default({});

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
