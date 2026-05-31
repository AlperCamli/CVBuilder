import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type {
  CurrentPlanSummary,
  SubscriptionRecord,
  UsageSummary,
  UserRecord
} from "../../shared/types/domain";
import type { PlanCode, ResolvedEntitlements } from "../entitlements/entitlements.types";

export type SessionContext = AuthenticatedRequestContext;

export interface BillingProviderSummary {
  provider: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
}

export interface BillingPlanResponseData {
  plan_code: PlanCode;
  subscription_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider: BillingProviderSummary;
  entitlement_summary: ResolvedEntitlements;
}

export interface BillingUsageResponseData extends UsageSummary {}

export interface BillingEntitlementsResponseData extends ResolvedEntitlements {}

export interface BillingSnapshot {
  user: UserRecord;
  subscription: SubscriptionRecord | null;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  entitlements: ResolvedEntitlements;
}

export interface CreateCheckoutInput {
  plan_code: string;
  success_url?: string;
  cancel_url?: string;
  // When explicitly false, the Pro checkout skips the free trial and bills the
  // user immediately. Defaults to true (trial granted if the user is eligible).
  with_trial?: boolean;
}

export interface CreateCheckoutResponseData {
  checkout_url: string;
  checkout_session_id: string;
  plan_code: PlanCode;
  plan_name: string;
  trial_applied: boolean;
  trial_period_days: number | null;
}

export interface CreatePortalInput {
  return_url?: string;
}

export interface CreatePortalResponseData {
  portal_url: string;
}

export interface BillingWebhookResponseData {
  received: true;
  event_id: string;
  event_type: string;
  processed: boolean;
}

export type GatedAction =
  | "tailored_cv_generation"
  | "export_pdf"
  | "export_docx"
  | "ai_action";
