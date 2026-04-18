import {
  BillingConfigurationError,
  BillingPlanValidationError,
  BillingProviderError,
  BillingWebhookSignatureError,
  EntitlementExceededError,
  NotFoundError,
  ValidationError
} from "../../shared/errors/app-error";
import type { CurrentPlanSummary, UserRecord } from "../../shared/types/domain";
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
  SyncSubscriptionInput
} from "./subscriptions.repository";
import type {
  StripeCheckoutSessionSummary,
  StripeGateway,
  StripeSubscriptionSummary,
  StripeWebhookEvent
} from "./stripe-gateway";

interface BillingServiceOptions {
  provider: "stripe";
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  portalReturnUrl: string;
  stripeWebhookSecret: string | null;
}

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

const parseCheckoutSessionFromWebhookObject = (
  object: unknown
): StripeCheckoutSessionSummary | null => {
  const row = asRecord(object);
  const id = typeof row.id === "string" ? row.id : null;

  if (!id) {
    return null;
  }

  return {
    id,
    url: typeof row.url === "string" ? row.url : null,
    customer_id: resolveObjectId(row.customer),
    subscription_id: resolveObjectId(row.subscription),
    metadata: normalizeMetadata(row.metadata)
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

  async getBillingPlan(userId: string): Promise<BillingPlanResponseData> {
    const snapshot = await this.getSnapshot(userId);

    return {
      plan_code: snapshot.current_plan.plan_code as PlanCode,
      subscription_status: snapshot.current_plan.status,
      current_period_start: snapshot.current_plan.current_period_start,
      current_period_end: snapshot.current_plan.current_period_end,
      cancel_at_period_end: snapshot.current_plan.cancel_at_period_end,
      provider: {
        provider: snapshot.subscription?.provider ?? this.options.provider,
        provider_customer_id: snapshot.subscription?.provider_customer_id ?? null,
        provider_subscription_id: snapshot.subscription?.provider_subscription_id ?? null
      },
      entitlement_summary: snapshot.entitlements
    };
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
    const snapshot = await this.getSnapshot(userId);
    const decision = this.entitlementsService.evaluateAction(action, snapshot.entitlements);

    if (!decision.allowed) {
      throw new EntitlementExceededError(decision.reason ?? "Usage limit exceeded", {
        action,
        plan_code: snapshot.current_plan.plan_code,
        limits: snapshot.entitlements.limits,
        remaining: snapshot.entitlements.remaining
      });
    }
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
    input: CreateCheckoutInput
  ): Promise<CreateCheckoutResponseData> {
    const user = await this.requireUser(userId);
    const stripeGateway = this.requireStripeGateway();
    const plan = this.requirePurchasablePlan(input.plan_code);

    if (!plan.stripe_price_id) {
      throw new BillingConfigurationError("Stripe price id is missing for requested plan", {
        plan_code: plan.code
      });
    }

    const customerId = await this.ensureStripeCustomerId(user);

    const checkoutSession = await stripeGateway.createCheckoutSession({
      customer_id: customerId,
      price_id: plan.stripe_price_id,
      success_url: input.success_url ?? this.options.checkoutSuccessUrl,
      cancel_url: input.cancel_url ?? this.options.checkoutCancelUrl,
      client_reference_id: user.id,
      metadata: {
        app_user_id: user.id,
        plan_code: plan.code
      }
    });

    if (!checkoutSession.url) {
      throw new BillingProviderError("Stripe checkout session did not return a URL", {
        checkout_session_id: checkoutSession.id
      });
    }

    return {
      checkout_url: checkoutSession.url,
      checkout_session_id: checkoutSession.id,
      plan_code: plan.code,
      plan_name: plan.name
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

    const portalSession = await stripeGateway.createPortalSession({
      customer_id: customerId,
      return_url: input.return_url ?? this.options.portalReturnUrl
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
        return this.handleCheckoutSessionCompleted(event.object);
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return this.handleSubscriptionUpdated(event.object);
      default:
        return false;
    }
  }

  private async handleCheckoutSessionCompleted(object: unknown): Promise<boolean> {
    const stripeGateway = this.requireStripeGateway();
    const session = parseCheckoutSessionFromWebhookObject(object);

    if (!session) {
      return false;
    }

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

    if (!session.subscription_id) {
      return true;
    }

    const subscription = await stripeGateway.retrieveSubscription(session.subscription_id);
    if (!subscription) {
      return false;
    }

    await this.syncStripeSubscription(userId, subscription);
    return true;
  }

  private async handleSubscriptionUpdated(object: unknown): Promise<boolean> {
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

    await this.syncStripeSubscription(userId, subscription);
    return true;
  }

  private async syncStripeSubscription(userId: string, subscription: StripeSubscriptionSummary): Promise<void> {
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
      cancel_at_period_end: subscription.cancel_at_period_end
    };

    await this.subscriptionsRepository.upsertProviderSubscription(payload);
  }

  private resolvePlanCodeFromPrices(priceIds: string[]): PlanCode {
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

    if (requestedPlan.code === "free") {
      throw new BillingPlanValidationError("Free plan does not require checkout", {
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
      return existingCustomerId;
    }

    const createdCustomer = await stripeGateway.createCustomer({
      email: user.email,
      name: user.full_name,
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
