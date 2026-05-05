import { z } from "zod";

const uuidSchema = z.string().uuid();

export const tailoredCvExportParamsSchema = z
  .object({
    tailoredCvId: uuidSchema
  })
  .strict();

export const masterCvExportParamsSchema = z
  .object({
    masterCvId: uuidSchema
  })
  .strict();

export const exportIdParamSchema = z
  .object({
    exportId: uuidSchema
  })
  .strict();

export const createExportSchema = z
  .object({
    template_id: uuidSchema.nullable().optional(),
    font_scale: z.number().min(0.85).max(1.15).optional(),
    spacing_scale: z.number().min(0.7).max(1.4).optional(),
    layout_scale: z.number().min(0.7).max(1.3).optional()
  })
  .strict();
