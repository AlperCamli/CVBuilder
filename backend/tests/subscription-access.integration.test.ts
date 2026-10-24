import type { PrivacyService } from "../src/modules/privacy/privacy.service";
import { NotFoundError } from "../src/shared/errors/app-error";
import type { TailoredCvService } from "../src/modules/tailored-cv/tailored-cv.service";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { AuthService } from "../src/modules/auth/auth.service";
import { BillingService } from "../src/modules/billing/billing.service";
import { EntitlementsService } from "../src/modules/entitlements/entitlements.service";
import { createPlanCatalog } from "../src/modules/entitlements/plan-definitions";
import { UsageService } from "../src/modules/usage/usage.service";
import type { MasterCvService } from "../src/modules/master-cv/master-cv.service";
import type { StripeCheckoutSessionSummary, StripeGateway, StripeSubscriptionSummary } from "../src/modules/billing/stripe-gateway";
import { FakeAuthProvider, InMemorySubscriptionsRepository, InMemoryUsageRepository, InMemoryUsersRepository, createTestConfig } from "./helpers/in-memory";

async function fixture() {
  const config = createTestConfig();
  config.billing.requireSubscription = true;
  config.billing.freeUsageLimitsEnabled = false;
  const users = new InMemoryUsersRepository();
  const subscriptions = new InMemorySubscriptionsRepository();
  const usageRepository = new InMemoryUsageRepository();
  const authProvider = new FakeAuthProvider({ token: { auth_user_id: "00000000-0000-0000-0000-000000000001", email: "trial@example.invalid", full_name: "Trial Candidate", locale: "en" } });
  const authService = new AuthService(authProvider, users);
  const session = await authService.authenticate("token");
  const userId = session.appUser.id;
  const entitlements = new EntitlementsService(createPlanCatalog({ freeUsageLimitsEnabled: false, weeklyStripePriceId: "price_weekly" }));
  let checkout: StripeCheckoutSessionSummary = { id: "cs_test_owned", url: null, customer_id: "cus_owned", subscription_id: "sub_owned", metadata: { app_user_id: userId }, status: "complete", payment_status: "no_payment_required" };
  let subscription: StripeSubscriptionSummary = { id: "sub_owned", customer_id: "cus_owned", status: "trialing", cancel_at_period_end: false, current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 3 * 86400000).toISOString(), price_ids: ["price_weekly"], metadata: { app_user_id: userId, plan_code: "weekly" } };
  const gateway = {
    retrieveCheckoutSession: vi.fn(async () => checkout),
    retrieveSubscription: vi.fn(async () => subscription),
  } as unknown as StripeGateway;
  const billing = new BillingService(users, subscriptions, new UsageService(usageRepository), entitlements, gateway, {
    requireSubscription: true, provider: "stripe", trialPeriodDays: 3, stripeWebhookSecret: null,
    checkoutSuccessUrl: "http://localhost:5173/app/checkout", checkoutCancelUrl: "http://localhost:5173/app/checkout", portalReturnUrl: "http://localhost:5173/app/pricing"
  });
  const cvId = "00000000-0000-0000-0000-000000000099";
  const cv = { id: cvId, title: "Saved CV", source_type: "import", current_content: { version: "v1", sections: [] as unknown[] } };
  const listMasterCvs = vi.fn(async () => [cv]);
  const getMasterCv = vi.fn(async (_session: unknown, id: string) => {
    if (id !== cvId) throw new NotFoundError();
    return cv;
  });
  const replaceMasterCvContent = vi.fn(async (session: unknown, id: string, input: { current_content: typeof cv.current_content }) => {
    await getMasterCv(session, id);
    cv.current_content = input.current_content;
    return cv;
  });
  const masterCvService = { listMasterCvs, getMasterCv, replaceMasterCvContent, getMasterCvPreview: async () => ({ id: cvId }) } as unknown as MasterCvService;
  const tailoredCvService = { listTailoredCvs: async () => [cv], getTailoredCv: getMasterCv, replaceTailoredCvContent: replaceMasterCvContent } as unknown as TailoredCvService;
  const privacyService = { assertProcessingAvailable: vi.fn(async () => {}), assertProductAccess: vi.fn(async () => { throw new Error("AI consent is disabled in this fixture"); }) } as unknown as PrivacyService;
  const app = createApp({ config, services: { authService, billingService: billing, masterCvService, tailoredCvService, privacyService }, serviceOverrides: { usersRepository: users, billingSubscriptionsRepository: subscriptions, usageRepository, authProvider } });
  const get = (path: string) => request(app).get(`/api/v1${path}`).set("Authorization", "Bearer token");
  const confirm = () => request(app).post("/api/v1/billing/checkout/confirm").set("Authorization", "Bearer token").send({ session_id: "cs_test_owned" });
  return { app, get, confirm, billing, entitlements, listMasterCvs, subscriptions, userId, cvId, setCheckout: (row: Partial<StripeCheckoutSessionSummary>) => { checkout = { ...checkout, ...row }; }, setSubscription: (row: Partial<StripeSubscriptionSummary>) => { subscription = { ...subscription, ...row }; } };
}

describe("subscription-required application access", () => {
  it("blocks application reads and writes while leaving account and billing reachable", async () => {
    const f = await fixture();
    for (const path of ["/master-cvs", "/dashboard", "/jobs", "/cover-letters", "/revisions/00000000-0000-0000-0000-000000000001", "/exports/00000000-0000-0000-0000-000000000001"]) {
      const response = await f.get(path);
      expect(response.status, path).toBe(403);
      expect(response.body.error.details.reason).toBe("subscription_required");
    }
    const write = await request(f.app).post("/api/v1/master-cvs").set("Authorization", "Bearer token").send({ title: "Bypass" });
    expect(write.status).toBe(403);
    expect(f.listMasterCvs).not.toHaveBeenCalled();
    expect((await f.get("/me")).status).toBe(200);
    expect((await f.get("/billing/plan")).body.data).toMatchObject({ app_access: false, subscription_required: true, plan_code: "free" });
    expect((await request(f.app).get("/api/v1/master-cvs")).status).toBe(401);
  });
  it.each([null, "2026-10-24T00:00:00Z"])("keeps manual CV access for existing users after trial redemption=%s", async redeemedAt => {
    const f = await fixture();
    f.subscriptions.transitionGrants.set(f.userId, { redeemed_at: redeemedAt });
    expect((await f.get("/billing/plan")).body.data).toMatchObject({ app_access: false, can_edit_existing_cvs: true, entitlement_summary: { can_export_pdf: false, can_export_docx: false, can_use_ai_actions: false, can_generate_tailored_cv: false } });
    expect((await f.get("/master-cvs")).status).toBe(200);
    expect((await f.get("/tailored-cvs")).status).toBe(200);
    for (const prefix of ["master-cvs", "tailored-cvs"]) {
      expect((await f.get(`/${prefix}/${f.cvId}`)).status).toBe(200);
      const saved = await request(f.app).put(`/api/v1/${prefix}/${f.cvId}/content`).set("Authorization", "Bearer token").send({ current_content: { version: "v1", metadata: { edited_manually: true }, sections: [] } });
      expect(saved.status).toBe(200);
      expect((await f.get(`/${prefix}/${f.cvId}`)).body.data.current_content.metadata.edited_manually).toBe(true);
      expect((await f.get(`/${prefix}/00000000-0000-0000-0000-000000000098`)).status).toBe(404);
    }
    for (const path of ["/MASTER-CVS/", "/TAILORED-CVS", "/master-cvs", "/tailored-cvs", `/master-cvs/${f.cvId}/duplicate`, `/master-cvs/${f.cvId}/exports/pdf`, `/tailored-cvs/${f.cvId}/exports/docx`, `/master-cvs/${f.cvId}/translations`, "/ai/block-suggest", "/ai/tailoring-runs"]) {
      const response = await request(f.app).post(`/api/v1${path}`).set("Authorization", "Bearer token").send({});
      expect(response.status, path).toBe(403);
      expect(response.body.error.details.reason, path).toBe("subscription_required");
    }
    expect((await f.get("/exports/00000000-0000-0000-0000-000000000001/download")).status).toBe(403);
    await expect(f.billing.assertActionAllowed(f.userId, "ai_action")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("retains existing-user manual access when a trial expires", async () => {
    const f = await fixture();
    f.subscriptions.transitionGrants.set(f.userId, { redeemed_at: new Date().toISOString() });
    await f.confirm();
    const row = await f.subscriptions.getCurrentForUser(f.userId);
    await f.subscriptions.upsertProviderSubscription({ ...row!, current_period_end: new Date(Date.now() - 1000).toISOString() });
    expect((await f.get("/billing/plan")).body.data).toMatchObject({ app_access: false, can_edit_existing_cvs: true });
    expect((await f.get(`/master-cvs/${f.cvId}`)).status).toBe(200);
    await expect(f.billing.assertActionAllowed(f.userId, "export_pdf")).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each(["trialing", "active"])("unlocks verified %s subscriptions before a webhook arrives", async status => {
    const f = await fixture();
    f.setSubscription({ status });
    const response = await f.confirm();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ app_access: true, subscription_status: status, plan_code: "weekly" });
    expect((await f.get("/master-cvs")).status).toBe(200);
    expect(f.listMasterCvs).toHaveBeenCalledTimes(1);
    // Refresh/repeated success returns synchronize the same subscription.
    expect((await f.confirm()).status).toBe(200);
  });
  it("rejects forged ownership, incomplete payments and canceled subscriptions", async () => {
    const f = await fixture();
    f.setCheckout({ metadata: { app_user_id: "another-user" } });
    expect((await f.confirm()).status).toBe(404);
    f.setCheckout({ metadata: { app_user_id: f.userId }, status: "open" });
    expect((await f.confirm()).status).toBe(409);
    f.setCheckout({ status: "complete", payment_status: "unpaid" });
    expect((await f.confirm()).status).toBe(409);
    f.setCheckout({ payment_status: "no_payment_required" });
    f.setSubscription({ status: "canceled" });
    expect((await f.confirm()).status).toBe(409);
    expect((await f.get("/master-cvs")).status).toBe(403);
  });
  it("does not grant access for another customer's subscription even with an owned session", async () => {
    const f = await fixture();
    f.setSubscription({ customer_id: "cus_other" });
    expect((await f.confirm()).status).toBe(404);
    expect((await f.get("/master-cvs")).status).toBe(403);
  });
  it("expires a trial at its recorded end even when the cancellation webhook is delayed", async () => {
    const f = await fixture();
    expect((await f.confirm()).status).toBe(200);
    const row = await f.subscriptions.getCurrentForUser(f.userId);
    await f.subscriptions.upsertProviderSubscription({ ...row!, current_period_end: new Date(Date.now() - 1000).toISOString() });
    expect((await f.get("/billing/plan")).body.data.app_access).toBe(false);
    expect((await f.get("/master-cvs")).status).toBe(403);
  });
  it("retains the legacy allowance definitions while disabling them independently of the subscription gate", async () => {
    const f = await fixture();
    expect(f.entitlements.getPlanDefinition("free").limits).toEqual({ tailored_cv_generations: null, exports: null, ai_actions: null, storage_bytes: null });
    expect(createPlanCatalog({ freeUsageLimitsEnabled: true }).free.limits).toMatchObject({ tailored_cv_generations: 3, exports: 5, ai_actions: 20 });
    await expect(f.billing.assertActionAllowed(f.userId, "ai_action")).rejects.toMatchObject({ statusCode: 403 });
  });
});
