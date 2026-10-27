import { createHash } from "node:crypto";
import type { RegionalPricingService, PurchasePlan } from "./regional-pricing";
import {
  ConflictError,
  ForbiddenError,
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
import type {
  BillingEntitlementsResponseData,
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
  toSubscriptionDetails,
  type StripeCheckoutSessionSummary,
  type StripeGateway,
  type StripeSubscriptionSummary,
  type StripeWebhookEvent
} from "./stripe-gateway";
import type { CheckoutOutcome, DenialReason, MonetizationRepository } from "../monetization/monetization.repository";

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
}

// Which gate refused the request, for paywall analysis.
export interface DeniedGate {
  action: GatedAction | "app_access";
  surface?: string;
}

const checkoutRejection = (error: unknown): CheckoutOutcome => {
  const reason = error instanceof ConflictError ? error.details?.reason : undefined;
  if (reason === "checkout_pending") return "rejected_pending";
  if (reason === "subscription_active") return "rejected_active";
  if (reason === "pricing_changed") return "rejected_pricing_changed";
  return "failed";
};

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
    current_period_start: toIsoFromUnixSeconds(row.current_period_start),
    current_period_end: toIsoFromUnixSeconds(row.current_period_end),
    metadata: normalizeMetadata(row.metadata),
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
    const [snapshot, transition] = await Promise.all([
      this.getSnapshot(userId), this.subscriptionsRepository.getTrialTransitionGrant(userId)
    ]);
    const trialEligible = await this.isUserTrialEligible(userId, transition);

    return {
      app_access: !this.options.requireSubscription || this.subscriptionAllowsAccess(snapshot.subscription),
      subscription_required: this.options.requireSubscription === true,
      can_edit_existing_cvs: Boolean(transition) || !this.options.requireSubscription || this.subscriptionAllowsAccess(snapshot.subscription),
      plan_code: snapshot.current_plan.plan_code as PlanCode,
      subscription_status: snapshot.current_plan.status,
      current_period_start: snapshot.current_plan.current_period_start,
      current_period_end: snapshot.current_plan.current_period_end,
      cancel_at_period_end: snapshot.current_plan.cancel_at_period_end,
      trial_eligible: trialEligible,
      trial_transition: transition ? { eligible: trialEligible } : null,
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
    await this.assertSubscriptionAccess(userId, false, { action });
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

  async assertSubscriptionAccess(userId: string, allowExistingCvWorkspace = false, gate: DeniedGate = { action: "app_access" }): Promise<void> {
    if (!this.options.requireSubscription) return;
    const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (!this.subscriptionAllowsAccess(subscription)) {
      if (allowExistingCvWorkspace && await this.subscriptionsRepository.getTrialTransitionGrant(userId)) return;
      await this.options.monetization?.recordEntitlementDenial({
        user_id: userId,
        plan_code: this.entitlementsService.resolveEffectivePlanCode(subscription),
        action: gate.action,
        surface: gate.surface,
        reason: this.denialReason(subscription)
      });
      throw new ForbiddenError("Activate your 3-day free trial or purchase Pro to continue.", { reason: "subscription_required" });
    }
  }

  private denialReason(subscription: SubscriptionRecord | null): DenialReason {
    if (!subscription?.provider_subscription_id) return "no_subscription";
    return subscription.status === "trialing" ? "trial_expired" : "subscription_inactive";
  }

  private subscriptionAllowsAccess(subscription: SubscriptionRecord | null): boolean {
    if (!subscription || this.entitlementsService.resolveEffectivePlanCode(subscription) === "free") return false;
    // A delayed webhook must not extend a three-day trial indefinitely.
    if (subscription.status === "trialing") {
      const end = Date.parse(subscription.current_period_end ?? "");
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
      const { response, market } = await this.openCheckoutSession(userId, input, country);
      await this.options.monetization?.recordCheckoutAttempt({
        user_id: userId,
        plan_code: response.plan_code,
        market,
        currency: response.currency ?? null,
        amount: response.amount ?? null,
        trial_requested: trialRequested,
        trial_applied: response.trial_applied,
        checkout_session_id: response.checkout_session_id,
        outcome: "open"
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
  ): Promise<{ response: CreateCheckoutResponseData; market: string | null }> {
    const user = await this.requireUser(userId);
    const stripeGateway = this.requireStripeGateway();
    const plan = this.requirePurchasablePlan(input.plan_code);

    const successUrl = this.validateReturnUrl(input.success_url, this.options.checkoutSuccessUrl);
    const cancelUrl = this.validateReturnUrl(input.cancel_url, this.options.checkoutCancelUrl);
    const active = await this.subscriptionsRepository.getCurrentForUser(userId);
    if (active && ["active", "trialing"].includes(active.status)) throw new ConflictError("You already have an active subscription. Manage it in the billing portal.", { reason: "subscription_active" });
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

    if (plan.trial_supported && input.with_trial !== false) {
      const eligible = await this.isUserTrialEligible(user.id);
      if (regional && !eligible) throw new ConflictError("Trial eligibility changed. Review the paid price before continuing.", { reason: "pricing_changed" });
      if (eligible) trialPeriodDays = this.options.trialPeriodDays;
    }

    const reservation = await this.options.regionalPricing?.reserveCheckout(userId, createHash("sha256").update(JSON.stringify({ price: regional?.priceId, trial: trialPeriodDays, successUrl, cancelUrl })).digest("hex"));
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
      metadata: {
        app_user_id: user.id,
        ...(trialPeriodDays && await this.subscriptionsRepository.getTrialTransitionGrant(userId) ? { trial_transition: "1" } : {}),
        plan_code: plan.code,
        ...(regional ? { billing_market: regional.market, billing_currency: regional.currency } : {})
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
      response: {
        ...(regional ? { currency: regional.currency, amount: regional.amount } : {}),
        checkout_url: checkoutSession.url,
        checkout_session_id: checkoutSession.id,
        plan_code: plan.code,
        plan_name: plan.name,
        trial_applied: trialPeriodDays !== null,
        trial_period_days: trialPeriodDays
      }
    };
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

    const portalSession = await stripeGateway.createPortalSession({
      customer_id: customerId,
      return_url: this.validateReturnUrl(input.return_url, this.options.portalReturnUrl),
      configuration: await this.options.regionalPricing?.portal(userId),
      locale: (await this.requireUser(userId)).locale
    });

    return {
      portal_url: portalSession.url
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
      case "checkout.session.completed":
        return this.handleCheckoutSessionCompleted(event.object, event);
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
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
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
