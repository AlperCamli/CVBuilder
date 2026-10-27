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

// Descriptive fields kept for analysis only; access decisions never read them.
export interface StripeSubscriptionDetails {
  trial_start: string | null;
  trial_end: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  cancellation_reason: string | null;
  cancellation_feedback: string | null;
  unit_amount: number | null;
  currency: string | null;
  billing_interval: string | null;
}

export interface StripeSubscriptionSummary {
  trial_start?: string | null;
  details?: StripeSubscriptionDetails;
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
  status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status?: string;
  id: string;
  url: string | null;
  customer_id: string | null;
  subscription_id: string | null;
  metadata: Record<string, string>;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  created?: string | null;
  object: unknown;
}

export interface CreateStripeCustomerInput {
  email: string;
  name: string | null;
  metadata: Record<string, string>;
  idempotency_key?: string;
}

export interface CreateStripeCheckoutInput {
  customer_id: string;
  price_id: string;
  currency?: string;
  success_url: string;
  cancel_url: string;
  client_reference_id: string;
  metadata: Record<string, string>;
  mode?: "subscription" | "payment";
  trial_period_days?: number | null;
  locale?: "en" | "tr";
  idempotency_key?: string;
  expires_at?: number;
}

export interface CreateStripePortalInput {
  configuration?: string;
  locale?: "en" | "tr";
  customer_id: string;
  return_url: string;
}

export interface StripePriceSummary { id: string; active: boolean; product_id: string; currency: string; amount: number; interval: string | null; interval_count: number | null }

export interface StripeInvoiceSummary {
  id: string;
  customer_id: string | null;
  subscription_id: string | null;
  status: string;
  currency: string;
  amount_subtotal: number;
  amount_discount: number;
  amount_tax: number;
  amount_total: number;
  amount_paid: number;
  amount_refunded: number;
  billing_reason: string | null;
  price_ids: string[];
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
  metadata: Record<string, string>;
}

export interface StripeGateway {
  retrieveInvoice?(invoiceId: string): Promise<StripeInvoiceSummary | null>;
  retrieveChargeInvoiceId?(chargeId: string): Promise<string | null>;
  retrieveCheckoutSession?(sessionId: string): Promise<StripeCheckoutSessionSummary | null>;
  hasBillableSubscription?(customerId: string): Promise<boolean>;
  expireCheckoutSession?(sessionId: string): Promise<void>;
  retrievePrice?(priceId: string): Promise<StripePriceSummary | null>;
  retrievePortalConfiguration?(id: string): Promise<{ active: boolean; updates_enabled: boolean; price_ids: string[] }>;
  cancelCustomerSubscriptions?(customerId: string, deadline?: number): Promise<void>;
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

const toPeriodIso = (unixSeconds: unknown): string | null => {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
};

const record = (value: unknown): Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : {};

// Accepts both SDK objects and raw webhook payloads (same JSON shape).
export const toSubscriptionDetails = (subscription: unknown): StripeSubscriptionDetails => {
  const row = record(subscription);
  const price = record(record(record(row.items).data?.[0]).price);
  const cancellation = record(row.cancellation_details);
  return {
    trial_start: toPeriodIso(row.trial_start),
    trial_end: toPeriodIso(row.trial_end),
    canceled_at: toPeriodIso(row.canceled_at),
    ended_at: toPeriodIso(row.ended_at),
    cancellation_reason: typeof cancellation.reason === "string" ? cancellation.reason : null,
    cancellation_feedback: typeof cancellation.feedback === "string" ? cancellation.feedback : null,
    unit_amount: typeof price.unit_amount === "number" ? price.unit_amount : null,
    currency: typeof price.currency === "string" ? price.currency : null,
    billing_interval: typeof record(price.recurring).interval === "string" ? record(price.recurring).interval : null
  };
};

// Expects an invoice retrieved with `expand: ["charge"]` so refunds are included.
export const toInvoiceSummary = (invoice: Stripe.Invoice): StripeInvoiceSummary => {
  const lines = invoice.lines?.data ?? [];
  const serviceLine = lines.find(line => line.type === "subscription" && !line.proration) ?? lines.find(line => line.price) ?? null;
  const charge = record(invoice.charge);
  const refunded = typeof charge.amount_refunded === "number" ? charge.amount_refunded : 0;
  const subscriptionDetails = record(record(invoice).subscription_details);
  return {
    id: invoice.id,
    customer_id: invoice.customer ? normalizeCustomerId(invoice.customer) : null,
    subscription_id: normalizeSubscriptionId(invoice.subscription ?? null),
    status: invoice.status === "paid" && refunded > 0 ? (refunded >= invoice.amount_paid ? "refunded" : "partially_refunded") : (invoice.status ?? "draft"),
    currency: invoice.currency,
    amount_subtotal: invoice.subtotal,
    amount_discount: (invoice.total_discount_amounts ?? []).reduce((sum, item) => sum + item.amount, 0),
    amount_tax: invoice.tax ?? 0,
    amount_total: invoice.total,
    amount_paid: invoice.amount_paid,
    amount_refunded: refunded,
    billing_reason: invoice.billing_reason ?? null,
    // The plan line first: on upgrades the first line is usually the old plan's unused-time credit.
    price_ids: [serviceLine, ...lines.filter(line => line !== serviceLine)]
      .map(line => line?.price?.id ?? null).filter((id): id is string => Boolean(id)),
    period_start: toPeriodIso(serviceLine?.period?.start),
    period_end: toPeriodIso(serviceLine?.period?.end),
    paid_at: toPeriodIso(invoice.status_transitions?.paid_at),
    created_at: toPeriodIso(invoice.created) ?? new Date().toISOString(),
    metadata: toMetadataRecord(subscriptionDetails.metadata ?? invoice.metadata)
  };
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
    this.stripe = new Stripe(secretKey, {
      // Keep Stripe API behavior stable and explicit across environments.
      apiVersion: "2024-06-20"
    });
  }

  async cancelCustomerSubscriptions(customerId: string, deadline = Date.now() + 20_000): Promise<void> {
    const options = (): Stripe.RequestOptions => {
      if (Date.now() >= deadline - 250) throw new Error("PRIVACY_BILLING_DEADLINE");
      return { timeout: Math.max(1, deadline - Date.now() - 250), maxNetworkRetries: 0 };
    };
    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try { customer = await this.stripe.customers.retrieve(customerId, options()); }
    catch (error) { if (error instanceof Error && /No such customer/i.test(error.message)) return; throw error; }
    if ("deleted" in customer && customer.deleted) return;
    let after: string | undefined;
    do {
      const page = await this.stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100, starting_after: after }, options());
      for (const subscription of page.data) {
        if (!["canceled", "incomplete_expired"].includes(subscription.status)) await this.stripe.subscriptions.cancel(subscription.id, options());
      }
      after = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (after);
    // Keep statutory transaction records in Stripe; remove our application link.
    await this.stripe.customers.del(customerId, options());
  }

  async expireCheckoutSession(sessionId: string): Promise<void> { await this.stripe.checkout.sessions.expire(sessionId); }

  async retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionSummary | null> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    return {
      id: session.id, url: session.url, status: session.status, payment_status: session.payment_status,
      customer_id: session.customer ? normalizeCustomerId(session.customer) : null,
      subscription_id: normalizeSubscriptionId(session.subscription), metadata: toMetadataRecord(session.metadata)
    };
  }

  async retrieveInvoice(invoiceId: string): Promise<StripeInvoiceSummary | null> {
    try {
      return toInvoiceSummary(await this.stripe.invoices.retrieve(invoiceId, { expand: ["charge"] }));
    } catch (error) {
      if (error instanceof Error && /No such invoice/i.test(error.message)) return null;
      throw new BillingProviderError("Failed to retrieve Stripe invoice", {
        reason: error instanceof Error ? error.message : "unknown_stripe_invoice_error",
        invoice_id: invoiceId
      });
    }
  }

  async retrieveChargeInvoiceId(chargeId: string): Promise<string | null> {
    const charge = await this.stripe.charges.retrieve(chargeId);
    return typeof charge.invoice === "string" ? charge.invoice : charge.invoice?.id ?? null;
  }

  async retrievePortalConfiguration(id: string) {
    const config = await this.stripe.billingPortal.configurations.retrieve(id, {
      expand: ["features.subscription_update.products"]
    });
    return { active: config.active, updates_enabled: config.features.subscription_update.enabled, price_ids: (config.features.subscription_update.products ?? []).flatMap(product => product.prices) };
  }

  async retrievePrice(priceId: string): Promise<StripePriceSummary | null> {
    const price = await this.stripe.prices.retrieve(priceId);
    return { id: price.id, active: price.active, product_id: typeof price.product === "string" ? price.product : price.product.id, currency: price.currency, amount: price.unit_amount ?? 0, interval: price.recurring?.interval ?? null, interval_count: price.recurring?.interval_count ?? null };
  }

  async createCustomer(input: CreateStripeCustomerInput): Promise<StripeCustomerSummary> {
    try {
      const customer = await this.stripe.customers.create({
        email: input.email,
        name: input.name ?? undefined,
        metadata: input.metadata
      }, input.idempotency_key ? { idempotencyKey: input.idempotency_key } : undefined);

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

  async hasBillableSubscription(customerId: string): Promise<boolean> {
    try {
      for await (const subscription of this.stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        if (["active", "trialing", "past_due", "unpaid", "paused"].includes(subscription.status)) return true;
      }
      return false;
    } catch {
      throw new BillingProviderError("Could not verify existing subscriptions");
    }
  }

  async createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary> {
    try {
      const mode = input.mode ?? "subscription";

      const baseParams: Stripe.Checkout.SessionCreateParams = {
        mode,
        currency: input.currency,
        locale: input.locale,
        expires_at: input.expires_at,
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
        metadata: input.metadata
      };

      if (mode === "subscription") {
        baseParams.payment_method_collection = "always";
        if (input.trial_period_days) baseParams.payment_method_types = ["card"];
        const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
          metadata: input.metadata
        };

        if (input.trial_period_days && input.trial_period_days > 0) {
          subscriptionData.trial_period_days = input.trial_period_days;
        }

        baseParams.subscription_data = subscriptionData;
      } else {
        baseParams.payment_intent_data = {
          metadata: input.metadata
        };
      }

      const session = await this.stripe.checkout.sessions.create(baseParams, input.idempotency_key ? { idempotencyKey: input.idempotency_key } : undefined);

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
        configuration: input.configuration,
        locale: input.locale,
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
        created: toPeriodIso(event.created),
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
        trial_start: toPeriodIso(subscription.trial_start),
        details: toSubscriptionDetails(subscription),
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
      if (error instanceof Error && /No such customer/i.test(error.message)) {
        return null;
      }

      throw new BillingProviderError("Failed to retrieve Stripe customer", {
        reason: error instanceof Error ? error.message : "unknown_stripe_customer_retrieve_error",
        customer_id: customerId
      });
    }
  }
}
