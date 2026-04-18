import { z } from "zod";

const uuidSchema = z.string().uuid();

export const templateIdParamSchema = z
  .object({
    templateId: uuidSchema
  })
  .strict();
