import { z } from "zod";
import { cvContentInputSchema } from "../../shared/cv-content/cv-content.schemas";

const uuidSchema = z.string().uuid();

const ALLOWED_IMPORT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/msword",
  "text/plain",
  "application/rtf",
  "text/rtf"
] as const;

export const importIdParamSchema = z
  .object({
    importId: uuidSchema
  })
  .strict();

export const createImportSessionSchema = z
  .object({
    original_filename: z.string().trim().min(1).max(260),
    mime_type: z.enum(ALLOWED_IMPORT_MIME_TYPES),
    size_bytes: z.coerce.number().int().min(0),
    storage_bucket: z.string().trim().min(1).max(128),
    storage_path: z.string().trim().min(1).max(512),
    checksum: z.string().trim().min(1).max(256).nullable().optional()
  })
  .strict();

export const createImportUploadUrlSchema = z
  .object({
    original_filename: z.string().trim().min(1).max(260)
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
