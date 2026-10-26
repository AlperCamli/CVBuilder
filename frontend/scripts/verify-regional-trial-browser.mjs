// Real UI and auth-resumer smoke test with isolated API/auth transports.
// Run from frontend: node scripts/verify-regional-trial-browser.mjs
// No request reaches Stripe, Supabase, analytics, or the production backend.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";
import puppeteer from "puppeteer";

process.env.VITE_API_BASE_URL = "/api/v1";
process.env.VITE_SUPABASE_URL = "https://trial-fixture.supabase.invalid";
process.env.VITE_SUPABASE_ANON_KEY = "isolated-trial-fixture-anon-key";
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
let browser;
try {
  browser = await puppeteer.launch({ headless: true });
  for (const market of ["TR", "GLOBAL"]) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      const currency = market === "TR" ? "try" : "usd";
      const amount = market === "TR" ? 6990 : 499;
      const userId = randomUUID();
      const now = new Date().toISOString();
      const user = { id: userId, aud: "authenticated", role: "authenticated", email: "trial@example.invalid", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Trial Fixture" }, identities: [], created_at: now };
      const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] })).toString("base64url"), "fixture-signature"].join(".");
      const limits = { tailored_cv_generations: 3, exports: 5, ai_actions: 20, storage_bytes: 25000000 };
      const usage = { plan_code: "free", limits, remaining: limits, period_month: now.slice(0, 7), exports_count: 0, ai_actions_count: 0, tailored_cv_generations_count: 0, storage_bytes_used: 0 };
      const plan = { plan_code: "free", subscription_status: "inactive", current_period_start: null, current_period_end: null, cancel_at_period_end: false, trial_eligible: true, provider: { provider: "stripe", provider_customer_id: null, provider_subscription_id: null }, entitlement_summary: { plan_code: "free", limits, remaining: limits } };
      const prices = { market, currency, available: true, quote: `isolated-${market}-quote`, plans: [
        { code: "weekly", amount, interval: "week", interval_count: 1, trial_days: 3 },
        { code: "monthly", amount: market === "TR" ? 24900 : 1499, interval: "month", interval_count: 1, trial_days: 0 },
        { code: "annual", amount: market === "TR" ? 149990 : 9999, interval: "year", interval_count: 1, trial_days: 0 }
      ] };
      const requests = [], errors = [], unexpected = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on("request", async req => {
        try {
          const url = new URL(req.url());
          const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
          const raw = data => req.respond({ status: 200, headers, body: JSON.stringify(data) });
          const respond = data => raw({ success: true, data });
          if (req.method() === "OPTIONS") return void await req.respond({ status: 204, headers });
          if (url.hostname === "trial-fixture.supabase.invalid") return void await raw(user);
          if (url.hostname === "checkout.stripe.test") return void await req.respond({ status: 200, contentType: "text/html", body: "<h1>Isolated Stripe checkout destination</h1>" });
          if (url.origin !== base) return void await req.respond({ status: 204, headers });
          if (!url.pathname.startsWith("/api/v1/")) return void await req.continue();
          const path = url.pathname.slice("/api/v1".length);
          if (path === "/privacy/config") return void await respond({ notice_version: "2026-10-06.2", controller: "Trial fixture", address: "Test", contact: "test@example.invalid", processors: [], collection_enabled: true, ai_required: true, ai_enabled: true, ai_provider: "Test", analytics_enabled: false });
          if (path === "/billing/prices") return void await respond(prices);
          if (path === "/billing/plan") return void await respond(plan);
          if (path === "/billing/usage") return void await respond(usage);
          if (path === "/billing/entitlements") return void await respond(plan.entitlement_summary);
          if (path === "/me") return void await respond({ user: { id: userId, auth_user_id: userId, email: user.email, full_name: "Trial Fixture", locale: "en", default_cv_language: "en", onboarding_completed: true, onboarding_state: {}, created_at: now, updated_at: now }, current_plan: { plan_code: "free", status: "inactive" }, entitlements: plan.entitlement_summary, usage_summary: usage });
          if (path === "/me/privacy") return void await respond({ analytics: false, ai_processing: false, privacy_revision: 0 });
          if (path === "/me/settings") return void await respond({ settings: { default_cv_language: "en", locale: "en", onboarding_completed: true, onboarding_state: {} } });
          if (path === "/billing/checkout") {
            requests.push(JSON.parse(req.postData()));
            assert.equal(req.headers().authorization, `Bearer ${token}`);
            return void await respond({ checkout_url: "https://checkout.stripe.test/trial", checkout_session_id: "cs_test_trial", plan_code: "weekly", plan_name: "Weekly", trial_applied: true, trial_period_days: 3, amount, currency });
          }
          unexpected.push(`${req.method()} ${path}`);
          await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Unconfigured test fixture" } }) });
        } catch (error) {
          unexpected.push(error.message);
          if (!req.isInterceptResolutionHandled()) await req.abort();
        }
      });
      await page.evaluateOnNewDocument(() => localStorage.setItem("cv-interface-locale", "en"));
      await page.goto(`${base}/pricing`, { waitUntil: "networkidle0" });
      await page.waitForSelector("button.gj-trial-link:not([disabled])");
      await page.locator("button.gj-trial-link").click();
      await page.waitForSelector("button.pd-primary:not([disabled])");
      assert.match(await page.$eval(".gj-trial-terms", el => el.innerText), /First 3 days/);
      await page.locator("button.pd-primary").click();
      await page.waitForFunction(() => location.pathname === "/onboarding");
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("cv-builder:pending-checkout"))), { plan_code: "weekly", with_trial: true });
      assert.equal(requests.length, 0, "public trial click must wait for authentication");
      // Simulate completed signup on this browser; real signup/upload providers
      // are outside this isolated billing test. Exercise the actual auth resumer.
      await page.evaluate(({ token, user }) => localStorage.setItem("sb-trial-fixture-auth-token", JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user })), { token, user });
      await page.goto(`${base}/app/pricing`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => location.hostname === "checkout.stripe.test");
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], { pricing_quote: prices.quote, plan_code: "weekly", success_url: `${base}/app/pricing?checkout=success`, cancel_url: `${base}/app/pricing?checkout=cancel` });
      assert.deepEqual(unexpected, [], "no unconfigured API requests");
      assert.deepEqual(errors, [], "no browser runtime errors");
      console.log(`PASS ${market}/${currency.toUpperCase()}: trial button → stored Weekly trial → authenticated resumer → correct regional checkout request → Stripe redirect`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.close();
  await server.close();
}
