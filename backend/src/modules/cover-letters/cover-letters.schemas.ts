import { z } from "zod";

const uuidSchema = z.string().uuid();

export const coverLetterIdParamSchema = z
  .object({
    coverLetterId: uuidSchema
  })
  .strict();

export const coverLetterExportIdParamSchema = z
  .object({
    coverLetterExportId: uuidSchema
  })
  .strict();

export const coverLetterJobIdParamSchema = z
  .object({
    jobId: uuidSchema
  })
  .strict();

export const updateCoverLetterContentSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    content: z.string().max(40000),
    status: z.enum(["draft", "ready", "archived"]).optional()
  })
  .strict();
