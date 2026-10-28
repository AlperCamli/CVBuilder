import { z } from "zod";
import { ValidationError } from "../../shared/errors/app-error";
import { formatZodError } from "../../shared/validation/format-zod-error";
import { DIMENSIONS, MAX_FILTER_VALUES, metricNameSchema } from "./admin-analytics.contract";

// Phase 5 request shapes (docs/admin-analytics/api-contract.md "Phase 5"). The database validates every rule again
// (metric alertable, measure numeric, filters accepted by the metric) and raises 22023; these schemas reject the
// malformed requests before any call.

export const ALERT_WINDOWS = ["today", "1d", "7d", "30d"] as const;
export const ALERT_CONDITIONS = ["gt", "lt", "pct_change_gt", "pct_change_lt"] as const;
export const ALERT_EVENTS_DEFAULT_LIMIT = 50;
export const ALERT_EVENTS_MAX_LIMIT = 200;
export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 500;

const filterScalarSchema = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

const ruleParamsSchema = z
  .object({
    currency: z.enum(["native", "usd", "try"]).optional(),
    include_internal: z.boolean().optional(),
    filters: z
      .record(z.enum(DIMENSIONS), z.union([filterScalarSchema, z.array(filterScalarSchema).min(1).max(MAX_FILTER_VALUES)]))
      .optional()
  })
  .strict()
  .refine((params) => JSON.stringify(params).length <= 2_000, "params are too large");

const ruleFields = {
  name: z
    .string()
    .max(1_000)
    .transform((value) => value.trim())
    .pipe(z.string().min(1, "name must be 1 to 120 characters").max(120, "name must be 1 to 120 characters")),
  metric: metricNameSchema,
  measure: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Invalid measure name"),
  params: ruleParamsSchema,
  window: z.enum(ALERT_WINDOWS),
  condition: z.enum(ALERT_CONDITIONS),
  threshold: z.number().finite(),
  cooldown_hours: z.number().int().min(1).max(720),
  enabled: z.boolean()
};

// `today` is a partial day: a % change against the whole previous day would fire every morning.
const pctChangeNeedsCompleteWindow = (rule: { window?: string; condition?: string }) =>
  !(rule.window === "today" && rule.condition?.startsWith("pct_change"));
const pctChangeIssue = { message: "% change conditions need a complete window (1d, 7d or 30d)", path: ["condition"] };

const ruleCreateSchema = z
  .object({
    ...ruleFields,
    params: ruleFields.params.optional(),
    cooldown_hours: ruleFields.cooldown_hours.optional(),
    enabled: ruleFields.enabled.optional()
  })
  .strict()
  .refine(pctChangeNeedsCompleteWindow, pctChangeIssue);

// PATCH: any subset of the fields (params replaces the stored params as a whole). The merged rule is validated by the
// database, including the window/condition combination.
const rulePatchSchema = z
  .object({
    name: ruleFields.name.optional(),
    metric: ruleFields.metric.optional(),
    measure: ruleFields.measure.optional(),
    params: ruleFields.params.optional(),
    window: ruleFields.window.optional(),
    condition: ruleFields.condition.optional(),
    threshold: ruleFields.threshold.optional(),
    cooldown_hours: ruleFields.cooldown_hours.optional(),
    enabled: ruleFields.enabled.optional()
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "At least one field is required")
  .refine(pctChangeNeedsCompleteWindow, pctChangeIssue);

export type AlertRuleInput = z.infer<typeof ruleCreateSchema>;
export type AlertRulePatch = z.infer<typeof rulePatchSchema>;
export type AlertEventStatus = "open" | "all";

const parseWith = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", formatZodError(parsed.error));
  }
  return parsed.data;
};

export const parseAlertRuleInput = (body: unknown): AlertRuleInput => parseWith(ruleCreateSchema, body ?? {});
export const parseAlertRulePatch = (body: unknown): AlertRulePatch => parseWith(rulePatchSchema, body ?? {});

export const parseAlertRuleId = (raw: unknown): string => parseWith(z.string().uuid("Invalid rule id"), raw);

// Event ids are bigint identities; kept as text so they never lose precision.
export const parseAlertEventId = (raw: unknown): string =>
  parseWith(z.string().regex(/^[1-9][0-9]{0,17}$/, "Invalid event id"), raw);

const limitParam = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^[0-9]{1,4}$/, "limit must be an integer")
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .optional()
    .transform((value) => value ?? fallback);

const eventsQuerySchema = z.object({
  status: z.enum(["open", "all"]).default("open"),
  limit: limitParam(ALERT_EVENTS_MAX_LIMIT, ALERT_EVENTS_DEFAULT_LIMIT)
});

export const parseAlertEventsQuery = (query: unknown): { status: AlertEventStatus; limit: number } =>
  parseWith(eventsQuerySchema, query ?? {});

const auditQuerySchema = z.object({ limit: limitParam(AUDIT_MAX_LIMIT, AUDIT_DEFAULT_LIMIT) });

export const parseAuditQuery = (query: unknown): { limit: number } => parseWith(auditQuerySchema, query ?? {});
