import { z } from "zod";

const uuidSchema = z.string().uuid();

export const tailoredCvRevisionsParamsSchema = z
  .object({
    tailoredCvId: uuidSchema
  })
  .strict();

export const tailoredCvBlockRevisionsParamsSchema = z
  .object({
    tailoredCvId: uuidSchema,
    blockId: z.string().trim().min(1).max(128)
  })
  .strict();

export const revisionIdParamsSchema = z
  .object({
    revisionId: uuidSchema
  })
  .strict();

export const compareRevisionsSchema = z
  .object({
    from_revision_id: uuidSchema,
    to_revision_id: uuidSchema
  })
  .strict();
