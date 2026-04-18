import { z } from "zod";

const uuidSchema = z.string().uuid();
const jobStatusSchema = z.enum(["saved", "applied", "interviewing", "offered", "rejected", "archived"]);

export const jobIdParamSchema = z
  .object({
    jobId: uuidSchema
  })
  .strict();

export const updateJobSchema = z
  .object({
    company_name: z.string().trim().min(1).max(160).optional(),
    job_title: z.string().trim().min(1).max(160).optional(),
    job_description: z.string().trim().min(1).max(40000).optional(),
    job_posting_url: z.string().trim().url().max(2000).nullable().optional(),
    location_text: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional(),
    status: jobStatusSchema.optional()
  })
  .strict()
  .refine(
    (input) =>
      input.company_name !== undefined ||
      input.job_title !== undefined ||
      input.job_description !== undefined ||
      input.job_posting_url !== undefined ||
      input.location_text !== undefined ||
      input.notes !== undefined ||
      input.status !== undefined,
    {
      message: "At least one field must be provided"
    }
  );

export const createJobSchema = z
  .object({
    company_name: z.string().trim().min(1).max(160),
    job_title: z.string().trim().min(1).max(160),
    job_description: z.string().trim().min(1).max(40000),
    job_posting_url: z.string().trim().url().max(2000).nullable().optional(),
    location_text: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional(),
    status: jobStatusSchema.optional()
  })
  .strict();
