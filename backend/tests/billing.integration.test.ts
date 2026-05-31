import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import type {
  StripeCheckoutSessionSummary,
  StripeCustomerSummary,
  StripeGateway,
  StripeSubscriptionSummary,
  StripeWebhookEvent
} from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { UsageService } from "../src/modules/usage/usage.service";
import {
  FakeAuthProvider,
  InMemorySubscriptionsRepository,
  InMemoryUsageRepository,
  InMemoryUsersRepository,
  createTestConfig
} from "./helpers/in-memory";

class FakeStripeGateway implements StripeGateway {
  private readonly customers = new Map<string, StripeCustomerSummary>();
  private readonly subscriptions = new Map<string, StripeSubscriptionSummary>();
  public lastCheckoutTrialPeriodDays: number | null | undefined;

  async createCustomer(input: {
    email: string;
    name: string | null;
    metadata: Record<string, string>;
  }): Promise<StripeCustomerSummary> {
    const id = "cus_test_1";
    const customer: StripeCustomerSummary = {
      id,
      email: input.email,
      name: input.name,
      metadata: input.metadata
    };

    this.customers.set(id, customer);
    return customer;
  }

  async createCheckoutSession(input: {
    customer_id: string;
    price_id: string;
    success_url: string;
    cancel_url: string;
    client_reference_id: string;
    metadata: Record<string, string>;
    trial_period_days?: number | null;
  }): Promise<StripeCheckoutSessionSummary> {
    this.lastCheckoutTrialPeriodDays = input.trial_period_days;

    const subscription: StripeSubscriptionSummary = {
      id: "sub_test_1",
      customer_id: input.customer_id,
      status: "active",
      cancel_at_period_end: false,
      current_period_start: "2026-04-01T00:00:00.000Z",
      current_period_end: "2026-05-01T00:00:00.000Z",
      metadata: input.metadata,
      price_ids: [input.price_id]
    };

    this.subscriptions.set(subscription.id, subscription);

    return {
      id: "cs_test_1",
      url: "https://checkout.stripe.test/session/cs_test_1",
      customer_id: input.customer_id,
      subscription_id: subscription.id,
      metadata: input.metadata
    };
  }

  async createPortalSession(_input: {
    customer_id: string;
    return_url: string;
  }): Promise<{ url: string }> {
    return {
      url: "https://billing.stripe.test/portal/session_1"
    };
  }

  constructWebhookEvent(payload: Buffer): StripeWebhookEvent {
    const parsed = JSON.parse(payload.toString("utf8")) as { id: string; type: string; data: { object: unknown } };

    return {
      id: parsed.id,
      type: parsed.type,
      object: parsed.data.object
    };
  }

  async retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionSummary | null> {
    return this.subscriptions.get(subscriptionId) ?? null;
  }

  async retrieveCustomer(customerId: string): Promise<StripeCustomerSummary | null> {
    return this.customers.get(customerId) ?? null;
  }
}

const buildApp = () => {
  const config = createTestConfig();
  const usersRepository = new InMemoryUsersRepository();
  const subscriptionsRepository = new InMemorySubscriptionsRepository();
  const usageRepository = new InMemoryUsageRepository();

  const authProvider = new FakeAuthProvider({
    "valid-token": {
      auth_user_id: "00000000-0000-0000-0000-000000000001",
      email: "tester@cvbuilder.dev",
      full_name: "Test User",
      locale: "en"
    }
  });

  const entitlementsService = new EntitlementsService(
    createPlanCatalog({ proStripePriceId: config.billing.stripeProPriceId })
  );
  const usageService = new UsageService(usageRepository);
  const stripeGateway = new FakeStripeGateway();
  const billingService = new BillingService(
    usersRepository,
    subscriptionsRepository,
    usageService,
    entitlementsService,
    stripeGateway,
    {
      provider: config.billing.provider,
      checkoutSuccessUrl: config.billing.checkoutSuccessUrl,
      checkoutCancelUrl: config.billing.checkoutCancelUrl,
      portalReturnUrl: config.billing.portalReturnUrl,
      stripeWebhookSecret: "whsec_test",
      trialPeriodDays: config.billing.trialPeriodDays
    }
  );

  const app = createApp({
    config,
    services: {
      authService: new AuthService(authProvider, usersRepository),
      billingService
    },
    serviceOverrides: {
      usersRepository,
      billingSubscriptionsRepository: subscriptionsRepository,
      usageRepository,
      authProvider,
      stripeGateway
    }
  });

  return { app, stripeGateway, subscriptionsRepository };
};

describe("billing endpoints", () => {
  it("requires auth for protected billing routes", async () => {
    const { app } = buildApp();

    const response = await request(app).get("/api/v1/billing/plan");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("returns free-plan usage and entitlements for new users", async () => {
    const { app } = buildApp();

    const [planResponse, usageResponse, entitlementsResponse] = await Promise.all([
      request(app).get("/api/v1/billing/plan").set("Authorization", "Bearer valid-token"),
      request(app).get("/api/v1/billing/usage").set("Authorization", "Bearer valid-token"),
      request(app)
        .get("/api/v1/billing/entitlements")
        .set("Authorization", "Bearer valid-token")
    ]);

    expect(planResponse.status).toBe(200);
    expect(planResponse.body.success).toBe(true);
    expect(planResponse.body.data.plan_code).toBe("free");
    expect(planResponse.body.data.subscription_status).toBe("inactive");
    expect(planResponse.body.data.trial_eligible).toBe(true);

    expect(usageResponse.status).toBe(200);
    expect(usageResponse.body.data.plan_code).toBe("free");
    expect(usageResponse.body.data.limits.tailored_cv_generations).toBe(3);
    expect(usageResponse.body.data.remaining.tailored_cv_generations).toBe(3);

    expect(entitlementsResponse.status).toBe(200);
    expect(entitlementsResponse.body.data.can_generate_tailored_cv).toBe(true);
    expect(entitlementsResponse.body.data.can_export_pdf).toBe(true);
    expect(entitlementsResponse.body.data.can_use_ai_actions).toBe(true);
  });

  it("supports checkout, portal, and webhook subscription sync", async () => {
    const { app } = buildApp();

    const checkoutResponse = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer valid-token")
      .send({
        plan_code: "pro"
      });

    expect(checkoutResponse.status).toBe(200);
    expect(checkoutResponse.body.success).toBe(true);
    expect(checkoutResponse.body.data.checkout_url).toContain("checkout.stripe.test");

    const portalResponse = await request(app)
      .post("/api/v1/billing/portal")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(portalResponse.status).toBe(200);
    expect(portalResponse.body.success).toBe(true);
    expect(portalResponse.body.data.portal_url).toContain("billing.stripe.test");

    const webhookPayload = {
      id: "evt_test_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_test_1",
          customer: "cus_test_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_start: 1711929600,
          current_period_end: 1714521600,
          metadata: {},
          items: {
            data: [
              {
                price: {
                  id: "price_pro_monthly"
                }
              }
            ]
          }
        }
      }
    };

    const webhookResponse = await request(app)
      .post("/api/v1/billing/webhooks")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(webhookPayload));

    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body.success).toBe(true);
    expect(webhookResponse.body.data.processed).toBe(true);

    const updatedPlan = await request(app)
      .get("/api/v1/billing/plan")
      .set("Authorization", "Bearer valid-token");

    expect(updatedPlan.status).toBe(200);
    expect(updatedPlan.body.data.plan_code).toBe("pro");
    expect(updatedPlan.body.data.subscription_status).toBe("active");

    const updatedUsage = await request(app)
      .get("/api/v1/billing/usage")
      .set("Authorization", "Bearer valid-token");

    expect(updatedUsage.status).toBe(200);
    expect(updatedUsage.body.data.plan_code).toBe("pro");
    expect(updatedUsage.body.data.limits.tailored_cv_generations).toBeNull();
    expect(updatedUsage.body.data.remaining.tailored_cv_generations).toBeNull();
  });

  it("grants a trial on the first Pro checkout", async () => {
    const { app, stripeGateway } = buildApp();

    const response = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer valid-token")
      .send({ plan_code: "pro" });

    expect(response.status).toBe(200);
    expect(response.body.data.trial_applied).toBe(true);
    expect(response.body.data.trial_period_days).toBe(3);
    expect(stripeGateway.lastCheckoutTrialPeriodDays).toBe(3);
  });

  it("does not grant a second trial once the user has already had a Pro subscription", async () => {
    const { app, stripeGateway } = buildApp();

    // First trial checkout.
    const firstCheckout = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer valid-token")
      .send({ plan_code: "pro" });
    expect(firstCheckout.body.data.trial_applied).toBe(true);

    // The trial runs and is later canceled; Stripe ultimately reports the
    // subscription as canceled, which persists a real `pro` subscription row.
    const canceledWebhook = {
      id: "evt_trial_canceled",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test_1",
          customer: "cus_test_1",
          status: "canceled",
          cancel_at_period_end: false,
          current_period_start: 1711929600,
          current_period_end: 1712188800,
          metadata: {},
          items: { data: [{ price: { id: "price_pro_monthly" } }] }
        }
      }
    };

    await request(app)
      .post("/api/v1/billing/webhooks")
      .set("stripe-signature", "sig_test")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(canceledWebhook));

    // The billing plan endpoint should now report the user as trial-ineligible,
    // so the UI can swap the trial CTA for a plain subscribe CTA.
    const planAfterCancel = await request(app)
      .get("/api/v1/billing/plan")
      .set("Authorization", "Bearer valid-token");
    expect(planAfterCancel.status).toBe(200);
    expect(planAfterCancel.body.data.trial_eligible).toBe(false);

    // Attempting to start over must not hand out another free trial.
    const secondCheckout = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer valid-token")
      .send({ plan_code: "pro" });

    expect(secondCheckout.status).toBe(200);
    expect(secondCheckout.body.data.trial_applied).toBe(false);
    expect(secondCheckout.body.data.trial_period_days).toBeNull();
    expect(stripeGateway.lastCheckoutTrialPeriodDays).toBeNull();
  });

  it("lets a user buy Pro directly without a trial via with_trial=false", async () => {
    const { app, stripeGateway } = buildApp();

    const response = await request(app)
      .post("/api/v1/billing/checkout")
      .set("Authorization", "Bearer valid-token")
      .send({ plan_code: "pro", with_trial: false });

    expect(response.status).toBe(200);
    expect(response.body.data.trial_applied).toBe(false);
    expect(response.body.data.trial_period_days).toBeNull();
    expect(stripeGateway.lastCheckoutTrialPeriodDays).toBeNull();
  });
});
