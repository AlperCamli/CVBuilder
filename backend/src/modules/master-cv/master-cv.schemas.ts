import { z } from "zod";
import { cvBlockPatchSchema, cvContentInputSchema, cvContentReplacementSchema } from "../../shared/cv-content/cv-content.schemas";

const uuidSchema = z.string().uuid();

export const masterCvIdParamSchema = z
  .object({
    masterCvId: uuidSchema
  })
  .strict();

export const masterCvBlockParamsSchema = z
  .object({
    masterCvId: uuidSchema,
    blockId: z.string().trim().min(1).max(128)
  })
  .strict();

export const createMasterCvSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    language: z.string().trim().min(2).max(16),
    template_id: uuidSchema.nullable().optional(),
    current_content: cvContentInputSchema.optional()
  })
  .strict();

export const updateMasterCvSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    language: z.string().trim().min(2).max(16).optional(),
    template_id: uuidSchema.nullable().optional(),
    summary_text: z.string().trim().max(2000).nullable().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.language !== undefined ||
      input.template_id !== undefined ||
      input.summary_text !== undefined,
    {
      message: "At least one field must be provided"
    }
  );

export const replaceMasterCvContentSchema = cvContentReplacementSchema;

export const updateMasterCvBlockSchema = cvBlockPatchSchema;

export const assignMasterCvTemplateSchema = z
  .object({
    template_id: uuidSchema.nullable()
  })
  .strict();
