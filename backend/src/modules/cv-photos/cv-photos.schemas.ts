import { z } from "zod";

const uuidSchema = z.string().uuid();

export const createCvPhotoUploadUrlSchema = z
  .object({
    content_type: z.string().trim().min(1).max(100),
    size_bytes: z.coerce.number().int().min(1).max(20_971_520)
  })
  .strict();

export const completeCvPhotoUploadSchema = z
  .object({
    storage_path: z.string().trim().min(1).max(512)
  })
  .strict();

export const cvPhotoIdParamSchema = z
  .object({
    fileId: uuidSchema
  })
  .strict();
