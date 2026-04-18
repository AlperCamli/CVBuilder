import type { UsageCounterRecord } from "../../shared/types/domain";

export type PlanCode = "free" | "pro";

export interface UsageLimits {
  tailored_cv_generations: number | null;
  exports: number | null;
  ai_actions: number | null;
  storage_bytes: number | null;
}

export interface UsageRemaining {
  tailored_cv_generations: number | null;
  exports: number | null;
  ai_actions: number | null;
  storage_bytes: number | null;
}

export interface PlanFeatures {
  can_generate_tailored_cv: boolean;
  can_export_pdf: boolean;
  can_export_docx: boolean;
  can_use_ai_actions: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  limits: UsageLimits;
  features: PlanFeatures;
  stripe_price_id: string | null;
}

export type PlanCatalog = Record<PlanCode, PlanDefinition>;

export interface ResolvedEntitlements {
  plan_code: PlanCode;
  can_generate_tailored_cv: boolean;
  can_export_pdf: boolean;
  can_export_docx: boolean;
  can_use_ai_actions: boolean;
  limits: UsageLimits;
  remaining: UsageRemaining;
}

export interface UsageResolution {
  plan_code: PlanCode;
  period_month: string;
  tailored_cv_generations_count: number;
  exports_count: number;
  ai_actions_count: number;
  storage_bytes_used: number;
  limits: UsageLimits;
  remaining: UsageRemaining;
}

export interface SubscriptionLike {
  plan_code: string;
  status: string;
}

export type GatedAction =
  | "tailored_cv_generation"
  | "export_pdf"
  | "export_docx"
  | "ai_action";

export interface EntitlementDecision {
  allowed: boolean;
  action: GatedAction;
  reason: string | null;
}

export interface PlanUsageInput {
  usage: UsageCounterRecord;
  plan_code: PlanCode;
}
