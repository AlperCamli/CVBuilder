import { z } from "zod";
export const guestAnswersSchema = z
  .object({
    goal: z.enum(["tailor", "improve", "design", "explore"]).optional(),
    career: z
      .enum(["student", "early", "experienced", "change", "return"])
      .optional(),
    education: z
      .enum([
        "secondary",
        "vocational",
        "associate",
        "bachelor",
        "master",
        "doctorate",
        "other",
      ])
      .optional(),
    source: z
      .enum(["search", "social", "friend", "community", "article", "other"])
      .optional(),
  })
  .strict();
export type GuestAnswers = z.infer<typeof guestAnswersSchema>;
export const guestCreateSchema = z
  .object({
    notice_version: z.string().max(40).optional(),
    ai_processing: z.boolean().default(false),
    analytics: z.boolean().default(false),
    original_filename: z.string().trim().min(1).max(260),
    mime_type: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    size_bytes: z
      .number()
      .int()
      .min(1)
      .max(20 * 1024 * 1024),
  })
  .strict()
  .refine(
    (v) =>
      v.mime_type === "application/pdf"
        ? /\.pdf$/i.test(v.original_filename)
        : /\.docx$/i.test(v.original_filename),
    "Choose a PDF or DOCX file",
  );
export type GuestCreate = z.infer<typeof guestCreateSchema>;
export const guestIdSchema = z.object({ id: z.string().uuid() }).strict();
