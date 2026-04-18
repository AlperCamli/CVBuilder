import { z } from "zod";
import { cvContentInputSchema } from "../../shared/cv-content/cv-content.schemas";

const uuidSchema = z.string().uuid();

export const renderingPreviewSchema = z
  .object({
    cv_kind: z.enum(["master", "tailored"]),
    current_content: cvContentInputSchema,
    template_id: uuidSchema.nullable().optional(),
    language: z.string().trim().min(2).max(16).optional(),
    context: z.record(z.unknown()).optional()
  })
  .strict();
