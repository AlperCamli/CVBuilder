import { z } from "zod";

const uuidSchema = z.string().uuid();

export const tailoredCvExportParamsSchema = z
  .object({
    tailoredCvId: uuidSchema
  })
  .strict();

export const exportIdParamSchema = z
  .object({
    exportId: uuidSchema
  })
  .strict();

export const createExportSchema = z
  .object({
    template_id: uuidSchema.nullable().optional()
  })
  .strict();
