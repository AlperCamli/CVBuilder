import Stripe from "stripe";
import {
  BillingProviderError,
  BillingWebhookSignatureError
} from "../../shared/errors/app-error";

export interface StripeCustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  metadata: Record<string, string>;
}

export interface StripeSubscriptionSummary {
  id: string;
  customer_id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  metadata: Record<string, string>;
  price_ids: string[];
}

export interface StripeCheckoutSessionSummary {
  id: string;
  url: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  metadata: Record<string, string>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  object: unknown;
}

export interface CreateStripeCustomerInput {
  email: string;
  name: string | null;
  metadata: Record<string, string>;
}

export interface CreateStripeCheckoutInput {
  customer_id: string;
  price_id: string;
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  metadata: Record<string, string>;
}

export interface CreateStripePortalInput {
  customer_id: string;
  return_url: string;
}

export interface StripeGateway {
  createCustomer(input: CreateStripeCustomerInput): Promise<StripeCustomerSummary>;
  createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary>;
  createPortalSession(input: CreateStripePortalInput): Promise<{ url: string }>;
  constructWebhookEvent(payload: Buffer, signature: string, webhookSecret: string): StripeWebhookEvent;
  retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionSummary | null>;
  retrieveCustomer(customerId: string): Promise<StripeCustomerSummary | null>;
}

const toMetadataRecord = (metadata: Stripe.Metadata | null | undefined): Record<string, string> => {
  const mapped: Record<string, string> = {};

  if (!metadata) {
    return mapped;
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      mapped[key] = value;
    }
  }

  return mapped;
};

const toPeriodIso = (unixSeconds: number | null | undefined): string | null => {
  if (!unixSeconds || unixSeconds <= 0) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
};

const normalizeCustomerId = (customer: string | Stripe.Customer | Stripe.DeletedCustomer): string | null => {
  if (typeof customer === "string") {
    return customer;
  }

  if (customer && typeof customer === "object" && "id" in customer) {
    return customer.id;
  }

  return null;
};

const normalizeSubscriptionId = (
  subscription: string | Stripe.Subscription | null
): string | null => {
  if (!subscription) {
    return null;
  }

  if (typeof subscription === "string") {
    return subscription;
  }

  return subscription.id;
};

export class StripeBillingGateway implements StripeGateway {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(input: CreateStripeCustomerInput): Promise<StripeCustomerSummary> {
    try {
      const customer = await this.stripe.customers.create({
        email: input.email,
        name: input.name ?? undefined,
        metadata: input.metadata
      });

      return {
        id: customer.id,
        email: customer.email ?? null,
        name: customer.name ?? null,
        metadata: toMetadataRecord(customer.metadata)
      };
    } catch (error) {
      throw new BillingProviderError("Failed to create Stripe customer", {
        reason: error instanceof Error ? error.message : "unknown_stripe_customer_error"
      });
    }
  }

  async createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customer_id,
        success_url: input.success_url,
        cancel_url: input.cancel_url,
        client_reference_id: input.client_reference_id,
        line_items: [
          {
            price: input.price_id,
            quantity: 1
          }
        ],
        metadata: input.metadata,
        subscription_data: {
          metadata: input.metadata
        }
      });

      return {
        id: session.id,
        url: session.url,
        customer_id: session.customer ? String(session.customer) : null,
        subscription_id: normalizeSubscriptionId(session.subscription as string | Stripe.Subscription | null),
        metadata: toMetadataRecord(session.metadata)
      };
    } catch (error) {
      throw new BillingProviderError("Failed to create Stripe checkout session", {
        reason: error instanceof Error ? error.message : "unknown_stripe_checkout_error"
      });
    }
  }

  async createPortalSession(input: CreateStripePortalInput): Promise<{ url: string }> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: input.customer_id,
        return_url: input.return_url
      });

      return {
        url: session.url
      };
    } catch (error) {
      throw new BillingProviderError("Failed to create Stripe billing portal session", {
        reason: error instanceof Error ? error.message : "unknown_stripe_portal_error"
      });
    }
  }

  constructWebhookEvent(payload: Buffer, signature: string, webhookSecret: string): StripeWebhookEvent {
    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

      return {
        id: event.id,
        type: event.type,
        object: event.data.object
      };
    } catch (error) {
      throw new BillingWebhookSignatureError("Stripe webhook signature verification failed", {
        reason: error instanceof Error ? error.message : "invalid_webhook_signature"
      });
    }
  }

  async retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionSummary | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

      if (!subscription || typeof subscription !== "object" || !("id" in subscription)) {
        return null;
      }

      const customerId = normalizeCustomerId(
        subscription.customer as string | Stripe.Customer | Stripe.DeletedCustomer
      );

      if (!customerId) {
        return null;
      }

      return {
        id: subscription.id,
        customer_id: customerId,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_start: toPeriodIso(subscription.current_period_start),
        current_period_end: toPeriodIso(subscription.current_period_end),
        metadata: toMetadataRecord(subscription.metadata),
        price_ids: subscription.items.data
          .map((item) => item.price?.id ?? null)
          .filter((value): value is string => Boolean(value))
      };
    } catch (error) {
      throw new BillingProviderError("Failed to retrieve Stripe subscription", {
        reason: error instanceof Error ? error.message : "unknown_stripe_subscription_error",
        subscription_id: subscriptionId
      });
    }
  }

  async retrieveCustomer(customerId: string): Promise<StripeCustomerSummary | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);

      if ("deleted" in customer && customer.deleted) {
        return null;
      }

      return {
        id: customer.id,
        email: customer.email ?? null,
        name: customer.name ?? null,
        metadata: toMetadataRecord(customer.metadata)
      };
    } catch (error) {
      throw new BillingProviderError("Failed to retrieve Stripe customer", {
        reason: error instanceof Error ? error.message : "unknown_stripe_customer_retrieve_error",
        customer_id: customerId
      });
    }
  }
}
