import { z } from "zod";
import type { CvJsonValue } from "./cv-content.types";

const cvJsonValueSchema: z.ZodType<CvJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(cvJsonValueSchema),
    z.record(cvJsonValueSchema)
  ])
);

export const cvBlockInputSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    type: z.string().trim().min(1).max(64).optional(),
    order: z.number().int().min(0).optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    fields: z.record(cvJsonValueSchema).optional(),
    meta: z.record(cvJsonValueSchema).optional()
  })
  .passthrough();

export const cvSectionInputSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    type: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().max(160).nullable().optional(),
    order: z.number().int().min(0).optional(),
    blocks: z.array(cvBlockInputSchema).optional(),
    meta: z.record(cvJsonValueSchema).optional()
  })
  .passthrough();

export const cvContentInputSchema = z
  .object({
    version: z.string().optional(),
    language: z.string().trim().min(2).max(16).optional(),
    metadata: z.record(cvJsonValueSchema).optional(),
    sections: z.array(cvSectionInputSchema).optional()
  })
  .passthrough();

export const cvContentReplacementSchema = z
  .object({
    current_content: cvContentInputSchema
  })
  .strict();

export const cvBlockPatchSchema = z
  .object({
    type: z.string().trim().min(1).max(64).optional(),
    order: z.number().int().min(0).optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    fields: z.record(cvJsonValueSchema).optional(),
    meta: z.record(cvJsonValueSchema).optional(),
    replace_fields: z.boolean().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.type !== undefined ||
      input.order !== undefined ||
      input.visibility !== undefined ||
      input.fields !== undefined ||
      input.meta !== undefined,
    {
      message: "At least one block field must be provided"
    }
  );
