import type { PrivacyService } from "../src/modules/privacy/privacy.service";
import { NotFoundError } from "../src/shared/errors/app-error";
import type { TailoredCvService } from "../src/modules/tailored-cv/tailored-cv.service";
import type { TailoringService } from "../src/modules/tailoring/tailoring.service";
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
  const privacyService = { assertProcessingAvailable: vi.fn(async () => {}), assertCollection: vi.fn(async () => {}), assertProductAccess: vi.fn(async () => {}) } as unknown as PrivacyService;
  // Downstream services are inert: these tests only decide whether the paywall lets a request through.
  const sink = <T>(extra: Record<string, unknown> = {}) => new Proxy(extra, { get: (target, key) => key in target ? target[key as string] : key === "then" ? undefined : async () => ({}) }) as T;
  const tailoringService = sink<TailoringService>({ isAdmin: () => false, isFreeSession: vi.fn(async (_userId: string, sessionId: string) => sessionId === FREE_SESSION) });
  const app = createApp({ config, services: {
    authService, billingService: billing, masterCvService, tailoredCvService, privacyService, tailoringService,
    dashboardService: sink(), jobsService: sink(), coverLettersService: sink(), importsService: sink(), renderingService: sink(), exportsService: sink(), aiService: sink(), cvPhotosService: sink(), cvRevisionsService: sink()
  }, serviceOverrides: { usersRepository: users, billingSubscriptionsRepository: subscriptions, usageRepository, authProvider } });
  const get = (path: string) => request(app).get(`/api/v1${path}`).set("Authorization", "Bearer token");
  const send = (method: "get" | "post" | "put" | "patch" | "delete", path: string) => request(app)[method](`/api/v1${path}`).set("Authorization", "Bearer token").send({});
  const confirm = () => request(app).post("/api/v1/billing/checkout/confirm").set("Authorization", "Bearer token").send({ session_id: "cs_test_owned" });
  return { app, get, send, confirm, billing, entitlements, listMasterCvs, subscriptions, usageRepository, userId, cvId, setCheckout: (row: Partial<StripeCheckoutSessionSummary>) => { checkout = { ...checkout, ...row }; }, setSubscription: (row: Partial<StripeSubscriptionSummary>) => { subscription = { ...subscription, ...row }; } };
}

const FREE_SESSION = "00000000-0000-0000-0000-0000000000f1";
const OTHER_SESSION = "00000000-0000-0000-0000-0000000000f2";
const ID = "00000000-0000-0000-0000-000000000001";
// The surface of the trial paywall that refused the request, or null when it was let through.
const paywall = (response: request.Response): string | null =>
  response.status === 403 && response.body.error?.details?.reason === "trial_required" ? response.body.error.details.surface : null;

const FREE_REQUESTS = [
  ["get", "/dashboard"], ["get", "/master-cvs"], ["get", "/MASTER-CVS/"], ["get", "/tailored-cvs"], ["get", "/jobs"], ["get", "/cover-letters"],
  ["post", "/master-cvs"], ["post", `/master-cvs/${ID}/duplicate`], ["put", "/master-cvs/00000000-0000-0000-0000-000000000099/content"], ["patch", `/tailored-cvs/${ID}/template`],
  ["post", "/imports/upload-url"], ["post", "/imports"], ["post", `/imports/${ID}/parse`], ["post", `/imports/${ID}/create-master-cv`],
  ["post", "/rendering/preview"], ["get", `/master-cvs/${ID}/preview`], ["get", `/master-cvs/${ID}/exports`],
  ["post", `/jobs/${ID}/cover-letter`], ["put", `/cover-letters/${ID}/content`], ["post", `/revisions/${ID}/restore`], ["post", "/cv-photos/upload-url"],
  ["post", "/ai/import-improve"], ["post", "/ai/tailoring-sessions"], ["get", `/ai/tailoring-sessions/${OTHER_SESSION}`], ["get", "/ai/tailoring-sessions/active"],
  ["patch", "/ai/tailoring-preferences"],
  ...["analyze", "requirements/r1", "answers/q1", "questions/complete", "tasks/t1/run", "blocks/b1/refine", "suggestions/s1/decision", "finish"]
    .map((step): readonly ["put" | "post", string] => [step.startsWith("requirements") || step.startsWith("answers") ? "put" : "post", `/ai/tailoring-sessions/${FREE_SESSION}/${step}`])
] as const;

const GATED_REQUESTS = [
  ["post", `/master-cvs/${ID}/exports/pdf`, "export"], ["post", `/tailored-cvs/${ID}/exports/docx`, "export"], ["post", `/Tailored-CVs/${ID}/exports/pdf/`, "export"],
  ["get", `/exports/${ID}`, "export"], ["get", `/exports/${ID}/download`, "export"],
  ["post", `/cover-letters/${ID}/exports/pdf`, "export"], ["get", `/cover-letter-exports/${ID}`, "export"], ["get", `/cover-letter-exports/${ID}/download`, "export"],
  ["post", "/ai/blocks/suggest", "ai"], ["post", `/master-cvs/${ID}/translations`, "ai"], ["post", `/master-cvs/${ID}/translations/${ID}/apply`, "ai"], ["post", `/ai/suggestions/${ID}/apply`, "ai"],
  ["post", "/ai/cover-letters/generate", "cover_letter"],
  ["post", "/ai/tailoring-runs/start", "tailoring"], ["post", "/ai/job-analysis", "tailoring"], ["post", "/ai/tailored-cv-draft", "tailoring"],
  ["post", `/ai/tailoring-sessions/${OTHER_SESSION}/analyze`, "tailoring"], ["post", `/ai/tailoring-sessions/${OTHER_SESSION}/tasks/t1/run`, "tailoring"], ["post", `/ai/tailoring-sessions/${OTHER_SESSION}/finish`, "tailoring"]
] as const;

describe("subscription-required application access", () => {
  it("lets free accounts use the workspace, the free session and the free improvement, and gates everything else", async () => {
    const f = await fixture();
    for (const [method, path] of FREE_REQUESTS) {
      const response = await f.send(method, path);
      expect(paywall(response), `${method} ${path}`).toBeNull();
      expect([401, 404], `${method} ${path}`).not.toContain(response.status);
    }
    for (const [method, path, surface] of GATED_REQUESTS) {
      const response = await f.send(method, path);
      expect(paywall(response), `${method} ${path}`).toBe(surface);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
    expect((await f.get("/master-cvs")).status).toBe(200);
    expect((await f.get("/me")).status).toBe(200);
    expect((await f.get("/billing/plan")).body.data).toMatchObject({
      app_access: false, can_edit_existing_cvs: true, subscription_required: true, plan_code: "free",
      free_tier: { tailoring_available: true, improve_available: true },
      entitlement_summary: { can_export_pdf: false, can_export_docx: false, can_use_ai_actions: false, can_generate_tailored_cv: false }
    });
    expect((await request(f.app).get("/api/v1/master-cvs")).status).toBe(401);
    expect((await request(f.app).post(`/api/v1/master-cvs/${ID}/exports/pdf`)).status).toBe(401);
  });

  it("claims each free use once, atomically, and reports it on the billing plan", async () => {
    const f = await fixture();
    const claims = await Promise.allSettled([f.billing.claimFreeUse(f.userId, "improve"), f.billing.claimFreeUse(f.userId, "improve")]);
    expect(claims.filter(claim => claim.status === "fulfilled" && claim.value)).toHaveLength(1);
    expect(claims.find(claim => claim.status === "rejected")).toMatchObject({ reason: { statusCode: 403, details: { reason: "trial_required", surface: "ai", action: "ai_action" } } });
    expect((await f.get("/billing/plan")).body.data.free_tier).toEqual({ tailoring_available: true, improve_available: false });

    const tailoring = await f.billing.claimFreeUse(f.userId, "tailoring");
    expect(tailoring).toMatchObject({ use: "tailoring" });
    await f.billing.releaseFreeUse(f.userId, tailoring);
    expect((await f.get("/billing/plan")).body.data.free_tier.tailoring_available).toBe(true);
    await f.billing.claimFreeUse(f.userId, "tailoring");
    await expect(f.billing.claimFreeUse(f.userId, "tailoring")).rejects.toMatchObject({ details: { reason: "trial_required", surface: "tailoring" } });
    expect((await f.get("/billing/plan")).body.data.free_tier).toEqual({ tailoring_available: false, improve_available: false });
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
    for (const path of [`/master-cvs/${f.cvId}/exports/pdf`, `/tailored-cvs/${f.cvId}/exports/docx`, `/master-cvs/${f.cvId}/translations`, "/ai/blocks/suggest", "/ai/tailoring-runs/start"]) {
      expect(paywall(await f.send("post", path)), path).not.toBeNull();
    }
    expect(paywall(await f.get("/exports/00000000-0000-0000-0000-000000000001/download"))).toBe("export");
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
  it("never consumes a free use while trialing and unlocks every gated request", async () => {
    const f = await fixture();
    expect((await f.confirm()).status).toBe(200);
    expect(await f.billing.claimFreeUse(f.userId, "tailoring")).toBeNull();
    expect(await f.billing.claimFreeUse(f.userId, "improve")).toBeNull();
    expect(await f.usageRepository.getFreeTierMarkers(f.userId)).toEqual({ tailoring: null, improve: null });
    for (const [method, path] of GATED_REQUESTS) {
      expect(paywall(await f.send(method, path)), `${method} ${path}`).toBeNull();
    }
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
    expect(paywall(await f.send("post", `/master-cvs/${f.cvId}/exports/pdf`))).toBe("export");
  });
  it("does not grant access for another customer's subscription even with an owned session", async () => {
    const f = await fixture();
    f.setSubscription({ customer_id: "cus_other" });
    expect((await f.confirm()).status).toBe(404);
    expect(paywall(await f.send("post", "/ai/blocks/suggest"))).toBe("ai");
  });
  it("expires a trial at its recorded end even when the cancellation webhook is delayed", async () => {
    const f = await fixture();
    expect((await f.confirm()).status).toBe(200);
    const row = await f.subscriptions.getCurrentForUser(f.userId);
    await f.subscriptions.upsertProviderSubscription({ ...row!, current_period_end: new Date(Date.now() - 1000).toISOString() });
    expect((await f.get("/billing/plan")).body.data.app_access).toBe(false);
    expect(paywall(await f.get(`/exports/${ID}/download`))).toBe("export");
    expect((await f.get("/master-cvs")).status).toBe(200);
  });
  it("retains the legacy allowance definitions while disabling them independently of the subscription gate", async () => {
    const f = await fixture();
    expect(f.entitlements.getPlanDefinition("free").limits).toEqual({ tailored_cv_generations: null, exports: null, ai_actions: null, storage_bytes: null });
    expect(createPlanCatalog({ freeUsageLimitsEnabled: true }).free.limits).toMatchObject({ tailored_cv_generations: 3, exports: 5, ai_actions: 20 });
    await expect(f.billing.assertActionAllowed(f.userId, "ai_action")).rejects.toMatchObject({ statusCode: 403 });
  });
});
