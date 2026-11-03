import type { Logger } from "pino";
import { ConflictError } from "../../shared/errors/app-error";
import type { RegionalPricingService } from "../billing/regional-pricing";
import type { PromotionsRepository } from "./promotions.repository";
import type {
  CheckoutPromotion,
  OfferResponseData,
  OfferStatus,
  PromotionCohortRow,
  PromotionUnavailableDetail,
  PromotionsCheckoutPort,
  ResolvedPromotionToken
} from "./promotions.types";

// Stripe's percent-off rounding, in minor units.
export const discountedAmount = (amount: number, percentOff: number): number => amount - Math.round((amount * percentOff) / 100);

const UNAVAILABLE_MESSAGES: Record<PromotionUnavailableDetail, string> = {
  ended: "This offer has ended.",
  upcoming: "This offer has not started yet.",
  wrong_account: "This offer belongs to a different account.",
  plan_not_eligible: "This offer does not apply to the selected plan.",
  redeemed: "This offer has already been used.",
  invalid: "This offer link is not valid."
};

// 409 for every failed promotion check; checkout never falls back to the full price on its own.
export const promotionUnavailable = (detail: PromotionUnavailableDetail) =>
  new ConflictError(UNAVAILABLE_MESSAGES[detail], { reason: "promotion_unavailable", detail });

// Each cohort's window is [starts_at, ends_at).
const windowStatus = (cohort: PromotionCohortRow, now: number): "active" | "upcoming" | "ended" => {
  if (now < Date.parse(cohort.starts_at)) return "upcoming";
  return now >= Date.parse(cohort.ends_at) ? "ended" : "active";
};

interface PromotionsServiceOptions {
  now?: () => number;
  logger?: Pick<Logger, "warn">;
}

export class PromotionsService implements PromotionsCheckoutPort {
  private readonly now: () => number;

  constructor(
    private readonly repository: PromotionsRepository,
    private readonly pricing: Pick<RegionalPricingService, "getPrices"> | null,
    private readonly options: PromotionsServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  async getOffer(token: string, country: string | null): Promise<OfferResponseData> {
    const found = await this.repository.findByToken(token);
    if (!found) return { status: "invalid", promotion: null, prices: null };
    try {
      await this.repository.recordOpen(found.recipient);
    } catch (error) {
      // Open tracking is for analysis only; it never blocks the offer.
      this.options.logger?.warn({ code: "PROMOTION_OPEN_NOT_RECORDED", reason: error instanceof Error ? error.message : "unknown" }, "Promotion open not recorded");
    }
    const { promotion, cohort, recipient } = found;
    const status = await this.offerStatus(found);
    return {
      status,
      promotion: {
        slug: promotion.slug, percent_off: promotion.percent_off, plan_codes: promotion.plan_codes, duration: promotion.duration,
        duration_in_months: promotion.duration_in_months, replaces_trial: promotion.replaces_trial, starts_at: cohort.starts_at, ends_at: cohort.ends_at
      },
      prices: await this.offerPrices(found, country, recipient.user_id)
    };
  }

  private async offerStatus({ recipient, promotion, cohort }: ResolvedPromotionToken): Promise<OfferStatus> {
    if (recipient.redeemed_at) return "redeemed";
    if (await this.repository.isAccountIneligible(recipient.user_id)) return "ineligible";
    return promotion.archived_at ? "ended" : windowStatus(cohort, this.now());
  }

  // The token owner's saved market, else the request country: the same market checkout will charge.
  private async offerPrices({ promotion }: ResolvedPromotionToken, country: string | null, userId: string): Promise<OfferResponseData["prices"]> {
    if (!this.pricing) return null;
    const prices = await this.pricing.getPrices(country, userId);
    if (!prices.available) return null;
    return {
      market: prices.market,
      currency: prices.currency,
      plans: prices.plans.filter(plan => promotion.plan_codes.includes(plan.code))
        .map(plan => ({ code: plan.code, amount: plan.amount, discounted_amount: discountedAmount(plan.amount, promotion.percent_off) }))
    };
  }

  async resolveForCheckout(userId: string, token: string, planCode: string): Promise<CheckoutPromotion> {
    const found = await this.repository.findByToken(token);
    if (!found) throw promotionUnavailable("invalid");
    const { recipient, promotion, cohort } = found;
    if (recipient.user_id !== userId) throw promotionUnavailable("wrong_account");
    if (recipient.redeemed_at) throw promotionUnavailable("redeemed");
    if (promotion.archived_at) throw promotionUnavailable("ended");
    const window = windowStatus(cohort, this.now());
    if (window !== "active") throw promotionUnavailable(window);
    if (!promotion.plan_codes.includes(planCode)) throw promotionUnavailable("plan_not_eligible");
    return {
      id: promotion.id, slug: promotion.slug, cohort_key: cohort.key, percent_off: promotion.percent_off,
      coupon_id: promotion.stripe_coupon_id, replaces_trial: promotion.replaces_trial
    };
  }

  markRedeemed(promotionId: string, userId: string, checkoutSessionId: string): Promise<boolean> {
    return this.repository.markRedeemed(promotionId, userId, checkoutSessionId);
  }
}
