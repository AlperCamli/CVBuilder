import { z } from "zod";
import { cvBlockPatchSchema, cvContentReplacementSchema } from "../../shared/cv-content/cv-content.schemas";

const uuidSchema = z.string().uuid();
const tailoredCvStatusSchema = z.enum(["draft", "ready", "exported", "archived"]);

export const tailoredCvIdParamSchema = z
  .object({
    tailoredCvId: uuidSchema
  })
  .strict();

export const tailoredCvBlockParamsSchema = z
  .object({
    tailoredCvId: uuidSchema,
    blockId: z.string().trim().min(1).max(128)
  })
  .strict();

export const listTailoredCvsQuerySchema = z
  .object({
    status: tailoredCvStatusSchema.optional(),
    company_name: z.string().trim().min(1).max(160).optional(),
    sort_order: z.enum(["asc", "desc"]).optional()
  })
  .strict();

export const createTailoredCvSchema = z
  .object({
    master_cv_id: uuidSchema,
    title: z.string().trim().min(1).max(160).optional(),
    language: z.string().trim().min(2).max(16).optional(),
    template_id: uuidSchema.nullable().optional(),
    job: z
      .object({
        company_name: z.string().trim().min(1).max(160),
        job_title: z.string().trim().min(1).max(160),
        job_description: z.string().trim().min(1).max(40000),
        job_posting_url: z.string().trim().url().max(2000).nullable().optional(),
        location_text: z.string().trim().max(240).nullable().optional(),
        notes: z.string().trim().max(10000).nullable().optional()
      })
      .strict()
  })
  .strict();

export const updateTailoredCvSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    language: z.string().trim().min(2).max(16).optional(),
    template_id: uuidSchema.nullable().optional(),
    status: tailoredCvStatusSchema.optional()
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.language !== undefined ||
      input.template_id !== undefined ||
      input.status !== undefined,
    {
      message: "At least one field must be provided"
    }
  );

export const replaceTailoredCvContentSchema = cvContentReplacementSchema;

export const updateTailoredCvBlockSchema = cvBlockPatchSchema;
