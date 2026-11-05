import { describe, expect, it, vi } from "vitest";
import { BillingService } from "../src/modules/billing/billing.service";
import { trialEndLabel, trialSubmitMessage, type CreateStripeCheckoutInput, type CreateStripePortalInput, type StripeGateway } from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { UsageService } from "../src/modules/usage/usage.service";
import { ConflictError } from "../src/shared/errors/app-error";
import { InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository, createTestConfig } from "./helpers/in-memory";

const build = (locale: "en" | "tr" = "en") => {
  const config = createTestConfig();
  const users = new InMemoryUsersRepository();
  const subscriptions = new InMemorySubscriptionsRepository();
  const createCheckoutSession = vi.fn(async (_input: CreateStripeCheckoutInput) => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1", customer_id: "cus_1", subscription_id: null, metadata: {} }));
  const createPortalSession = vi.fn(async (_input: CreateStripePortalInput) => ({ url: "https://billing.stripe.test" }));
  const gateway = {
    hasBillableSubscription: async () => false,
    createCustomer: async () => ({ id: "cus_1", email: null, name: null, metadata: {} }),
    createCheckoutSession,
    createPortalSession,
    constructWebhookEvent: () => { throw new Error("unused"); },
    retrieveSubscription: async () => null,
    retrieveCustomer: async () => ({ id: "cus_1", email: null, name: null, metadata: {} })
  } satisfies StripeGateway;
  const billing = new BillingService(
    users, subscriptions, new UsageService(new InMemoryUsageRepository()),
    new EntitlementsService(createPlanCatalog({ weeklyStripePriceId: config.billing.stripeWeeklyPriceId, monthlyStripePriceId: config.billing.stripeMonthlyPriceId })),
    gateway,
    {
      provider: "stripe", checkoutSuccessUrl: config.billing.checkoutSuccessUrl, checkoutCancelUrl: config.billing.checkoutCancelUrl,
      portalReturnUrl: config.billing.portalReturnUrl, stripeWebhookSecret: "whsec_test", trialPeriodDays: 3
    }
  );
  const user = () => users.ensureByAuthIdentity({ auth_user_id: "auth-1", email: "payer@example.invalid", full_name: null, locale });
  const seed = (status: string, extra: { cancel_at_period_end?: boolean; plan_code?: string } = {}) => (userId: string) => subscriptions.seed({
    id: "row-1", user_id: userId, provider: "stripe", provider_customer_id: "cus_1", provider_subscription_id: "sub_1", plan_code: extra.plan_code ?? "monthly", status,
    current_period_start: null, current_period_end: new Date(Date.now() + 86_400_000).toISOString(), cancel_at_period_end: extra.cancel_at_period_end ?? false,
    created_at: "2026-10-01", updated_at: "2026-10-01"
  });
  return { billing, user, seed, createCheckoutSession, createPortalSession };
};

describe("trial terms at Stripe Checkout", () => {
  it("formats the trial end for the customer's language and time zone", () => {
    const now = Date.parse("2026-11-02T22:30:00Z");
    expect(trialEndLabel("en", 3, "UTC", null, now)).toBe("November 5, 2026");
    expect(trialEndLabel("tr", 3, undefined, "TR", now)).toBe("6 Kasım 2026");
    expect(trialEndLabel("en", 3, "Not/AZone", null, now)).toBe("November 5, 2026");
    expect(trialSubmitMessage("en", "November 5, 2026")).toBe("You won't be charged today. Your trial ends on November 5, 2026; cancel anytime before then.");
    expect(trialSubmitMessage("tr", "5 Kasım 2026")).toContain("Bugün ücret alınmaz. Deneme süreniz 5 Kasım 2026 tarihinde sona erer");
  });

  it("explains the trial next to the submit button only when a trial applies", async () => {
    const f = build("tr");
    const user = await f.user();
    await f.billing.createCheckoutSession(user.id, { plan_code: "monthly", with_trial: true, time_zone: "Europe/Istanbul" });
    const message = f.createCheckoutSession.mock.calls[0][0].submit_message;
    expect(message).toBe(trialSubmitMessage("tr", trialEndLabel("tr", 3, "Europe/Istanbul")));
    expect(f.createCheckoutSession.mock.calls[0][0]).toMatchObject({ price_id: "price_monthly", trial_period_days: 3 });

    await f.billing.createCheckoutSession(user.id, { plan_code: "monthly", with_trial: false });
    expect(f.createCheckoutSession.mock.calls[1][0].submit_message).toBeUndefined();
    // Weekly is a paid plan without a trial: no "won't be charged today" line.
    await f.billing.createCheckoutSession(user.id, { plan_code: "weekly", with_trial: false });
    expect(f.createCheckoutSession.mock.calls[2][0]).toMatchObject({ price_id: "price_weekly", trial_period_days: null, submit_message: undefined });
  });
});

describe("billing portal reachability", () => {
  it("sends a past-due subscriber to the portal instead of a second subscription", async () => {
    for (const status of ["past_due", "unpaid"]) {
      const f = build();
      const user = await f.user();
      f.seed(status)(user.id);
      const rejected = f.billing.createCheckoutSession(user.id, { plan_code: "monthly" });
      await expect(rejected).rejects.toBeInstanceOf(ConflictError);
      await expect(rejected).rejects.toMatchObject({ details: { reason: "subscription_active", billing_issue: true } });
      expect(f.createCheckoutSession).not.toHaveBeenCalled();
      const plan = await f.billing.getBillingPlan(user.id);
      expect(plan).toMatchObject({ plan_code: "free", subscription_status: status, provider: { provider_subscription_id: "sub_1" } });
      await expect(f.billing.createPortalSession(user.id, { flow: "payment_method" })).resolves.toEqual({ portal_url: "https://billing.stripe.test" });
      expect(f.createPortalSession.mock.calls[0][0].flow).toEqual({ type: "payment_method_update" });
    }
  });

  it.each(["monthly", "weekly"])("opens %s trial cancellation directly and falls back to the portal home when Stripe refuses the deep link", async planCode => {
    const f = build();
    const user = await f.user();
    f.seed("trialing", { plan_code: planCode })(user.id);
    await f.billing.createPortalSession(user.id, { flow: "cancel" });
    expect(f.createPortalSession.mock.calls[0][0].flow).toEqual({ type: "subscription_cancel", subscription_id: "sub_1" });

    f.createPortalSession.mockRejectedValueOnce(new Error("subscription_cancel disabled"));
    await expect(f.billing.createPortalSession(user.id, { flow: "cancel" })).resolves.toEqual({ portal_url: "https://billing.stripe.test" });
    expect(f.createPortalSession.mock.calls[2][0].flow).toBeUndefined();
  });

  it("does not offer cancellation again once it is scheduled", async () => {
    const f = build();
    const user = await f.user();
    f.seed("trialing", { cancel_at_period_end: true })(user.id);
    await f.billing.createPortalSession(user.id, { flow: "cancel" });
    expect(f.createPortalSession.mock.calls[0][0].flow).toBeUndefined();
  });
});
