import { z } from "zod";
import { ValidationError } from "../../shared/errors/app-error";
import { formatZodError } from "../../shared/validation/format-zod-error";

// Shared with admin/ and the analytics SQL functions: docs/admin-analytics/api-contract.md.

export const DIMENSIONS = [
  "market",
  "plan",
  "locale",
  "ai_flow",
  "ai_model",
  "ai_provider",
  "template",
  "onboarding_path",
  "currency"
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const MAX_RANGE_DAYS = 1096;
export const MAX_FILTER_VALUES = 50;
const DEFAULT_RANGE_DAYS = 29;
const DAY_MS = 86_400_000;

export const metricNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Invalid metric name");

const dimensionSchema = z.enum(DIMENSIONS);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Invalid date");

const filterScalarSchema = z.union([z.string().max(200), z.number().finite(), z.boolean()]);

const filtersSchema = z.record(
  dimensionSchema,
  z.union([filterScalarSchema, z.array(filterScalarSchema).min(1).max(MAX_FILTER_VALUES)])
);

const filtersParamSchema = z
  .string()
  .max(10_000)
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "filters must be URL-encoded JSON" });
      return z.NEVER;
    }
  })
  .pipe(filtersSchema);

const metricQueryObjectSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  grain: z.enum(["day", "week", "month"]).default("day"),
  currency: z.enum(["native", "usd", "try"]).default("usd"),
  include_internal: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  breakdown: dimensionSchema.optional(),
  filters: filtersParamSchema.optional(),
  format: z.enum(["json", "csv"]).default("json")
});

export interface MetricMeta {
  title: string;
  definition: string;
  unit: "count" | "currency" | "percent" | "ratio" | "seconds" | "tokens";
  shape: "timeseries" | "breakdown" | "kpi" | "table" | "funnel" | "cohort";
  breakdowns: Dimension[];
  filters: Dimension[];
  kb?: string;
  consent_scoped?: boolean;
  alertable?: boolean;
  min_group?: number;
}

export interface CatalogEntry {
  name: string;
  kind: "metric" | "people";
  meta: MetricMeta;
}

export type MetricFilters = z.infer<typeof filtersSchema>;

export interface MetricParams {
  from: string;
  to: string;
  grain: "day" | "week" | "month";
  currency: "native" | "usd" | "try";
  includeInternal: boolean;
  breakdown: Dimension | null;
  filters: MetricFilters;
}

export interface MetricQuery {
  params: MetricParams;
  format: "json" | "csv";
}

const toDateString = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

export const parseMetricName = (raw: unknown): string => {
  const parsed = metricNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid metric name", formatZodError(parsed.error));
  }
  return parsed.data;
};

export const parseMetricQuery = (query: unknown, now: Date = new Date()): MetricQuery => {
  const parsed = metricQueryObjectSchema.safeParse(query);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", formatZodError(parsed.error));
  }

  const value = parsed.data;
  const to = value.to ?? toDateString(now.getTime());
  const from = value.from ?? toDateString(toMs(to) - DEFAULT_RANGE_DAYS * DAY_MS);
  const spanDays = (toMs(to) - toMs(from)) / DAY_MS;

  if (spanDays < 0) {
    throw new ValidationError("Validation failed", { issues: [{ path: "from", message: "from must be on or before to", code: "custom" }] });
  }
  if (spanDays > MAX_RANGE_DAYS) {
    throw new ValidationError("Validation failed", {
      issues: [{ path: "from", message: `Date range must not exceed ${MAX_RANGE_DAYS} days`, code: "custom" }]
    });
  }

  return {
    params: {
      from,
      to,
      grain: value.grain,
      currency: value.currency,
      includeInternal: value.include_internal,
      breakdown: value.breakdown ?? null,
      filters: value.filters ?? {}
    },
    format: value.format
  };
};
