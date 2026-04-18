import { z } from "zod";
import { cvContentInputSchema } from "../../shared/cv-content/cv-content.schemas";

const uuidSchema = z.string().uuid();

export const importIdParamSchema = z
  .object({
    importId: uuidSchema
  })
  .strict();

export const createImportSessionSchema = z
  .object({
    original_filename: z.string().trim().min(1).max(260),
    mime_type: z
      .string()
      .trim()
      .max(160)
      .optional()
      .default("application/octet-stream")
      .transform((value) => (value.length > 0 ? value : "application/octet-stream")),
    size_bytes: z.coerce.number().int().min(0),
    storage_bucket: z.string().trim().min(1).max(128),
    storage_path: z.string().trim().min(1).max(512),
    checksum: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict();

export const updateImportResultSchema = z
  .object({
    parsed_content: cvContentInputSchema
  })
  .strict();

export const createMasterCvFromImportSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    language: z.string().trim().min(2).max(16).optional(),
    template_id: uuidSchema.nullable().optional()
  })
  .strict();
