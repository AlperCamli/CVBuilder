import type { BillingMarket, PurchasePlan } from "../billing/regional-pricing";

// Rows of the promotions tables (docs/promotions/spec.md §1). Only service_role reads them.
export interface PromotionRow {
  id: string;
  slug: string;
  name: string;
  percent_off: number;
  plan_codes: string[];
  duration: "once" | "repeating" | "forever";
  duration_in_months: number | null;
  replaces_trial: boolean;
  stripe_coupon_id: string;
  archived_at: string | null;
}

export interface PromotionCohortRow {
  id: string;
  key: string;
  label: string | null;
  starts_at: string;
  ends_at: string;
}

export interface PromotionRecipientRow {
  promotion_id: string;
  user_id: string;
  cohort_id: string;
  first_opened_at: string | null;
  open_count: number;
  redeemed_at: string | null;
  redeemed_checkout_session_id: string | null;
}

export interface ResolvedPromotionToken {
  recipient: PromotionRecipientRow;
  promotion: PromotionRow;
  cohort: PromotionCohortRow;
}

export type OfferStatus = "active" | "upcoming" | "ended" | "redeemed" | "ineligible" | "invalid";
export type PromotionUnavailableDetail = "ended" | "upcoming" | "wrong_account" | "plan_not_eligible" | "redeemed" | "invalid";

export interface OfferResponseData {
  status: OfferStatus;
  promotion: {
    slug: string;
    percent_off: number;
    plan_codes: string[];
    duration: PromotionRow["duration"];
    duration_in_months: number | null;
    replaces_trial: boolean;
    starts_at: string;
    ends_at: string;
  } | null;
  prices: {
    market: BillingMarket;
    currency: string;
    plans: Array<{ code: PurchasePlan; amount: number; discounted_amount: number }>;
  } | null;
}

// A validated promotion for one checkout.
export interface CheckoutPromotion {
  id: string;
  slug: string;
  cohort_key: string;
  percent_off: number;
  coupon_id: string;
  replaces_trial: boolean;
}

// What BillingService needs from promotions; checkout validation and webhook redemption.
export interface PromotionsCheckoutPort {
  resolveForCheckout(userId: string, token: string, planCode: string): Promise<CheckoutPromotion>;
  markRedeemed(promotionId: string, userId: string, checkoutSessionId: string): Promise<boolean>;
}
