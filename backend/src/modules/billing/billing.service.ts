import { createHash } from "node:crypto";
import type { RegionalPricingService, PurchasePlan } from "./regional-pricing";
import {
  ConflictError,
  BillingConfigurationError,
  BillingPlanValidationError,
  BillingProviderError,
  BillingWebhookSignatureError,
  EntitlementExceededError,
  NotFoundError,
  ValidationError
} from "../../shared/errors/app-error";
import type { CurrentPlanSummary, UserRecord, SubscriptionRecord } from "../../shared/types/domain";
import type { UsersRepository } from "../users/users.repository";
import type { EntitlementsService } from "../entitlements/entitlements.service";
import type { PlanCode, PlanDefinition, ResolvedEntitlements } from "../entitlements/entitlements.types";
import type { UsageService } from "../usage/usage.service";
import type { FreeTierUse } from "../usage/usage.repository";
import { surfaceForAction, trialRequiredError, type AccessAction, type AppRequestPolicy, type PaywallSurface } from "../entitlements/access-policy";
import type {
  AcceptCancelOfferResponseData,
  BillingEntitlementsResponseData,
  CancelOffer,
  CancelOfferAudience,
  CancelOfferCheckoutResponseData,
  CancelOfferResponseData,
  CreateCancelOfferCheckoutInput,
  BillingPlanResponseData,
  BillingSnapshot,
  BillingUsageResponseData,
  CreateCheckoutInput,
  CreateCheckoutResponseData,
  CreatePortalInput,
  CreatePortalResponseData,
  BillingWebhookResponseData,
  GatedAction
} from "./billing.types";
import type {
  BillingSubscriptionsRepository,
  TrialTransitionGrant,
  SyncSubscriptionInput
} from "./subscriptions.repository";
import {
  replacedByOf,
  toSubscriptionDetails,
  trialEndLabel,
  trialSubmitMessage,
  type StripeCheckoutSessionSummary,
  type StripeGateway,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent
} from "./stripe-gateway";
import type { CheckoutOutcome, DenialReason, MonetizationRepository } from "../monetization/monetization.repository";
import type { CancelOffersPort, CheckoutPromotion, PromotionsCheckoutPort } from "../promotions/promotions.types";
import { discountedAmount } from "../promotions/promotions.service";

interface BillingServiceOptions {
  requireSubscription?: boolean;
  regionalPricing?: RegionalPricingService;
  provider: "stripe";
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  portalReturnUrl: string;
  stripeWebhookSecret: string | null;
  trialPeriodDays: number;
  monetization?: MonetizationRepository;
  promotions?: PromotionsCheckoutPort;
  cancelOffers?: CancelOffersPort;
}

// Which gate refused the request, for paywall analysis.
export interface DeniedGate {
  action: AccessAction;
  surface?: PaywallSurface;
}

// A consumed one-time allowance; released when the operation fails before delivering anything.
export interface FreeUseClaim {
  use: FreeTierUse;
  claimed_at: string;
}

const FREE_USE_SPENT: Record<FreeTierUse, string> = {
  tailoring: "You've used your free tailored CV. Start your free 3-day trial to tailor your CV for more jobs.",
  improve: "You've used your free AI improvement. Start your free 3-day trial to unlock every AI feature."
};

const checkoutRejection = (error: unknown): CheckoutOutcome => {
  const reason = error instanceof ConflictError ? error.details?.reason : undefined;
  if (reason === "checkout_pending") return "rejected_pending";
  if (reason === "subscription_active") return "rejected_active";
  if (reason === "pricing_changed") return "rejected_pricing_changed";
  return "failed";
};

const HALF_HOUR_MS = 30 * 60_000;
// The trial offer's checkout can stay open up to 90 minutes, so offers need the period to outlast that.
const OFFER_MIN_PERIOD_LEFT_MS = 2 * 60 * 60_000;
// A downgrade has to be scheduled before the renewal invoice is drafted.
const PLAN_CHANGE_MIN_PERIOD_LEFT_MS = 60 * 60_000;
// Longer is an upgrade: weekly < monthly < annual.
const PLAN_RANK: Record<PurchasePlan, number> = { weekly: 1, monthly: 2, annual: 3 };

/** A plan change still waiting for the end of the paid period (the metadata keeps it after the switch). */
export const pendingChange = (subscription: Pick<SubscriptionRecord, "plan_code" | "scheduled_plan_code" | "scheduled_change_at">): { plan_code: string; starts_at: string } | null =>
  subscription.scheduled_plan_code && subscription.scheduled_change_at && subscription.scheduled_plan_code !== subscription.plan_code
    && Date.parse(subscription.scheduled_change_at) > Date.now()
    ? { plan_code: subscription.scheduled_plan_code, starts_at: subscription.scheduled_change_at }
    : null;

// Stripe keeps these subscriptions; the customer fixes them in the billing portal, not with a new checkout.
const BILLING_ISSUE_STATUSES = new Set(["past_due", "unpaid", "paused"]);

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const normalizeMetadata = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  const metadata: Record<string, string> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      metadata[key] = item;
    }
  }

  return metadata;
};

const toIsoFromUnixSeconds = (value: unknown): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const resolveObjectId = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "id" in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" ? id : null;
  }

  return null;
};

// Webhooks arrive in the endpoint's API version (2026-03-25.dahlia), where the billing period is on each subscription
// item instead of the subscription (moved in 2025-03-31.basil); the SDK still reads 2024-06-20. Items only differ under
// flexible billing: the earliest start and latest end span every item, so access lasts until the last paid item ends.
const itemPeriod = (itemRows: unknown[], key: "current_period_start" | "current_period_end"): number | null => {
  const values = itemRows.map((item) => asRecord(item)[key]).filter((value): value is number => typeof value === "number" && value > 0);
  if (!values.length) return null;
  return key === "current_period_start" ? Math.min(...values) : Math.max(...values);
};

interface ParsedWebhookCheckoutSession extends StripeCheckoutSessionSummary {
  mode: string | null;
}

const parseCheckoutSessionFromWebhookObject = (
  object: unknown
): ParsedWebhookCheckoutSession | null => {
  const row = asRecord(object);
  const id = typeof row.id === "string" ? row.id : null;

  if (!id) {
    return null;
  }

  return {
    id,
    url: typeof row.url === "string" ? row.url : null,
    amount_total: typeof row.amount_total === "number" ? row.amount_total : null,
    currency: typeof row.currency === "string" ? row.currency : null,
    customer_id: resolveObjectId(row.customer),
    subscription_id: resolveObjectId(row.subscription),
    metadata: normalizeMetadata(row.metadata),
    mode: typeof row.mode === "string" ? row.mode : null
  };
};

const parseSubscriptionFromWebhookObject = (object: unknown): StripeSubscriptionSummary | null => {
  const row = asRecord(object);
  const id = typeof row.id === "string" ? row.id : null;
  const customerId = resolveObjectId(row.customer);

  if (!id || !customerId) {
    return null;
  }

  const items = asRecord(row.items);
  const itemRows = Array.isArray(items.data) ? items.data : [];

  const priceIds = itemRows
    .map((item) => {
      const itemRecord = asRecord(item);
      const price = asRecord(itemRecord.price);
      return typeof price.id === "string" ? price.id : null;
    })
    .filter((item): item is string => Boolean(item));

  return {
    id,
    customer_id: customerId,
    status: typeof row.status === "string" ? row.status : "inactive",
    trial_start: toIsoFromUnixSeconds(row.trial_start),
    details: toSubscriptionDetails(row),
    cancel_at_period_end: Boolean(row.cancel_at_period_end),
    current_period_start: toIsoFromUnixSeconds(row.current_period_start ?? itemPeriod(itemRows, "current_period_start")),
    current_period_end: toIsoFromUnixSeconds(row.current_period_end ?? itemPeriod(itemRows, "current_period_end")),
    metadata: normalizeMetadata(row.metadata),
    replaced_by: replacedByOf(row),
    price_ids: priceIds
  };
};

export class BillingService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: BillingSubscriptionsRepository,
    private readonly usageService: UsageService,
    private readonly entitlementsService: EntitlementsService,
    private readonly stripeGateway: StripeGateway | null,
    private readonly options: BillingServiceOptions
  ) {}

  async cancelCheckout(userId: string) {
    const sessionId = await this.options.regionalPricing?.cancelCheckout(userId);
    if (sessionId) await this.options.monetization?.resolveCheckoutAttempt(sessionId, "canceled");
    return { cancelled: true };
  }

  async getPrices(country: string | null, userId?: string) {
    if (!this.options.regionalPricing) throw new BillingConfigurationError("Regional pricing is not configured");
    return this.options.regionalPricing.getPrices(country, userId);
  }

  private validateReturnUrl(url: string | undefined, fallback: string): string {
    const resolved = url ?? fallback;
    if (new URL(resolved).origin !== new URL(fallback).origin) throw new ValidationError("Invalid billing return URL");
    return resolved;
  }

  async getBillingPlan(userId: string): Promise<BillingPlanResponseData> {
    const [snapshot, transition, markers] = await Promise.all([
      this.getSnapshot(userId), this.subscriptionsRepository.getTrialTransitionGrant(userId), this.usageService.getFreeTierMarkers(userId)
    ]);
    const trialEligible = await this.isUserTrialEligible(userId, transition);
    const requireSubscription = this.options.requireSubscription === true;

    return {
      app_access: !requireSubscription || this.subscriptionAllowsAccess(snapshot.subscription),
      subscription_required: requireSubscription,
      // Every account keeps its manual workspace; Pro adds exports, AI and repeated tailoring.
      can_edit_existing_cvs: true,
      plan_code: snapshot.current_plan.plan_code as PlanCode,
      subscription_status: snapshot.current_plan.status,
      current_period_start: snapshot.current_plan.current_period_start,
      current_period_end: snapshot.current_plan.current_period_end,
      cancel_at_period_end: snapshot.current_plan.cancel_at_period_end,
      scheduled_change: snapshot.subscription ? pendingChange(snapshot.subscription) : null,
      trial_eligible: trialEligible,
      trial_transition: transition ? { eligible: trialEligible } : null,
      free_tier: {
        tailoring_available: !requireSubscription || markers.tailoring === null,
        improve_available: !requireSubscription || markers.improve === null
      },
      provider: {
        provider: snapshot.subscription?.provider ?? this.options.provider,
        provider_customer_id: snapshot.subscription?.provider_customer_id ?? null,
        provider_subscription_id: snapshot.subscription?.provider_subscription_id ?? null
      },
      entitlement_summary: snapshot.entitlements
    };
  }

  // Whether starting checkout right now would grant the free trial: trials must
  // be enabled and either the release grant or the normal first trial must be unused.
  // Shared by the checkout flow and the billing-plan endpoint so the UI's CTA
  // label ("Start 3-day free trial" vs "Start your subscription") always matches
  // what checkout will actually do.
  private async isUserTrialEligible(userId: string, grant?: TrialTransitionGrant | null): Promise<boolean> {
    if (this.options.trialPeriodDays <= 0) {
      return false;
    }

    const transition = grant === undefined ? await this.subscriptionsRepository.getTrialTransitionGrant(userId) : grant;
    if (transition) return transition.redeemed_at === null;
    return !(await this.subscriptionsRepository.hasUsedTrial(userId));
  }

  async getBillingUsage(userId: string): Promise<BillingUsageResponseData> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.usage_summary;
  }

  async getBillingEntitlements(userId: string): Promise<BillingEntitlementsResponseData> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.entitlements;
  }

  async getCurrentPlanSummary(userId: string): Promise<CurrentPlanSummary> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.current_plan;
  }

  async getUsageSummary(userId: string): Promise<BillingUsageResponseData> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.usage_summary;
  }

  async getResolvedEntitlements(userId: string): Promise<ResolvedEntitlements> {
    const snapshot = await this.getSnapshot(userId);
    return snapshot.entitlements;
  }

  async assertActionAllowed(userId: string, action: GatedAction): Promise<void> {
    await this.assertSubscriptionAccess(userId, { action });
    const snapshot = await this.getSnapshot(userId);
    const decision = this.entitlementsService.evaluateAction(action, snapshot.entitlements);

    if (!decision.allowed) {
      await this.options.monetization?.recordEntitlementDenial({ user_id: userId, plan_code: snapshot.current_plan.plan_code, action, reason: "free_limit" });
      throw new EntitlementExceededError(decision.reason ?? "Usage limit exceeded", {
        action,
        plan_code: snapshot.current_plan.plan_code,
        limits: snapshot.entitlements.limits,
        remaining: snapshot.entitlements.remaining
      });
    }
  }

  async assertSubscriptionAccess(userId: string, gate: DeniedGate = { action: "app_access" }): Promise<void> {
    if (!this.options.requireSubscription) return;
    const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (!this.subscriptionAllowsAccess(subscription)) {
      await this.denyAccess(userId, subscription, gate.action, gate.surface ?? surfaceForAction(gate.action));
    }
  }

  // Route-level gate for the application API; the route map lives in classifyAppRequest.
  async authorizeAppRequest(userId: string, policy: AppRequestPolicy, isFreeSession: (sessionId: string) => Promise<boolean>): Promise<void> {
    if (!this.options.requireSubscription || policy.kind === "free" || policy.kind === "free_use") return;
    const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (this.subscriptionAllowsAccess(subscription)) return;
    if (policy.kind === "free_session") {
      if (await isFreeSession(policy.session_id)) return;
      await this.denyAccess(userId, subscription, "tailored_cv_generation", "tailoring");
    }
    if (policy.kind === "paid") await this.denyAccess(userId, subscription, policy.action, policy.surface);
  }

  // Starts a one-time free use for an account without a trial or Pro. Returns null when nothing
  // is consumed (trial/Pro, or no subscription required); the marker is claimed atomically.
  async claimFreeUse(userId: string, use: FreeTierUse): Promise<FreeUseClaim | null> {
    const action = use === "tailoring" ? "tailored_cv_generation" : "ai_action";
    if (this.options.requireSubscription) {
      const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);
      if (!this.subscriptionAllowsAccess(subscription)) {
        const claimedAt = await this.usageService.claimFreeTierUse(userId, use);
        if (claimedAt) return { use, claimed_at: claimedAt };
        await this.denyAccess(userId, subscription, action, surfaceForAction(action), FREE_USE_SPENT[use]);
      }
    }
    await this.assertActionAllowed(userId, action);
    return null;
  }

  // True when the account is held to the free tier: a subscription is required and it has no
  // trial or Pro. Its free tailoring session then has limited AI steps (TailoringService).
  async isFreeTierLimited(userId: string): Promise<boolean> {
    if (!this.options.requireSubscription) return false;
    return !this.subscriptionAllowsAccess(await this.subscriptionsRepository.getCurrentForUser(userId));
  }

  // Refuses an AI step on the free tailoring session (finished, or its AI rewrites used up).
  async denyFreeSessionAi(userId: string, message: string): Promise<never> {
    const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);
    return this.denyAccess(userId, subscription, "ai_action", "ai", message);
  }

  async releaseFreeUse(userId: string, claim: FreeUseClaim | null): Promise<void> {
    if (claim) await this.usageService.releaseFreeTierUse(userId, claim.use, claim.claimed_at);
  }

  private async denyAccess(userId: string, subscription: SubscriptionRecord | null, action: AccessAction, surface: PaywallSurface, message?: string): Promise<never> {
    await this.options.monetization?.recordEntitlementDenial({
      user_id: userId,
      plan_code: this.entitlementsService.resolveEffectivePlanCode(subscription),
      action,
      surface,
      reason: this.denialReason(subscription)
    });
    throw trialRequiredError(action, surface, message);
  }

  private denialReason(subscription: SubscriptionRecord | null): DenialReason {
    if (!subscription?.provider_subscription_id) return "no_subscription";
    return subscription.status === "trialing" ? "trial_expired" : "subscription_inactive";
  }

  private subscriptionAllowsAccess(subscription: SubscriptionRecord | null): boolean {
    if (!subscription || this.entitlementsService.resolveEffectivePlanCode(subscription) === "free") return false;
    // A delayed webhook must not extend a three-day trial indefinitely. Stripe's fixed trial end bounds a row
    // that has no period end, rather than denying a trial still running.
    if (subscription.status === "trialing") {
      const end = Date.parse(subscription.current_period_end ?? subscription.trial_end ?? "");
      if (!Number.isFinite(end) || end <= Date.now()) return false;
    }
    return true;
  }

  async confirmCheckout(userId: string, sessionId: string): Promise<BillingPlanResponseData> {
    const gateway = this.requireStripeGateway();
    if (!gateway.retrieveCheckoutSession) throw new BillingConfigurationError("Checkout confirmation is unavailable");
    const session = await gateway.retrieveCheckoutSession(sessionId);
    if (!session || session.metadata.app_user_id !== userId) throw new NotFoundError("Checkout session not found");
    if (session.status !== "complete" || !session.subscription_id || !["paid", "no_payment_required"].includes(session.payment_status ?? "")) {
      throw new ConflictError("Your payment is not complete. Please finish checkout or try again.");
    }
    const subscription = await gateway.retrieveSubscription(session.subscription_id);
    if (!subscription || subscription.customer_id !== session.customer_id || subscription.metadata.app_user_id !== userId) {
      throw new NotFoundError("Subscription not found");
    }
    if (!["active", "trialing"].includes(subscription.status)) throw new ConflictError("Your subscription is still being confirmed. Please try again.");
    await this.requireUser(userId);
    await this.syncStripeSubscription(userId, subscription);
    return this.getBillingPlan(userId);
  }

  async recordTailoredCvGenerationUsage(userId: string): Promise<void> {
    await this.usageService.incrementTailoredCvGeneration(userId);
  }

  async recordExportUsage(userId: string, storageBytesDelta: number): Promise<void> {
    await this.usageService.incrementExport(userId, storageBytesDelta);
  }

  async recordAiActionUsage(userId: string): Promise<void> {
    await this.usageService.incrementAiAction(userId);
  }

  async createCheckoutSession(
    userId: string,
    input: CreateCheckoutInput,
    country: string | null = null
  ): Promise<CreateCheckoutResponseData> {
    const trialRequested = input.with_trial !== false;
    try {
      const { response, market, promotion } = await this.openCheckoutSession(userId, input, country);
      await this.options.monetization?.recordCheckoutAttempt({
        user_id: userId,
        plan_code: response.plan_code,
        market,
        currency: response.currency ?? null,
        amount: response.amount ?? null,
        trial_requested: trialRequested,
        trial_applied: response.trial_applied,
        checkout_session_id: response.checkout_session_id,
        outcome: "open",
        ...(promotion ? { promotion_id: promotion.id } : {})
      });
      return response;
    } catch (error) {
      await this.options.monetization?.recordCheckoutAttempt({
        user_id: userId,
        plan_code: input.plan_code.trim().toLowerCase().slice(0, 40),
        market: null,
        currency: null,
        amount: null,
        trial_requested: trialRequested,
        trial_applied: false,
        checkout_session_id: null,
        outcome: checkoutRejection(error)
      });
      throw error;
    }
  }

  private async openCheckoutSession(
    userId: string,
    input: CreateCheckoutInput,
    country: string | null
  ): Promise<{ response: CreateCheckoutResponseData; market: string | null; promotion: CheckoutPromotion | null }> {
    const user = await this.requireUser(userId);
    const stripeGateway = this.requireStripeGateway();
    const plan = this.requirePurchasablePlan(input.plan_code);

    const successUrl = this.validateReturnUrl(input.success_url, this.options.checkoutSuccessUrl);
    const cancelUrl = this.validateReturnUrl(input.cancel_url, this.options.checkoutCancelUrl);
    const active = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (active && ["active", "trialing"].includes(active.status)) throw new ConflictError("You already have an active subscription. Manage it in the billing portal.", { reason: "subscription_active" });
    if (active?.provider_subscription_id && BILLING_ISSUE_STATUSES.has(active.status)) {
      throw new ConflictError("Your last payment didn’t go through. Update your payment method in the billing portal to keep your subscription.", { reason: "subscription_active", billing_issue: true });
    }
    const promotion = await this.resolvePromotion(userId, input.promotion_token, plan.code);
    const regional = this.options.regionalPricing ? await this.options.regionalPricing.resolveCheckout(userId, country, input.pricing_quote, plan.code as PurchasePlan) : null;
    if (!regional && !plan.stripe_price_id) {
      throw new BillingConfigurationError("Stripe price id is missing for requested plan", {
        plan_code: plan.code
      });
    }

    const customerId = await this.ensureStripeCustomerId(user);
    // Also consult Stripe: webhook delivery may lag behind a completed Checkout.
    if (await stripeGateway.hasBillableSubscription?.(customerId)) throw new ConflictError("You already have a subscription. Manage it in the billing portal.", { reason: "subscription_active" });

    // Only grant a free trial when: the plan supports one, trials are enabled,
    // the caller did not explicitly opt out (`with_trial: false`), and the user
    // has an unused release grant or has never consumed a trial. This closes the abuse vector
    // where a user starts a trial, cancels before the first charge, and then
    // starts a brand-new trial once the previous one lapses.
    let trialPeriodDays: number | null = null;

    // A promotion that replaces the trial charges now, whatever with_trial says (and never reports a trial change).
    if (plan.trial_supported && input.with_trial !== false && !promotion?.replaces_trial) {
      const eligible = await this.isUserTrialEligible(user.id);
      if (regional && !eligible) throw new ConflictError("Trial eligibility changed. Review the paid price before continuing.", { reason: "pricing_changed" });
      if (eligible) trialPeriodDays = this.options.trialPeriodDays;
    }

    const locale = user.locale === "tr" ? "tr" : "en";
    const submitMessage = trialPeriodDays
      ? trialSubmitMessage(locale, trialEndLabel(locale, trialPeriodDays, input.time_zone, regional?.market))
      : undefined;
    // Every Stripe parameter is in the key: an idempotent retry with different parameters fails at Stripe.
    const reservation = await this.options.regionalPricing?.reserveCheckout(userId, createHash("sha256").update(JSON.stringify({ price: regional?.priceId, trial: trialPeriodDays, successUrl, cancelUrl, submitMessage, coupon: promotion?.coupon_id, promotion: promotion?.id })).digest("hex"));
    const checkoutSession = await stripeGateway.createCheckoutSession({
      customer_id: customerId,
      price_id: regional?.priceId ?? plan.stripe_price_id!,
      currency: regional?.currency,
      locale: user.locale,
      idempotency_key: reservation?.nonce,
      expires_at: reservation ? Math.floor(Date.parse(reservation.expires_at) / 1000) : undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      mode: "subscription",
      trial_period_days: trialPeriodDays,
      submit_message: submitMessage,
      ...(promotion ? { discounts: [{ coupon: promotion.coupon_id }] } : {}),
      metadata: {
        app_user_id: user.id,
        ...(trialPeriodDays && await this.subscriptionsRepository.getTrialTransitionGrant(userId) ? { trial_transition: "1" } : {}),
        plan_code: plan.code,
        ...(regional ? { billing_market: regional.market, billing_currency: regional.currency } : {}),
        ...(promotion ? { promotion_slug: promotion.slug, promotion_cohort: promotion.cohort_key, promotion_id: promotion.id } : {})
      }
    });

    if (reservation) await this.options.regionalPricing!.rememberCheckout(userId, reservation.nonce, checkoutSession.id);
    if (!checkoutSession.url) {
      throw new BillingProviderError("Stripe checkout session did not return a URL", {
        checkout_session_id: checkoutSession.id
      });
    }

    return {
      market: regional?.market ?? null,
      promotion,
      response: {
        ...(regional ? { currency: regional.currency, amount: regional.amount } : {}),
        checkout_url: checkoutSession.url,
        checkout_session_id: checkoutSession.id,
        plan_code: plan.code,
        plan_name: plan.name,
        trial_applied: trialPeriodDays !== null,
        trial_period_days: trialPeriodDays,
        // The quote binds the list price; the coupon is applied on top of it.
        ...(promotion ? { promotion: { slug: promotion.slug, percent_off: promotion.percent_off, amount_due: regional ? discountedAmount(regional.amount, promotion.percent_off) : null } } : {})
      }
    };
  }

  private async resolvePromotion(userId: string, token: string | undefined, planCode: string): Promise<CheckoutPromotion | null> {
    if (token === undefined) return null;
    if (!this.options.promotions) throw new BillingConfigurationError("Promotions are not configured");
    return this.options.promotions.resolveForCheckout(userId, token, planCode);
  }

  async createPortalSession(
    userId: string,
    input: CreatePortalInput
  ): Promise<CreatePortalResponseData> {
    const stripeGateway = this.requireStripeGateway();
    const customerId = await this.subscriptionsRepository.getCustomerIdForUser(
      userId,
      this.options.provider
    );

    if (!customerId) {
      throw new ValidationError("Stripe customer linkage was not found for this account");
    }

    const customer = await stripeGateway.retrieveCustomer(customerId);
    if (!customer) {
      throw new ValidationError("Stripe customer linkage is stale. Start checkout again to reconnect billing.", {
        reason: "provider_customer_not_found"
      });
    }

    const base = {
      customer_id: customerId,
      return_url: this.validateReturnUrl(input.return_url, this.options.portalReturnUrl),
      configuration: await this.options.regionalPricing?.portal(userId),
      locale: (await this.requireUser(userId)).locale
    };
    const flow = await this.portalFlow(userId, input.flow, input.plan_code);
    let portalSession: { url: string };
    try {
      portalSession = await stripeGateway.createPortalSession({ ...base, flow });
    } catch (error) {
      // A portal configuration without cancellation rejects the deep link; the portal home still works.
      if (!flow) throw error;
      portalSession = await stripeGateway.createPortalSession(base);
    }

    return {
      portal_url: portalSession.url
    };
  }

  private async portalFlow(userId: string, intent: CreatePortalInput["flow"], planCode?: string) {
    if (intent === "payment_method") return { type: "payment_method_update" } as const;
    if (intent === "change_plan") return this.upgradeFlow(userId, planCode);
    if (intent !== "cancel") return undefined;
    const current = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (!current?.provider_subscription_id || current.cancel_at_period_end || !["active", "trialing"].includes(current.status)) return undefined;
    // Opening the cancellation passes over any offer the "Cancel trial" screen showed.
    await this.options.cancelOffers?.recordCancelOfferDeclined(userId);
    return { type: "subscription_cancel", subscription_id: current.provider_subscription_id } as const;
  }

  // The offer on the cancel screen (docs/promotions/cancel-flow-offer.md): for a trial, or a paid weekly, monthly or
  // annual plan, each with its own promotion. "unavailable" shows the screen without an offer, so every failed
  // condition is a plain no-offer rather than an error.
  async getCancelOffer(userId: string): Promise<CancelOfferResponseData> {
    const candidate = await this.cancelOfferCandidate(userId);
    if (!candidate) return { status: "unavailable", offer: null };
    await this.options.cancelOffers!.recordCancelOfferShown(candidate.subject);
    return { status: "available", offer: candidate.offer };
  }

  // "Keep Pro" opens a Stripe Checkout for the promoted plan with the coupon: paid now, no trial. The trial keeps
  // running until that payment succeeds; finishCancelOffer then ends it at Stripe so it never bills.
  async createCancelOfferCheckout(userId: string, input: CreateCancelOfferCheckoutInput): Promise<CancelOfferCheckoutResponseData> {
    const candidate = await this.cancelOfferCandidate(userId);
    if (!candidate || candidate.offer.kind !== "checkout") throw new ConflictError("This offer is no longer available for your subscription.", { reason: "cancel_offer_unavailable" });
    const { promotion, subject, priceId, offer, customerId, market } = candidate;
    const user = await this.requireUser(userId);
    const successUrl = this.validateReturnUrl(input.success_url, this.options.checkoutSuccessUrl);
    const cancelUrl = this.validateReturnUrl(input.cancel_url, this.options.checkoutCancelUrl);
    const metadata = {
      app_user_id: userId,
      plan_code: promotion.plan_code,
      billing_market: market,
      billing_currency: offer.currency,
      promotion_slug: promotion.slug,
      promotion_id: promotion.id,
      cancel_offer: "1",
      replaces_subscription: subject.providerSubscriptionId,
      replaces_plan_code: subject.fromPlanCode
    };
    // Repeated clicks within one half hour reuse the same session (same key, same parameters). It expires within
    // 90 minutes, while the offer needs two hours of trial left, so it cannot be paid after the trial has billed.
    const slot = Math.floor(Date.now() / HALF_HOUR_MS);
    const params = { price: priceId, coupon: promotion.coupon_id, successUrl, cancelUrl, locale: user.locale, metadata };
    let session: StripeCheckoutSessionSummary;
    try {
      session = await this.requireStripeGateway().createCheckoutSession({
        customer_id: customerId,
        price_id: priceId,
        currency: offer.currency,
        locale: user.locale,
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        mode: "subscription",
        trial_period_days: null,
        discounts: [{ coupon: promotion.coupon_id }],
        metadata,
        expires_at: Math.floor(((slot + 3) * HALF_HOUR_MS) / 1000),
        idempotency_key: `cv-cancel-offer-checkout-${slot}-${createHash("sha256").update(JSON.stringify(params)).digest("hex")}`
      });
      if (!session.url) throw new BillingProviderError("Stripe checkout session did not return a URL", { checkout_session_id: session.id });
    } catch (error) {
      await this.options.monetization?.recordCheckoutAttempt({
        user_id: userId, plan_code: promotion.plan_code, market: null, currency: null, amount: null,
        trial_requested: false, trial_applied: false, checkout_session_id: null, outcome: checkoutRejection(error)
      });
      throw error;
    }
    await this.options.monetization?.recordCheckoutAttempt({
      user_id: userId, plan_code: promotion.plan_code, market, currency: offer.currency, amount: offer.amount,
      trial_requested: false, trial_applied: false, checkout_session_id: session.id, outcome: "open", promotion_id: promotion.id
    });
    await this.options.cancelOffers!.recordCancelOfferCheckout(subject);
    return { checkout_url: session.url, checkout_session_id: session.id, currency: offer.currency, amount: offer.amount, amount_due: offer.discounted_amount };
  }

  // A paid plan's offer is applied in place, with nothing charged now: paid weekly switches to the promoted plan
  // (first invoice discounted) when its paid week ends; monthly and annual get their next renewal discounted.
  async acceptCancelOffer(userId: string): Promise<AcceptCancelOfferResponseData> {
    const candidate = await this.cancelOfferCandidate(userId);
    if (!candidate || candidate.offer.kind === "checkout") throw new ConflictError("This offer is no longer available for your subscription.", { reason: "cancel_offer_unavailable" });
    const { promotion, subject, priceId, offer } = candidate;
    const gateway = this.requireStripeGateway();
    const metadata = { plan_code: promotion.plan_code, promotion_slug: promotion.slug, promotion_id: promotion.id, cancel_offer: "1" };
    // A retry after a lost response gets Stripe's first result instead of a second change.
    const idempotencyKey = `cv-cancel-offer-${promotion.id}-${subject.providerSubscriptionId}`;
    const updated = offer.kind === "switch_at_period_end"
      ? await gateway.scheduleSubscriptionChange!({ subscription_id: subject.providerSubscriptionId, price_id: priceId, coupon_id: promotion.coupon_id, plan_code: promotion.plan_code, metadata, idempotency_key: idempotencyKey })
      : await gateway.applyRenewalDiscount!({ subscription_id: subject.providerSubscriptionId, coupon_id: promotion.coupon_id, metadata, idempotency_key: idempotencyKey });
    await this.syncStripeSubscription(userId, updated);
    await this.options.cancelOffers!.markCancelOfferAccepted(subject);
    return { accepted: true, offer, plan: await this.getBillingPlan(userId) };
  }

  // Downgrades (to a shorter, cheaper plan) wait for the end of the paid period: nothing is refunded or credited, the
  // current plan runs to its end, then the new one starts and is billed. Upgrades go through Stripe's confirmation
  // (upgradeFlow), which charges the difference at once.
  async schedulePlanChange(userId: string, planCode: string): Promise<BillingPlanResponseData> {
    const current = await this.changeablePlan(userId, planCode);
    if (current.status !== "active" || PLAN_RANK[planCode as PurchasePlan] >= PLAN_RANK[current.plan_code as PurchasePlan])
      throw new ConflictError("Only a move to a shorter plan waits for the end of your paid period.", { reason: "plan_change_not_downgrade" });
    if (!current.current_period_end || Date.parse(current.current_period_end) <= Date.now() + PLAN_CHANGE_MIN_PERIOD_LEFT_MS)
      throw new ConflictError("Your plan renews very soon. Try again after the renewal.", { reason: "plan_change_unavailable" });
    const priceId = await this.marketPriceId(userId, planCode as PurchasePlan);
    const updated = await this.requireStripeGateway().scheduleSubscriptionChange!({
      subscription_id: current.provider_subscription_id!,
      price_id: priceId,
      plan_code: planCode,
      metadata: { plan_code: planCode },
      idempotency_key: `cv-plan-change-${current.provider_subscription_id}-${planCode}-${Date.parse(current.current_period_end)}`
    });
    await this.syncStripeSubscription(userId, updated);
    return this.getBillingPlan(userId);
  }

  // Keeps the current plan: drops a downgrade (or the paid-weekly offer's switch) that is still waiting.
  async releasePlanChange(userId: string): Promise<BillingPlanResponseData> {
    const current = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (current?.provider_subscription_id && pendingChange(current)) {
      const gateway = this.requireStripeGateway();
      if (!gateway.releaseScheduledChange) throw new BillingConfigurationError("Plan changes are not configured");
      await this.syncStripeSubscription(userId, await gateway.releaseScheduledChange(current.provider_subscription_id));
    }
    return this.getBillingPlan(userId);
  }

  // Stripe's own confirmation page for an upgrade (or any change during a trial, which keeps the trial): it shows the
  // amount due today, prorated against the unused part of the current period.
  private async upgradeFlow(userId: string, planCode: string | undefined) {
    const current = await this.changeablePlan(userId, planCode);
    if (current.status === "active" && PLAN_RANK[planCode as PurchasePlan] < PLAN_RANK[current.plan_code as PurchasePlan])
      throw new ConflictError("A move to a shorter plan waits for the end of your paid period.", { reason: "plan_change_downgrade" });
    return { type: "subscription_update_confirm", subscription_id: current.provider_subscription_id!, price_id: await this.marketPriceId(userId, planCode as PurchasePlan) } as const;
  }

  private async changeablePlan(userId: string, planCode?: string): Promise<SubscriptionRecord> {
    if (!planCode || !(planCode in PLAN_RANK)) throw new ValidationError("Choose a weekly, monthly or annual plan");
    const current = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (!current?.provider_subscription_id || !["active", "trialing"].includes(current.status) || !(current.plan_code in PLAN_RANK))
      throw new ConflictError("There is no plan to change.", { reason: "plan_change_unavailable" });
    if (current.cancel_at_period_end)
      throw new ConflictError("Your plan is set to end. Resume it in Manage billing before changing it.", { reason: "plan_change_unavailable" });
    if (pendingChange(current))
      throw new ConflictError("A plan change is already waiting. Keep your current plan first to choose another.", { reason: "plan_change_pending" });
    if (current.plan_code === planCode) throw new ConflictError("You are already on this plan.", { reason: "plan_change_unavailable" });
    return current;
  }

  // The plan's price in the account's locked market, the currency it already pays in.
  private async marketPriceId(userId: string, planCode: PurchasePlan): Promise<string> {
    const regional = this.options.regionalPricing;
    const market = regional ? await regional.savedMarket(userId) : null;
    const priceId = market ? regional!.options.prices[market][planCode] : null;
    if (!priceId) throw new BillingConfigurationError("This plan is not available in your billing market");
    return priceId;
  }

  // Runs after every sync of a paid subscription from the offer's checkout (webhook or the return page): ends the
  // trial it replaces at Stripe, which would otherwise still bill its weekly price at the trial end, then marks the
  // offer accepted. The accepted row makes repeats a no-op.
  private async finishCancelOffer(userId: string, subscription: StripeSubscriptionSummary): Promise<void> {
    const { cancel_offer: cancelOffer, replaces_subscription: replaced, promotion_id: promotionId } = subscription.metadata;
    if (cancelOffer !== "1" || !replaced || !promotionId || subscription.status !== "active") return;
    const cancelOffers = this.options.cancelOffers;
    const gateway = this.requireStripeGateway();
    if (!cancelOffers || !gateway.cancelReplacedSubscription) throw new BillingConfigurationError("Cancel-flow offers are not configured");
    const offer = await cancelOffers.findCancelOffer(promotionId, userId);
    if (offer?.accepted_at && offer.provider_subscription_id === replaced) return;
    // Only ever end the same customer's subscription.
    const trial = await gateway.retrieveSubscription(replaced);
    if (!trial || trial.customer_id !== subscription.customer_id) return;
    const ended = await gateway.cancelReplacedSubscription(replaced, subscription.id);
    await this.syncStripeSubscription(userId, ended);
    await cancelOffers.markCancelOfferAccepted({ promotionId, userId, providerSubscriptionId: replaced, fromPlanCode: subscription.metadata.replaces_plan_code ?? trial.metadata.plan_code ?? "weekly" });
  }

  private async cancelOfferCandidate(userId: string) {
    const cancelOffers = this.options.cancelOffers;
    const regional = this.options.regionalPricing;
    const gateway = this.stripeGateway;
    if (!cancelOffers || !regional || !gateway) return null;
    // A trial, or a paid plan with nothing scheduled, not already canceled and with at least two hours left (longer
    // than the trial's checkout can stay open, and well before a renewal invoice).
    const current = await this.subscriptionsRepository.getCurrentForUser(userId);
    // A trialing row synced without a period end (API 2026-03-25.dahlia webhooks) falls back to Stripe's trial end.
    const periodEnd = current?.current_period_end ?? (current?.status === "trialing" ? current.trial_end ?? null : null);
    if (!current?.provider_subscription_id || current.cancel_at_period_end || !periodEnd) return null;
    if (Date.parse(periodEnd) <= Date.now() + OFFER_MIN_PERIOD_LEFT_MS) return null;
    const audience: CancelOfferAudience | null = current.status === "trialing" ? "trial"
      : current.status === "active" && current.plan_code in PLAN_RANK && !pendingChange(current) ? current.plan_code as PurchasePlan : null;
    if (!audience) return null;
    const promotion = await cancelOffers.activeCancelPromotion(audience);
    if (!promotion) return null;
    // A trial converts by checkout, paid weekly moves to the promoted plan at its period end, and monthly or annual
    // keep their plan with the next renewal discounted.
    const kind: CancelOffer["kind"] = audience === "trial" ? "checkout" : audience === "weekly" ? "switch_at_period_end" : "renewal_discount";
    const fits = kind === "checkout" ? [promotion.plan_code, "weekly"].includes(current.plan_code)
      : kind === "switch_at_period_end" ? promotion.plan_code !== current.plan_code
      : promotion.plan_code === current.plan_code;
    const supported = kind === "checkout" ? gateway.cancelReplacedSubscription : kind === "switch_at_period_end" ? gateway.scheduleSubscriptionChange : gateway.applyRenewalDiscount;
    if (!fits || !supported) return null;
    // One cancel-screen offer per account: having accepted any of them (e.g. the trial's) ends every offer.
    if (await cancelOffers.hasAcceptedCancelOffer(userId)) return null;
    // The subscription's own market (locked at checkout), so the offer is in the currency it already pays in.
    const market = await regional.savedMarket(userId);
    const customerId = current.provider_customer_id ?? await this.subscriptionsRepository.getCustomerIdForUser(userId, this.options.provider);
    if (!market || !customerId) return null;
    const prices = await regional.getPrices(null, userId);
    const target = prices.plans.find(plan => plan.code === promotion.plan_code);
    const priceId = regional.options.prices[prices.market][promotion.plan_code];
    if (!prices.available || !target || !priceId) return null;
    const currentPlan = current.plan_code as CancelOffer["current_plan_code"];
    return {
      promotion,
      priceId,
      market,
      customerId,
      subject: { promotionId: promotion.id, userId, providerSubscriptionId: current.provider_subscription_id, fromPlanCode: current.plan_code },
      offer: {
        kind,
        slug: promotion.slug,
        percent_off: promotion.percent_off,
        plan_code: promotion.plan_code,
        currency: prices.currency,
        amount: target.amount,
        discounted_amount: discountedAmount(target.amount, promotion.percent_off),
        current_plan_code: currentPlan,
        current_amount: prices.plans.find(plan => plan.code === currentPlan)?.amount ?? null,
        period_end: periodEnd
      } satisfies CancelOffer
    };
  }

  async handleWebhook(payload: Buffer, signature: string | undefined): Promise<BillingWebhookResponseData> {
    const stripeGateway = this.requireStripeGateway();

    if (!this.options.stripeWebhookSecret) {
      throw new BillingConfigurationError("Stripe webhook secret is not configured");
    }

    if (!signature) {
      throw new BillingWebhookSignatureError("Missing Stripe webhook signature header");
    }

    const event = stripeGateway.constructWebhookEvent(payload, signature, this.options.stripeWebhookSecret);
    const processed = await this.processWebhookEvent(event);

    return {
      received: true,
      event_id: event.id,
      event_type: event.type,
      processed
    };
  }

  private async processWebhookEvent(event: StripeWebhookEvent): Promise<boolean> {
    switch (event.type) {
      case "checkout.session.completed": {
        const processed = await this.handleCheckoutSessionCompleted(event.object, event);
        return (await this.redeemPromotion(event.object)) || processed;
      }
      case "checkout.session.expired":
        return this.handleCheckoutSessionExpired(event.object);
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return this.handleSubscriptionUpdated(event.object, event);
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        return this.handleInvoiceEvent(event.object);
      case "charge.refunded":
        return this.handleChargeRefunded(event.object);
      default:
        return false;
    }
  }

  // After the subscription sync, so a redemption failure (retried by Stripe) never delays access.
  // markRedeemed only sets an unredeemed recipient, so replays keep the first session.
  private async redeemPromotion(object: unknown): Promise<boolean> {
    const session = parseCheckoutSessionFromWebhookObject(object);
    const promotionId = session?.metadata.promotion_id;
    const userId = session?.metadata.app_user_id;
    if (!session || !promotionId || !userId || !this.options.promotions) return false;
    await this.options.promotions.markRedeemed(promotionId, userId, session.id);
    return true;
  }

  private async handleCheckoutSessionExpired(object: unknown): Promise<boolean> {
    const session = parseCheckoutSessionFromWebhookObject(object);
    if (!session || !this.options.monetization) return false;
    await this.options.monetization.resolveCheckoutAttempt(session.id, "expired");
    return true;
  }

  private async handleInvoiceEvent(object: unknown): Promise<boolean> {
    const invoiceId = resolveObjectId(object);
    return invoiceId ? this.syncInvoice(invoiceId) : false;
  }

  private async handleChargeRefunded(object: unknown): Promise<boolean> {
    const charge = asRecord(object);
    const chargeId = typeof charge.id === "string" ? charge.id : null;
    const invoiceId = resolveObjectId(charge.invoice)
      ?? (chargeId ? await this.requireStripeGateway().retrieveChargeInvoiceId?.(chargeId) ?? null : null);
    return invoiceId ? this.syncInvoice(invoiceId) : false;
  }

  // Re-reads the invoice from Stripe so out-of-order events still store the latest state.
  // Public for the one-off backfill script; webhooks are the normal path.
  async syncInvoice(invoiceId: string): Promise<boolean> {
    const monetization = this.options.monetization;
    const stripeGateway = this.requireStripeGateway();
    if (!monetization || !stripeGateway.retrieveInvoice) return false;
    const invoice = await stripeGateway.retrieveInvoice(invoiceId);
    if (!invoice) return false;

    const subscription = invoice.subscription_id
      ? await this.subscriptionsRepository.findByProviderSubscriptionId(this.options.provider, invoice.subscription_id)
      : null;
    let userId: string | null = subscription?.user_id ?? invoice.metadata.app_user_id ?? null;
    if (!userId && invoice.customer_id) {
      userId = (await this.subscriptionsRepository.findByProviderCustomerId(this.options.provider, invoice.customer_id))?.user_id ?? null;
    }
    const owner = userId ? await this.usersRepository.getById(userId) : null;
    // Erased accounts keep only the anonymised rows archived at erasure.
    if (!owner || (owner as unknown as { deletion_requested_at?: string }).deletion_requested_at) return false;

    await monetization.upsertInvoice({
      user_id: owner.id,
      subscription_id: subscription?.id ?? null,
      provider_invoice_id: invoice.id,
      provider_subscription_id: invoice.subscription_id,
      status: invoice.status,
      currency: invoice.currency,
      amount_subtotal: invoice.amount_subtotal,
      amount_discount: invoice.amount_discount,
      amount_tax: invoice.amount_tax,
      amount_total: invoice.amount_total,
      amount_paid: invoice.amount_paid,
      amount_refunded: invoice.amount_refunded,
      billing_reason: invoice.billing_reason,
      // Unknown prices stay null rather than being reported as the free plan.
      plan_code: ((code: PlanCode) => code === "free" ? null : code)(this.resolvePlanCodeFromPrices(invoice.price_ids)),
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      paid_at: invoice.paid_at,
      created_at: invoice.created_at
    });
    return true;
  }

  private async handleCheckoutSessionCompleted(object: unknown, event?: StripeWebhookEvent): Promise<boolean> {
    const stripeGateway = this.requireStripeGateway();
    const session = parseCheckoutSessionFromWebhookObject(object);

    if (!session) {
      return false;
    }
    await this.options.monetization?.resolveCheckoutAttempt(session.id, "completed");

    const metadataUserId = (session.metadata.app_user_id as string | undefined) ?? null;
    let userId = metadataUserId;

    if (!userId && session.customer_id) {
      const linkedByCustomer = await this.subscriptionsRepository.findByProviderCustomerId(
        this.options.provider,
        session.customer_id
      );
      userId = linkedByCustomer?.user_id ?? null;
    }

    if (!userId && session.subscription_id) {
      const linkedBySubscription = await this.subscriptionsRepository.findByProviderSubscriptionId(
        this.options.provider,
        session.subscription_id
      );
      userId = linkedBySubscription?.user_id ?? null;
    }

    if (!userId && session.customer_id) {
      const customer = await stripeGateway.retrieveCustomer(session.customer_id);
      userId = (customer?.metadata.app_user_id as string | undefined) ?? null;
    }

    if (!userId) {
      return false;
    }

    if (session.customer_id) {
      await this.subscriptionsRepository.ensureCustomerLink({
        user_id: userId,
        provider: this.options.provider,
        provider_customer_id: session.customer_id
      });
    }

    if (session.mode === "payment") {
      const metadataPlanCode = (session.metadata.plan_code as string | undefined) ?? null;
      if (metadataPlanCode === "lifetime") {
        await this.recordLifetimePurchase(userId, session, event);
        return true;
      }

      return true;
    }

    if (!session.subscription_id) {
      return true;
    }

    const subscription = await stripeGateway.retrieveSubscription(session.subscription_id);
    if (!subscription) {
      return false;
    }

    if (!(await this.usersRepository.getById(userId))) return false;
    await this.syncStripeSubscription(userId, subscription, event);
    return true;
  }

  private async recordLifetimePurchase(
    userId: string,
    session: ParsedWebhookCheckoutSession,
    event?: StripeWebhookEvent
  ): Promise<void> {
    const purchasedAt = event?.created ?? new Date().toISOString();
    const purchase = await this.subscriptionsRepository.upsertProviderSubscription({
      user_id: userId,
      provider: this.options.provider,
      provider_customer_id: session.customer_id,
      provider_subscription_id: `lifetime_${session.id}`,
      plan_code: "lifetime",
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: null,
      cancel_at_period_end: false,
      tracking: {
        unit_amount: session.amount_total ?? null,
        currency: session.currency ?? null,
        billing_interval: "one_time",
        ...(event ? { last_provider_event_id: event.id, last_provider_event_at: event.created ?? null } : {})
      }
    });
    // One-time payments have no Stripe invoice; record the charge as its own row
    // after access is granted, so a failed write cannot block the purchase.
    if (session.amount_total !== null && session.amount_total !== undefined && session.currency) {
      await this.options.monetization?.upsertInvoice({
        user_id: userId,
        subscription_id: purchase.id,
        provider_invoice_id: `lifetime_${session.id}`,
        provider_subscription_id: `lifetime_${session.id}`,
        status: "paid",
        currency: session.currency,
        amount_subtotal: session.amount_total,
        amount_discount: 0,
        amount_tax: 0,
        amount_total: session.amount_total,
        amount_paid: session.amount_total,
        amount_refunded: 0,
        billing_reason: "one_time_purchase",
        plan_code: "lifetime",
        period_start: purchasedAt,
        period_end: null,
        paid_at: purchasedAt,
        created_at: purchasedAt
      });
    }
  }

  private async handleSubscriptionUpdated(object: unknown, event?: StripeWebhookEvent): Promise<boolean> {
    const stripeGateway = this.requireStripeGateway();
    const subscription = parseSubscriptionFromWebhookObject(object);

    if (!subscription) {
      return false;
    }

    let userId = (subscription.metadata.app_user_id as string | undefined) ?? null;

    if (!userId) {
      const existingBySubscription = await this.subscriptionsRepository.findByProviderSubscriptionId(
        this.options.provider,
        subscription.id
      );
      userId = existingBySubscription?.user_id ?? null;
    }

    if (!userId) {
      const existingByCustomer = await this.subscriptionsRepository.findByProviderCustomerId(
        this.options.provider,
        subscription.customer_id
      );
      userId = existingByCustomer?.user_id ?? null;
    }

    if (!userId) {
      const customer = await stripeGateway.retrieveCustomer(subscription.customer_id);
      userId = (customer?.metadata.app_user_id as string | undefined) ?? null;
    }

    if (!userId) {
      return false;
    }

    if (!(await this.usersRepository.getById(userId))) return false;
    await this.syncStripeSubscription(userId, subscription, event);
    return true;
  }

  private async syncStripeSubscription(userId: string, subscription: StripeSubscriptionSummary, event?: StripeWebhookEvent): Promise<void> {
    const owner = await this.usersRepository.getById(userId);
    if (!owner || (owner as unknown as { deletion_requested_at?: string }).deletion_requested_at) return;
    const mappedPlanCode = this.resolvePlanCodeFromPrices(subscription.price_ids);
    // Ended because a paid subscription replaced it: kept "inactive" (superseded), like a row replaced locally,
    // rather than a canceled trial (no "trial canceled" reminder email, no cancellation in the trial metrics).
    const replaced = Boolean(subscription.replaced_by) && ["canceled", "incomplete_expired"].includes(subscription.status);

    await this.subscriptionsRepository.ensureCustomerLink({
      user_id: userId,
      provider: this.options.provider,
      provider_customer_id: subscription.customer_id
    });

    const payload: SyncSubscriptionInput = {
      user_id: userId,
      provider: this.options.provider,
      provider_customer_id: subscription.customer_id,
      provider_subscription_id: subscription.id,
      plan_code: mappedPlanCode,
      status: replaced ? "inactive" : subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: replaced ? false : subscription.cancel_at_period_end,
      tracking: {
        ...subscription.details,
        ...(event ? { last_provider_event_id: event.id, last_provider_event_at: event.created ?? null } : {})
      }
    };

    // Only verified provider data redeems the grant. Abandoned/failed checkout does not.
    // Do this before persistence so a webhook retry cannot leave a synced trial reusable.
    if (subscription.metadata.trial_transition === "1" && (subscription.status === "trialing" || subscription.trial_start)) {
      await this.subscriptionsRepository.redeemTrialTransitionGrant(userId, subscription.id);
    }
    await this.subscriptionsRepository.upsertProviderSubscription(payload);
    await this.finishCancelOffer(userId, subscription);
  }

  private resolvePlanCodeFromPrices(priceIds: string[]): PlanCode {
    for (const id of priceIds) { const regional = this.options.regionalPricing?.planFromPrice(id); if (regional) return regional; }
    const plans = Object.values(this.entitlementsService.getPlanCatalog());

    for (const plan of plans) {
      if (!plan.stripe_price_id) {
        continue;
      }

      if (priceIds.includes(plan.stripe_price_id)) {
        return plan.code;
      }
    }

    return "free";
  }

  private requirePurchasablePlan(planCode: string): PlanDefinition {
    const normalized = planCode.trim().toLowerCase();
    const catalog = this.entitlementsService.getPlanCatalog();

    if (!(normalized in catalog)) {
      throw new BillingPlanValidationError("Requested plan_code is not supported", {
        plan_code: planCode
      });
    }

    const requestedPlan = catalog[normalized as PlanCode];

    if (!requestedPlan.checkout_allowed) {
      throw new BillingPlanValidationError("Requested plan_code is not available for checkout", {
        plan_code: planCode
      });
    }

    return requestedPlan;
  }

  private async ensureStripeCustomerId(user: UserRecord): Promise<string> {
    const stripeGateway = this.requireStripeGateway();

    const existingCustomerId = await this.subscriptionsRepository.getCustomerIdForUser(
      user.id,
      this.options.provider
    );

    if (existingCustomerId) {
      const existingCustomer = await stripeGateway.retrieveCustomer(existingCustomerId);
      if (existingCustomer) {
        return existingCustomerId;
      }
    }

    const createdCustomer = await stripeGateway.createCustomer({
      email: user.email,
      name: user.full_name,
      idempotency_key: `cv-customer-${user.id}-${existingCustomerId ?? "initial"}`,
      metadata: {
        app_user_id: user.id
      }
    });

    await this.subscriptionsRepository.ensureCustomerLink({
      user_id: user.id,
      provider: this.options.provider,
      provider_customer_id: createdCustomer.id
    });

    return createdCustomer.id;
  }

  private requireStripeGateway(): StripeGateway {
    if (!this.stripeGateway) {
      throw new BillingConfigurationError("Stripe secret key is not configured");
    }

    return this.stripeGateway;
  }

  private async getSnapshot(userId: string): Promise<BillingSnapshot> {
    const user = await this.requireUser(userId);
    const subscription = await this.subscriptionsRepository.getCurrentForUser(user.id);
    const effectivePlanCode = this.entitlementsService.resolveEffectivePlanCode(subscription);
    const usage = await this.usageService.getCurrentMonth(user.id);
    const usageSummary = this.entitlementsService.resolveUsage(usage, effectivePlanCode);
    const entitlements = this.entitlementsService.resolveEntitlements(usage, effectivePlanCode);
    if (this.options.requireSubscription && !this.subscriptionAllowsAccess(subscription)) {
      entitlements.can_generate_tailored_cv = false;
      entitlements.can_export_pdf = false;
      entitlements.can_export_docx = false;
      entitlements.can_use_ai_actions = false;
    }

    const currentPlan: CurrentPlanSummary = {
      plan_code: effectivePlanCode,
      status: subscription?.status ?? "inactive",
      current_period_start: subscription?.current_period_start ?? null,
      current_period_end: subscription?.current_period_end ?? null,
      cancel_at_period_end: subscription?.cancel_at_period_end ?? false
    };

    return {
      user,
      subscription,
      current_plan: currentPlan,
      usage_summary: usageSummary,
      entitlements
    };
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.usersRepository.getById(userId);

    if (!user) {
      throw new NotFoundError("Authenticated user was not found");
    }

    return user;
  }
}
