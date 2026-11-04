import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CancelOfferAudience, CancelOfferRow, CancelOfferSubject, PromotionCohortRow, PromotionRecipientRow, PromotionRow, ResolvedPromotionToken } from "./promotions.types";

export interface PromotionsRepository {
  findByToken(token: string): Promise<ResolvedPromotionToken | null>;
  // Increments open_count and sets first_opened_at on the first open.
  recordOpen(recipient: PromotionRecipientRow): Promise<void>;
  // True when the account is paying, pending deletion, restricted or gone (same rules as promotion_email_queue).
  isAccountIneligible(userId: string): Promise<boolean>;
  // Sets redeemed_at once; false when the recipient was already redeemed or does not exist.
  markRedeemed(promotionId: string, userId: string, checkoutSessionId: string): Promise<boolean>;
  // Cancel-flow offers (docs/promotions/cancel-flow-offer.md).
  activeCancelPromotion(audience: CancelOfferAudience): Promise<PromotionRow | null>;
  findCancelOffer(promotionId: string, userId: string): Promise<CancelOfferRow | null>;
  hasAcceptedCancelOffer(userId: string): Promise<boolean>;
  // Inserts the row on the first show, else counts the show and points it at the current subscription.
  recordCancelOfferShown(subject: CancelOfferSubject): Promise<void>;
  // Sets declined_at on the account's unaccepted offer rows.
  recordCancelOfferDeclined(userId: string): Promise<void>;
  // Sets last_checkout_at when "Keep Pro" opens the offer's Stripe Checkout.
  recordCancelOfferCheckout(subject: CancelOfferSubject): Promise<void>;
  // Sets accepted_at once, creating the row if the show was not recorded.
  markCancelOfferAccepted(subject: CancelOfferSubject): Promise<void>;
}

const RECIPIENT_COLUMNS = "promotion_id,user_id,cohort_id,first_opened_at,open_count,redeemed_at,redeemed_checkout_session_id";
const PROMOTION_COLUMNS = "id,slug,name,percent_off,plan_codes,duration,duration_in_months,replaces_trial,stripe_coupon_id,archived_at";
const CANCEL_OFFER_COLUMNS = "promotion_id,user_id,provider_subscription_id,from_plan_code,show_count,declined_at,last_checkout_at,accepted_at";

export class SupabasePromotionsRepository implements PromotionsRepository {
  constructor(private readonly db: SupabaseClient) {}

  private check(error: { message: string } | null, message: string) {
    if (error) throw new InternalServerError(message, { reason: error.message });
  }

  async findByToken(token: string): Promise<ResolvedPromotionToken | null> {
    const { data: recipient, error } = await this.db.from("promotion_recipients").select(RECIPIENT_COLUMNS).eq("token", token).maybeSingle();
    this.check(error, "Could not resolve promotion");
    if (!recipient) return null;
    const [promotion, cohort] = await Promise.all([
      this.db.from("promotions").select(PROMOTION_COLUMNS).eq("id", recipient.promotion_id).maybeSingle(),
      this.db.from("promotion_cohorts").select("id,key,label,starts_at,ends_at").eq("id", recipient.cohort_id).maybeSingle()
    ]);
    this.check(promotion.error ?? cohort.error, "Could not resolve promotion");
    if (!promotion.data || !cohort.data) return null;
    return { recipient: recipient as PromotionRecipientRow, promotion: promotion.data as PromotionRow, cohort: cohort.data as PromotionCohortRow };
  }

  async recordOpen(recipient: PromotionRecipientRow): Promise<void> {
    // Compare-and-set on open_count: no RPC is needed and concurrent opens are not lost.
    let current: Pick<PromotionRecipientRow, "open_count" | "first_opened_at"> = recipient;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await this.db.from("promotion_recipients")
        .update({ open_count: current.open_count + 1, first_opened_at: current.first_opened_at ?? new Date().toISOString() })
        .eq("promotion_id", recipient.promotion_id).eq("user_id", recipient.user_id).eq("open_count", current.open_count)
        .select("open_count");
      this.check(error, "Could not record promotion open");
      if (data?.length) return;
      const reread = await this.db.from("promotion_recipients").select("open_count,first_opened_at")
        .eq("promotion_id", recipient.promotion_id).eq("user_id", recipient.user_id).maybeSingle();
      this.check(reread.error, "Could not record promotion open");
      if (!reread.data) return;
      current = reread.data;
    }
  }

  async isAccountIneligible(userId: string): Promise<boolean> {
    const [user, paying] = await Promise.all([
      this.db.from("users").select("deletion_requested_at,processing_restricted_at").eq("id", userId).maybeSingle(),
      this.db.from("subscriptions").select("id").eq("user_id", userId).in("status", ["active", "trialing", "past_due"]).neq("plan_code", "free").limit(1)
    ]);
    this.check(user.error ?? paying.error, "Could not resolve promotion eligibility");
    return !user.data || Boolean(user.data.deletion_requested_at || user.data.processing_restricted_at) || (paying.data?.length ?? 0) > 0;
  }

  async markRedeemed(promotionId: string, userId: string, checkoutSessionId: string): Promise<boolean> {
    const { data, error } = await this.db.from("promotion_recipients")
      .update({ redeemed_at: new Date().toISOString(), redeemed_checkout_session_id: checkoutSessionId })
      .eq("promotion_id", promotionId).eq("user_id", userId).is("redeemed_at", null)
      .select("user_id");
    this.check(error, "Could not record promotion redemption");
    return (data?.length ?? 0) > 0;
  }

  async activeCancelPromotion(audience: CancelOfferAudience): Promise<PromotionRow | null> {
    const { data, error } = await this.db.from("promotions").select(`${PROMOTION_COLUMNS},cancel_audience`)
      .eq("channel", "cancel_flow").eq("cancel_audience", audience).is("archived_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    this.check(error, "Could not resolve cancel offer");
    return (data as PromotionRow | null) ?? null;
  }

  async findCancelOffer(promotionId: string, userId: string): Promise<CancelOfferRow | null> {
    const { data, error } = await this.db.from("promotion_cancel_offers").select(CANCEL_OFFER_COLUMNS)
      .eq("promotion_id", promotionId).eq("user_id", userId).maybeSingle();
    this.check(error, "Could not resolve cancel offer");
    return (data as CancelOfferRow | null) ?? null;
  }

  async hasAcceptedCancelOffer(userId: string): Promise<boolean> {
    const { data, error } = await this.db.from("promotion_cancel_offers").select("user_id")
      .eq("user_id", userId).not("accepted_at", "is", null).limit(1);
    this.check(error, "Could not resolve cancel offer");
    return (data?.length ?? 0) > 0;
  }

  async recordCancelOfferShown(subject: CancelOfferSubject): Promise<void> {
    const row = { promotion_id: subject.promotionId, user_id: subject.userId, provider_subscription_id: subject.providerSubscriptionId, from_plan_code: subject.fromPlanCode };
    const inserted = await this.db.from("promotion_cancel_offers").upsert(row, { onConflict: "promotion_id,user_id", ignoreDuplicates: true }).select("user_id");
    this.check(inserted.error, "Could not record cancel offer");
    if (inserted.data?.length) return;
    // Already shown: a lost increment under concurrent shows only undercounts an analysis figure.
    const existing = await this.findCancelOffer(subject.promotionId, subject.userId);
    if (!existing) return;
    const { error } = await this.db.from("promotion_cancel_offers")
      .update({ show_count: existing.show_count + 1, last_shown_at: new Date().toISOString(), provider_subscription_id: subject.providerSubscriptionId, from_plan_code: subject.fromPlanCode })
      .eq("promotion_id", subject.promotionId).eq("user_id", subject.userId).is("accepted_at", null);
    this.check(error, "Could not record cancel offer");
  }

  async recordCancelOfferDeclined(userId: string): Promise<void> {
    const { error } = await this.db.from("promotion_cancel_offers").update({ declined_at: new Date().toISOString() })
      .eq("user_id", userId).is("accepted_at", null);
    this.check(error, "Could not record cancel offer");
  }

  async recordCancelOfferCheckout(subject: CancelOfferSubject): Promise<void> {
    const { error } = await this.db.from("promotion_cancel_offers").update({ last_checkout_at: new Date().toISOString() })
      .eq("promotion_id", subject.promotionId).eq("user_id", subject.userId);
    this.check(error, "Could not record cancel offer checkout");
  }

  async markCancelOfferAccepted(subject: CancelOfferSubject): Promise<void> {
    const now = new Date().toISOString();
    const updated = await this.db.from("promotion_cancel_offers")
      .update({ accepted_at: now, provider_subscription_id: subject.providerSubscriptionId, from_plan_code: subject.fromPlanCode })
      .eq("promotion_id", subject.promotionId).eq("user_id", subject.userId).is("accepted_at", null).select("user_id");
    this.check(updated.error, "Could not record cancel offer acceptance");
    if (updated.data?.length) return;
    const { error } = await this.db.from("promotion_cancel_offers").upsert({
      promotion_id: subject.promotionId, user_id: subject.userId, provider_subscription_id: subject.providerSubscriptionId,
      from_plan_code: subject.fromPlanCode, accepted_at: now
    }, { onConflict: "promotion_id,user_id", ignoreDuplicates: true });
    this.check(error, "Could not record cancel offer acceptance");
  }
}
