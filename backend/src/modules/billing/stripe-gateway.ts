import Stripe from "stripe";
import {
  BillingProviderError,
  BillingWebhookSignatureError,
  ConflictError
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
  // A plan change waiting for the end of the paid period (scheduleSubscriptionChange), from the metadata.
  scheduled_plan_code: string | null;
  scheduled_change_at: string | null;
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
  /** Set when the subscription was ended because a paid subscription replaced it (cancelReplacedSubscription). */
  replaced_by?: string | null;
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
  /** Shown next to Stripe's submit button. */
  submit_message?: string;
  /** Coupons applied to the session (promotional checkout). */
  discounts?: Array<{ coupon: string }>;
}

export type StripePortalFlow =
  | { type: "subscription_cancel"; subscription_id: string }
  | { type: "payment_method_update" }
  // Opens Stripe's confirmation of a switch to price_id, with the amount due today (upgrades).
  | { type: "subscription_update_confirm"; subscription_id: string; price_id: string };

export interface CreateStripePortalInput {
  configuration?: string;
  locale?: "en" | "tr";
  customer_id: string;
  return_url: string;
  /** Opens the portal directly on one step and returns to return_url when it is done. */
  flow?: StripePortalFlow;
}

export interface ScheduleStripeSubscriptionChangeInput {
  subscription_id: string;
  /** The price the subscription moves to when its current paid period ends. */
  price_id: string;
  /** Discounts the first invoice of the new price (the paid-weekly cancel offer). */
  coupon_id?: string;
  /** Merged into the subscription's metadata when the new price starts. */
  metadata: Record<string, string>;
  /** The app's plan code for price_id, shown as the pending change until then. */
  plan_code: string;
  idempotency_key: string;
}

export interface ApplyStripeRenewalDiscountInput {
  subscription_id: string;
  coupon_id: string;
  metadata: Record<string, string>;
  idempotency_key: string;
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
  listInvoiceIds?(customerId: string): Promise<string[] | null>;
  retrieveCheckoutSession?(sessionId: string): Promise<StripeCheckoutSessionSummary | null>;
  hasBillableSubscription?(customerId: string): Promise<boolean>;
  expireCheckoutSession?(sessionId: string): Promise<void>;
  retrievePrice?(priceId: string): Promise<StripePriceSummary | null>;
  retrievePortalConfiguration?(id: string): Promise<{ active: boolean; updates_enabled: boolean; price_ids: string[] }>;
  cancelCustomerSubscriptions?(customerId: string, deadline?: number): Promise<void>;
  /** Ends, immediately and without a charge, a subscription replaced by the paid subscription replacedBy. */
  cancelReplacedSubscription?(subscriptionId: string, replacedBy: string): Promise<StripeSubscriptionSummary>;
  /** Moves an active subscription to another price when its paid period ends; nothing is charged or credited now. */
  scheduleSubscriptionChange?(input: ScheduleStripeSubscriptionChangeInput): Promise<StripeSubscriptionSummary>;
  /** Drops a change scheduled by scheduleSubscriptionChange; the subscription stays on its current price. */
  releaseScheduledChange?(subscriptionId: string): Promise<StripeSubscriptionSummary>;
  /** Discounts the next renewal of an active subscription with a "once" coupon; nothing is charged now. */
  applyRenewalDiscount?(input: ApplyStripeRenewalDiscountInput): Promise<StripeSubscriptionSummary>;
  createCustomer(input: CreateStripeCustomerInput): Promise<StripeCustomerSummary>;
  createCheckoutSession(input: CreateStripeCheckoutInput): Promise<StripeCheckoutSessionSummary>;
  createPortalSession(input: CreateStripePortalInput): Promise<{ url: string }>;
  constructWebhookEvent(payload: Buffer, signature: string, webhookSecret: string): StripeWebhookEvent;
  retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionSummary | null>;
  retrieveCustomer(customerId: string): Promise<StripeCustomerSummary | null>;
}

const isTimeZone = (value: string | undefined): value is string => {
  if (!value) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
};

// The trial end as the customer will read it: their browser's time zone when known,
// otherwise the market's (Turkey has one zone), otherwise UTC.
export const trialEndLabel = (locale: "en" | "tr", trialDays: number, timeZone?: string, market?: string | null, now = Date.now()): string =>
  new Date(now + trialDays * 86_400_000).toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
    month: "long", day: "numeric", year: "numeric",
    timeZone: isTimeZone(timeZone) ? timeZone : market === "TR" ? "Europe/Istanbul" : "UTC"
  });

export const trialSubmitMessage = (locale: "en" | "tr", trialEnd: string): string => locale === "tr"
  ? `Bugün ücret alınmaz. Deneme süreniz ${trialEnd} tarihinde sona erer; o tarihe kadar istediğiniz zaman iptal edebilirsiniz.`
  : `You won't be charged today. Your trial ends on ${trialEnd}; cancel anytime before then.`;

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
// Subscription metadata keys for a plan change scheduled at the end of the paid period. They stay after the switch
// (schedule phase metadata is merged), so readers only treat a change as pending while its time is in the future.
const SCHEDULED_PLAN_KEY = "cv_scheduled_plan_code";
const SCHEDULED_AT_KEY = "cv_scheduled_change_at";

export const toSubscriptionDetails = (subscription: unknown): StripeSubscriptionDetails => {
  const row = record(subscription);
  const price = record(record(record(row.items).data?.[0]).price);
  const cancellation = record(row.cancellation_details);
  const metadata = record(row.metadata);
  return {
    trial_start: toPeriodIso(row.trial_start),
    trial_end: toPeriodIso(row.trial_end),
    canceled_at: toPeriodIso(row.canceled_at),
    ended_at: toPeriodIso(row.ended_at),
    cancellation_reason: typeof cancellation.reason === "string" ? cancellation.reason : null,
    cancellation_feedback: typeof cancellation.feedback === "string" ? cancellation.feedback : null,
    unit_amount: typeof price.unit_amount === "number" ? price.unit_amount : null,
    currency: typeof price.currency === "string" ? price.currency : null,
    billing_interval: typeof record(price.recurring).interval === "string" ? record(price.recurring).interval : null,
    scheduled_plan_code: typeof metadata[SCHEDULED_PLAN_KEY] === "string" && metadata[SCHEDULED_PLAN_KEY] ? metadata[SCHEDULED_PLAN_KEY] : null,
    scheduled_change_at: toPeriodIso(Number(metadata[SCHEDULED_AT_KEY]) || null)
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

const REPLACED_BY_PREFIX = "replaced_by:";

/** The subscription that replaced this one, from the cancellation comment cancelReplacedSubscription writes. */
export const replacedByOf = (subscription: unknown): string | null => {
  const comment = record(record(subscription).cancellation_details).comment;
  return typeof comment === "string" && comment.startsWith(REPLACED_BY_PREFIX) ? comment.slice(REPLACED_BY_PREFIX.length) || null : null;
};

const toSubscriptionSummary = (subscription: Stripe.Subscription): StripeSubscriptionSummary | null => {
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
    replaced_by: replacedByOf(subscription),
    price_ids: subscription.items.data
      .map((item) => item.price?.id ?? null)
      .filter((value): value is string => Boolean(value))
  };
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

  // Non-draft invoices of a customer, oldest pages included; null when Stripe has no such customer.
  async listInvoiceIds(customerId: string): Promise<string[] | null> {
    const ids: string[] = [];
    try {
      for await (const invoice of this.stripe.invoices.list({ customer: customerId, limit: 100 })) {
        if (invoice.status !== "draft") ids.push(invoice.id);
      }
    } catch (error) {
      if (error instanceof Error && /No such customer/i.test(error.message)) return null;
      throw error;
    }
    return ids;
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
      if (input.submit_message) baseParams.custom_text = { submit: { message: input.submit_message.slice(0, 1200) } };
      if (input.discounts?.length) baseParams.discounts = input.discounts;

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
      const flow = input.flow;
      let updateConfirm: Stripe.BillingPortal.SessionCreateParams.FlowData.SubscriptionUpdateConfirm | undefined;
      if (flow?.type === "subscription_update_confirm") {
        const subscription = await this.stripe.subscriptions.retrieve(flow.subscription_id);
        updateConfirm = { subscription: subscription.id, items: [{ id: subscription.items.data[0].id, price: flow.price_id, quantity: 1 }] };
      }
      const session = await this.stripe.billingPortal.sessions.create({
        configuration: input.configuration,
        locale: input.locale,
        customer: input.customer_id,
        return_url: input.return_url,
        ...(flow ? {
          flow_data: {
            type: flow.type,
            ...(flow.type === "subscription_cancel" ? { subscription_cancel: { subscription: flow.subscription_id } } : {}),
            ...(updateConfirm ? { subscription_update_confirm: updateConfirm } : {}),
            after_completion: { type: "redirect", redirect: { return_url: input.return_url } }
          }
        } : {})
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

  // Ends a subscription that a paid one replaced (the trial left behind by the cancel-flow offer's checkout), so it
  // never bills. The replacement is named in the cancellation comment, not in a metadata update: an update would send
  // a "still trialing" webhook whose sync would deactivate the new paid subscription. Already-ended subscriptions are
  // returned as they are, which makes webhook replays harmless.
  async cancelReplacedSubscription(subscriptionId: string, replacedBy: string): Promise<StripeSubscriptionSummary> {
    try {
      let subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      if (!["canceled", "incomplete_expired"].includes(subscription.status)) {
        subscription = await this.stripe.subscriptions.cancel(subscriptionId, {
          invoice_now: false,
          prorate: false,
          cancellation_details: { comment: `${REPLACED_BY_PREFIX}${replacedBy}` }
        }, { idempotencyKey: `cv-replace-cancel-${subscriptionId}-${replacedBy}` });
      }
      const summary = toSubscriptionSummary(subscription);
      if (!summary) throw new Error("Replaced subscription has no customer");
      return summary;
    } catch (error) {
      throw new BillingProviderError("Failed to end the replaced Stripe subscription", {
        reason: error instanceof Error ? error.message : "unknown_stripe_subscription_error",
        subscription_id: subscriptionId
      });
    }
  }

  // A subscription schedule with two phases: the current paid period as it is, then the new price (with the coupon,
  // if any) from the period end, released after one cycle. Verified with Stripe test clocks: nothing is charged or
  // credited now, and the new price is billed at the period end. The pending change is also written to the
  // subscription's metadata, so the app can show it. Only schedules the app created (metadata cv_managed) are reused.
  async scheduleSubscriptionChange(input: ScheduleStripeSubscriptionChangeInput): Promise<StripeSubscriptionSummary> {
    const subscription = await this.retrieveForChange(input.subscription_id);
    try {
      let schedule = subscription.schedule
        ? await this.stripe.subscriptionSchedules.retrieve(typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule.id)
        : null;
      if (schedule && schedule.metadata?.cv_managed !== "1")
        throw new ConflictError("This subscription already has a change waiting at Stripe.", { reason: "plan_change_unavailable" });
      schedule ??= await this.stripe.subscriptionSchedules.create({ from_subscription: subscription.id }, { idempotencyKey: `${input.idempotency_key}-schedule` });
      const periodStart = subscription.current_period_start;
      const periodEnd = subscription.current_period_end;
      const current = subscription.items.data[0];
      const { [SCHEDULED_PLAN_KEY]: _plan, [SCHEDULED_AT_KEY]: _at, ...metadata } = toMetadataRecord(subscription.metadata);
      await this.stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        metadata: { cv_managed: "1" },
        phases: [
          { items: [{ price: current.price.id, quantity: current.quantity ?? 1 }], start_date: periodStart, end_date: periodEnd, metadata, proration_behavior: "none" },
          {
            items: [{ price: input.price_id, quantity: 1 }],
            iterations: 1,
            proration_behavior: "none",
            metadata: { ...metadata, ...input.metadata },
            ...(input.coupon_id ? { discounts: [{ coupon: input.coupon_id }] } : {})
          }
        ]
      }, { idempotencyKey: `${input.idempotency_key}-phases` });
      const updated = await this.stripe.subscriptions.update(subscription.id, {
        metadata: { [SCHEDULED_PLAN_KEY]: input.plan_code, [SCHEDULED_AT_KEY]: String(periodEnd) }
      }, { idempotencyKey: `${input.idempotency_key}-pending` });
      return this.summaryOrThrow(updated);
    } catch (error) {
      throw this.providerError(error, "Failed to schedule the Stripe subscription change", input.subscription_id);
    }
  }

  async releaseScheduledChange(subscriptionId: string): Promise<StripeSubscriptionSummary> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
      const schedule = subscription.schedule && typeof subscription.schedule !== "string" ? subscription.schedule : null;
      if (schedule && schedule.metadata?.cv_managed === "1" && ["active", "not_started"].includes(schedule.status))
        await this.stripe.subscriptionSchedules.release(schedule.id);
      // An empty value deletes the metadata key.
      const updated = await this.stripe.subscriptions.update(subscriptionId, { metadata: { [SCHEDULED_PLAN_KEY]: "", [SCHEDULED_AT_KEY]: "" } });
      return this.summaryOrThrow(updated);
    } catch (error) {
      throw this.providerError(error, "Failed to drop the scheduled Stripe subscription change", subscriptionId);
    }
  }

  // A "once" coupon on the subscription discounts its next invoice, the renewal (verified with a Stripe test clock).
  async applyRenewalDiscount(input: ApplyStripeRenewalDiscountInput): Promise<StripeSubscriptionSummary> {
    const subscription = await this.retrieveForChange(input.subscription_id);
    if (subscription.discount || (subscription.discounts?.length ?? 0) > 0)
      throw new ConflictError("This subscription already has a discount.", { reason: "cancel_offer_unavailable" });
    try {
      const updated = await this.stripe.subscriptions.update(subscription.id, {
        discounts: [{ coupon: input.coupon_id }],
        proration_behavior: "none",
        metadata: input.metadata
      }, { idempotencyKey: input.idempotency_key });
      return this.summaryOrThrow(updated);
    } catch (error) {
      throw this.providerError(error, "Failed to discount the Stripe subscription", input.subscription_id);
    }
  }

  // Checked at Stripe too: the local row can lag behind a change made in the portal.
  private async retrieveForChange(subscriptionId: string): Promise<Stripe.Subscription> {
    let subscription: Stripe.Subscription;
    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      throw this.providerError(error, "Failed to retrieve Stripe subscription", subscriptionId);
    }
    if (subscription.status !== "active" || subscription.cancel_at_period_end || subscription.items.data.length !== 1)
      throw new ConflictError("This change is no longer available for your subscription.", { reason: "plan_change_unavailable" });
    return subscription;
  }

  private summaryOrThrow(subscription: Stripe.Subscription): StripeSubscriptionSummary {
    const summary = toSubscriptionSummary(subscription);
    if (!summary) throw new Error("Subscription has no customer");
    return summary;
  }

  private providerError(error: unknown, message: string, subscriptionId: string): Error {
    if (error instanceof ConflictError) return error;
    return new BillingProviderError(message, {
      reason: error instanceof Error ? error.message : "unknown_stripe_subscription_error",
      subscription_id: subscriptionId
    });
  }

  async retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionSummary | null> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

      if (!subscription || typeof subscription !== "object" || !("id" in subscription)) {
        return null;
      }

      return toSubscriptionSummary(subscription);
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
