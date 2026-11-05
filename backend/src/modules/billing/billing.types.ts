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
  app_access: boolean;
  can_edit_existing_cvs: boolean;
  subscription_required: boolean;
  plan_code: PlanCode;
  subscription_status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  // A plan change waiting for the end of the paid period (a downgrade, or the paid-weekly cancel offer's switch).
  scheduled_change: { plan_code: string; starts_at: string } | null;
  // True only when a checkout of the trial plan (the one GET /billing/prices reports with trial_days > 0) would still
  // grant the free trial (trials enabled and an unused transition grant or first trial exists). Lets the UI swap the trial CTA for a plain
  // "subscribe" CTA once the trial has been consumed.
  trial_eligible: boolean;
  trial_transition: { eligible: boolean } | null;
  // One-time allowances of accounts without a trial or Pro (always true when no subscription is required).
  free_tier: { tailoring_available: boolean; improve_available: boolean };
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
  pricing_quote?: string;
  plan_code: string;
  success_url?: string;
  cancel_url?: string;
  // Clients send an explicit boolean. true asks for the free trial, which is on the plan whose catalog entry has
  // trial_supported (Monthly since 2026-11-05; Weekly before): granted if the user is eligible, refused with 409
  // trial_unavailable (details.trial_plan_code names the trial plan) on any other plan. false is a paid checkout.
  // Omitted (transitional, pre-2026-11-05 bundles; see wantsTrial): a trial request on Weekly, refused with 409
  // trial_unavailable, and a paid checkout on Monthly and Annual.
  with_trial?: boolean;
  // The browser's IANA time zone, for the trial end date shown at Stripe.
  time_zone?: string;
  // A promotion link token (?promo=); checkout fails with 409 promotion_unavailable rather than charge full price.
  promotion_token?: string;
}

export interface CreateCheckoutResponseData {
  currency?: string;
  amount?: number;
  checkout_url: string;
  checkout_session_id: string;
  plan_code: PlanCode;
  plan_name: string;
  trial_applied: boolean;
  trial_period_days: number | null;
  // amount_due: the discounted first payment in minor units (null without regional pricing).
  promotion?: { slug: string; percent_off: number; amount_due: number | null };
}

export interface CreatePortalInput {
  return_url?: string;
  // Opens the portal on the cancellation, payment-method or plan-change (upgrade) step instead of its home page.
  flow?: "cancel" | "payment_method" | "change_plan";
  // The plan to change to, for flow "change_plan".
  plan_code?: "weekly" | "monthly" | "annual";
}

export interface CreatePortalResponseData {
  portal_url: string;
}

export type { CancelOfferAudience } from "../promotions/promotions.types";

// The offer on the cancel screen (docs/promotions/cancel-flow-offer.md). Amounts are minor units of currency.
// kind: checkout = a trial (Monthly, or a Weekly trial started before 2026-11-05) pays the discounted first period of
// plan_code now, then the trial ends without ever being charged; switch_at_period_end = paid
// weekly moves to plan_code at period_end with its first invoice discounted; renewal_discount = the next renewal of
// the current plan (at period_end) is discounted.
export interface CancelOffer {
  kind: "checkout" | "switch_at_period_end" | "renewal_discount";
  slug: string;
  percent_off: number;
  plan_code: "weekly" | "monthly" | "annual";
  currency: string;
  // The promoted plan's list price, and the discounted charge.
  amount: number;
  discounted_amount: number;
  // The current plan (for a trial: the plan it would convert to) and its list price, for comparison.
  current_plan_code: "weekly" | "monthly" | "annual";
  current_amount: number | null;
  // The end of the current trial or paid period.
  period_end: string;
}

export type CancelOfferResponseData =
  | { status: "available"; offer: CancelOffer }
  | { status: "unavailable"; offer: null };

export interface AcceptCancelOfferResponseData {
  accepted: true;
  offer: CancelOffer;
  plan: BillingPlanResponseData;
}

export interface CreateCancelOfferCheckoutInput {
  success_url?: string;
  cancel_url?: string;
}

// amount_due: the discounted first month charged at Stripe now; amount: the monthly price after it.
export interface CancelOfferCheckoutResponseData {
  checkout_url: string;
  checkout_session_id: string;
  currency: string;
  amount: number;
  amount_due: number;
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
