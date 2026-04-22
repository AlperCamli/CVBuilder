import { z } from "zod";

const uuidSchema = z.string().uuid();

const aiJobSchema = z
  .object({
    company_name: z.string().trim().min(1).max(160),
    job_title: z.string().trim().min(1).max(160),
    job_description: z.string().trim().min(1).max(40000)
  })
  .strict();

const aiTailoredJobSchema = aiJobSchema
  .extend({
    job_posting_url: z.string().trim().url().max(2000).nullable().optional(),
    location_text: z.string().trim().max(240).nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional()
  })
  .strict();

const followUpAnswerSchema = z
  .object({
    question_id: z.string().trim().min(1).max(128),
    answer_text: z.string().trim().max(4000).nullable().optional(),
    selected_options: z.array(z.string().trim().min(1).max(200)).max(20).optional()
  })
  .strict();

const actionTypeSchema = z.enum([
  "improve",
  "summarize",
  "rewrite",
  "ats_optimize",
  "shorten",
  "expand",
  "options"
]);

const aiBlockTargetBaseSchema = z
  .object({
    tailored_cv_id: uuidSchema.optional(),
    master_cv_id: uuidSchema.optional()
  })
  .strict();

const hasExactlyOneTarget = (value: {
  tailored_cv_id?: string;
  master_cv_id?: string;
}): boolean => {
  return (value.tailored_cv_id ? 1 : 0) + (value.master_cv_id ? 1 : 0) === 1;
};

const aiBlockTargetSchema = aiBlockTargetBaseSchema.refine(hasExactlyOneTarget, {
  message: "Exactly one of tailored_cv_id or master_cv_id is required",
  path: ["tailored_cv_id"]
});

export const aiJobAnalysisSchema = z
  .object({
    master_cv_id: uuidSchema,
    job: aiJobSchema
  })
  .strict();

export const aiFollowUpQuestionsSchema = z
  .object({
    master_cv_id: uuidSchema,
    job: aiJobSchema,
    prior_analysis: z.record(z.unknown()).optional()
  })
  .strict();

export const aiTailoredDraftSchema = z
  .object({
    master_cv_id: uuidSchema,
    tailored_cv_id: uuidSchema.optional(),
    language: z.string().trim().min(2).max(16).optional(),
    template_id: uuidSchema.nullable().optional(),
    job: aiTailoredJobSchema,
    answers: z.array(followUpAnswerSchema).max(40)
  })
  .strict();

export const aiBlockSuggestSchema = z
  .object({
    block_id: z.string().trim().min(1).max(128),
    action_type: actionTypeSchema,
    user_instruction: z.string().trim().max(3000).nullable().optional()
  })
  .merge(aiBlockTargetBaseSchema)
  .strict()
  .refine(hasExactlyOneTarget, {
    message: "Exactly one of tailored_cv_id or master_cv_id is required",
    path: ["tailored_cv_id"]
  });

export const aiBlockCompareSchema = z
  .object({
    tailored_cv_id: uuidSchema,
    block_id: z.string().trim().min(1).max(128)
  })
  .strict();

export const aiBlockOptionsSchema = z
  .object({
    block_id: z.string().trim().min(1).max(128),
    user_instruction: z.string().trim().max(3000).nullable().optional(),
    option_count: z.number().int().min(2).max(6).optional()
  })
  .merge(aiBlockTargetBaseSchema)
  .strict()
  .refine(hasExactlyOneTarget, {
    message: "Exactly one of tailored_cv_id or master_cv_id is required",
    path: ["tailored_cv_id"]
  });

export const aiImportImproveSchema = z
  .object({
    parsed_content: z.record(z.unknown()),
    language: z.string().trim().min(2).max(16).optional(),
    improvement_guidance: z.array(z.string().trim().min(1).max(300)).max(20).optional()
  })
  .strict();

const tailoringRunFlowTypeSchema = z.enum([
  "job_analysis",
  "follow_up_questions",
  "tailored_draft"
]);

export const aiTailoringRunStartSchema = z
  .object({
    flow_type: tailoringRunFlowTypeSchema,
    input: z.record(z.unknown())
  })
  .strict()
  .superRefine((value, context) => {
    const parseInput =
      value.flow_type === "job_analysis"
        ? aiJobAnalysisSchema.safeParse(value.input)
        : value.flow_type === "follow_up_questions"
          ? aiFollowUpQuestionsSchema.safeParse(value.input)
          : aiTailoredDraftSchema.safeParse(value.input);

    if (!parseInput.success) {
      for (const issue of parseInput.error.issues) {
        context.addIssue({
          ...issue,
          path: ["input", ...issue.path]
        });
      }
    }
  });

export const aiRunIdParamsSchema = z
  .object({
    aiRunId: uuidSchema
  })
  .strict();

export const suggestionIdParamsSchema = z
  .object({
    suggestionId: uuidSchema
  })
  .strict();

export const tailoredCvAiHistoryParamsSchema = z
  .object({
    tailoredCvId: uuidSchema
  })
  .strict();

export const masterCvAiHistoryParamsSchema = z
  .object({
    masterCvId: uuidSchema
  })
  .strict();
