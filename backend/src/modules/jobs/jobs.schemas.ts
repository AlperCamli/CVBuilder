import { z } from "zod";

const uuidSchema = z.string().uuid();
const jobStatusSchema = z.enum(["saved", "applied", "interview", "offer", "rejected", "archived"]);
const sortBySchema = z.enum([
  "created_at",
  "updated_at",
  "company_name",
  "job_title",
  "status",
  "applied_at"
]);

const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

const intQuerySchema = (min: number, max: number) =>
  z.union([z.number().int().min(min).max(max), z.string().trim().regex(/^\d+$/)]).transform(Number);

export const jobIdParamSchema = z
  .object({
    jobId: uuidSchema
  })
  .strict();

export const listJobsQuerySchema = z
  .object({
    status: jobStatusSchema.optional(),
    search: z.string().trim().min(1).max(240).optional(),
    sort_by: sortBySchema.optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
    linked_tailored_cv: booleanQuerySchema.optional(),
    page: intQuerySchema(1, 100000).optional(),
    limit: intQuerySchema(1, 100).optional()
  })
  .strict();

export const jobsBoardQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(240).optional(),
    sort_by: sortBySchema.optional(),
    sort_order: z.enum(["asc", "desc"]).optional(),
    linked_tailored_cv: booleanQuerySchema.optional()
  })
  .strict();

export const updateJobSchema = z
  .object({
    company_name: z.string().trim().min(1).max(160).optional(),
    job_title: z.string().trim().min(1).max(160).optional(),
    job_description: z.string().trim().min(1).max(40000).optional(),
    job_posting_url: z.string().trim().url().max(2000).nullable().optional(),
    location_text: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.company_name !== undefined ||
      input.job_title !== undefined ||
      input.job_description !== undefined ||
      input.job_posting_url !== undefined ||
      input.location_text !== undefined ||
      input.notes !== undefined,
    {
      message: "At least one field must be provided"
    }
  );

export const updateJobStatusSchema = z
  .object({
    status: jobStatusSchema
  })
  .strict();

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
