// Exercises Profile → "Cancel" → the cancel screen for a trial and paid weekly / monthly / annual plans, and plan
// changes from Pricing, with isolated auth and billing transports: a trial's "Keep Pro" through a stand-in Stripe
// Checkout to the Pro welcome, paid offers applied in place, the no-offer screen, "No thanks" to Stripe's
// cancellation, an upgrade to Stripe's confirmation, and a downgrade waiting for the period end.
// Saves screenshots to artifacts/cancel-offer/.
// No request reaches a real Stripe/Supabase account or production backend.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import puppeteer from "puppeteer";

process.env.VITE_API_BASE_URL = "/api/v1";
process.env.VITE_SUPABASE_URL = "https://journey-fixture.supabase.invalid";
process.env.VITE_SUPABASE_ANON_KEY = "isolated-journey-fixture-key";
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const output = new URL("../../artifacts/cancel-offer/", import.meta.url);
await mkdir(output, { recursive: true });
const PORTAL = "https://billing.stripe.test";
const STRIPE_CHECKOUT = "https://checkout.stripe.test";
let browser;

const waitText = (page, text) => page.waitForFunction(value => document.body.innerText.includes(value), {}, text);
const clickText = async (page, text) => {
  await page.waitForFunction(value => [...document.querySelectorAll("button,a")].some(el => el.textContent.trim().includes(value) && !el.disabled), {}, text);
  const element = await page.evaluateHandle(value => [...document.querySelectorAll("button,a")].find(el => el.textContent.trim().includes(value) && !el.disabled), text);
  await element.asElement().click();
};

async function fixture({ locale = "en", market = "TR", offer = true, checkoutFails = null, mobile = false, plan = "weekly", status = "trialing" } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 1000 });
  const userId = randomUUID(), now = new Date().toISOString();
  const trialEnd = new Date(Date.now() + 2 * 86400000 + 3 * 3600000).toISOString();
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "candidate@example.invalid", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Test Candidate" }, identities: [], created_at: now };
  const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url"), "fixture-signature"].join(".");
  const session = { access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const limits = { tailored_cv_generations: null, exports: null, ai_actions: null, storage_bytes: null };
  const appUser = { id: userId, auth_user_id: userId, email: user.email, full_name: "Test Candidate", locale, default_cv_language: "en", onboarding_completed: true, onboarding_state: { completed_at: now }, onboarding_answers: {}, entry_onboarding_completed_at: now, created_at: now, updated_at: now };
  const entitlements = { plan_code: "weekly", limits, remaining: limits, can_generate_tailored_cv: true, can_export_pdf: true, can_export_docx: true, can_use_ai_actions: true };
  const usage = { plan_code: "weekly", limits, remaining: limits, period_month: now.slice(0, 7), tailored_cv_generations_count: 0, exports_count: 0, ai_actions_count: 0, storage_bytes_used: 0 };
  const tr = market === "TR";
  const prices = { market, currency: tr ? "try" : "usd", available: true, quote: "isolated-pricing", plans: [
    { code: "weekly", amount: tr ? 14990 : 499, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: tr ? 34990 : 1499, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: tr ? 149900 : 9990, interval: "year", interval_count: 1, trial_days: 0 }] };
  const state = { paid: false, accepted: false, checkoutInput: null, plan, status, scheduled: null };
  const renewal = new Date(Date.now() + 30 * 86400000).toISOString();
  const periodEnd = status === "trialing" ? trialEnd : new Date(Date.now() + (plan === "annual" ? 200 : plan === "monthly" ? 20 : 5) * 86400000).toISOString();
  const billing = () => ({ app_access: true, can_edit_existing_cvs: true, subscription_required: true, trial_transition: null, plan_code: state.paid ? "monthly" : state.plan, subscription_status: state.paid ? "active" : state.status, current_period_start: now, current_period_end: state.paid ? renewal : periodEnd, scheduled_change: state.scheduled, cancel_at_period_end: false, trial_eligible: false, free_tier: { tailoring_available: true, improve_available: true }, provider: { provider: "stripe", provider_customer_id: "cus_fixture", provider_subscription_id: "sub_fixture" }, entitlement_summary: entitlements });
  const kind = status === "trialing" ? "checkout" : plan === "weekly" ? "switch_at_period_end" : "renewal_discount";
  const offered = plan === "annual" && status === "active" ? null : "monthly";
  const cancelOffer = offered && { kind, slug: `${status === "trialing" ? "trial" : plan}-cancel-save50`, percent_off: 50, plan_code: offered, currency: prices.currency, amount: prices.plans[1].amount, discounted_amount: prices.plans[1].amount - Math.round(prices.plans[1].amount / 2), current_plan_code: plan, current_amount: prices.plans.find(item => item.code === plan).amount, period_end: periodEnd };
  const requests = [], errors = [], unexpected = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async req => {
    if (req.isInterceptResolutionHandled()) return;
    try {
      const url = new URL(req.url());
      const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
      const raw = data => req.respond({ status: 200, headers, body: JSON.stringify(data) });
      const respond = data => raw({ success: true, data });
      const fail = (status, code, message, details) => req.respond({ status, headers, body: JSON.stringify({ success: false, error: { code, message, ...(details ? { details } : {}) } }) });
      if (req.method() === "OPTIONS") return void await req.respond({ status: 204, headers });
      if (url.origin === PORTAL) return void await req.respond({ status: 200, contentType: "text/html", body: "<h1>Stripe portal: cancel trial</h1>" });
      if (url.origin === STRIPE_CHECKOUT) {
        const { success_url, cancel_url } = state.checkoutInput;
        return void await req.respond({ status: 200, contentType: "text/html", body: `<h1>Stripe Checkout: Pro Monthly</h1><button onclick='location.href=${JSON.stringify(success_url.replace("{CHECKOUT_SESSION_ID}", "cs_offer_1"))}'>Pay</button><a href=${JSON.stringify(cancel_url)}>Back</a>` });
      }
      if (url.hostname === "journey-fixture.supabase.invalid") {
        if (url.pathname.endsWith("/user")) return void await raw(user);
        if (url.pathname.endsWith("/token")) return void await raw(session);
        unexpected.push(`auth ${url.pathname}`); return void await req.abort();
      }
      if (url.origin !== base) return void await req.abort();
      if (!url.pathname.startsWith("/api/v1/")) return void await req.continue();
      const path = url.pathname.slice(7), body = req.postData() ? JSON.parse(req.postData()) : {};
      requests.push({ path, method: req.method(), body });
      if (path === "/privacy/config") return void await respond({ notice_version: "2026-10-06.2", controller: "Fixture", address: "Test", contact: "privacy@example.invalid", processors: [], collection_enabled: true, ai_required: true, ai_enabled: true, ai_provider: "Fixture", analytics_enabled: false });
      if (path === "/billing/prices") return void await respond(prices);
      assert(req.headers().authorization, `missing auth for ${path}`);
      if (path === "/me") return void await respond({ user: appUser, current_plan: { ...billing(), status: "trialing" }, entitlements, usage_summary: usage });
      if (path === "/me/privacy") return void await respond({ analytics: false, ai_processing: true, privacy_revision: 0 });
      if (path === "/me/settings") return void await respond({ settings: { default_cv_language: "en", locale, onboarding_completed: true, onboarding_state: {} } });
      if (path === "/billing/plan") return void await respond(billing());
      if (path === "/billing/usage") return void await respond(usage);
      if (path === "/billing/entitlements") return void await respond(entitlements);
      if (path === "/billing/cancel-offer") return void await respond(offer && cancelOffer && !state.paid && !state.accepted ? { status: "available", offer: cancelOffer } : { status: "unavailable", offer: null });
      if (path === "/billing/cancel-offer/accept") {
        assert.notEqual(kind, "checkout");
        state.accepted = true;
        if (kind === "switch_at_period_end") state.scheduled = { plan_code: "monthly", starts_at: periodEnd };
        return void await respond({ accepted: true, offer: cancelOffer, plan: billing() });
      }
      if (path === "/billing/plan-change" && req.method() === "POST") {
        state.scheduled = { plan_code: body.plan_code, starts_at: periodEnd };
        return void await respond(billing());
      }
      if (path === "/billing/plan-change" && req.method() === "DELETE") { state.scheduled = null; return void await respond(billing()); }
      if (path === "/billing/cancel-offer/checkout") {
        if (checkoutFails === "gone") return void await fail(409, "CONFLICT", "This offer is no longer available for your subscription.", { reason: "cancel_offer_unavailable" });
        if (checkoutFails === "provider") return void await fail(502, "BILLING_PROVIDER_ERROR", "Failed to create Stripe checkout session");
        assert.equal(new URL(body.cancel_url).pathname, "/app/cancel");
        assert.match(body.success_url, /\/app\/checkout\?plan=monthly&trial=0&next=%2Fapp&checkout=success&session_id=\{CHECKOUT_SESSION_ID\}$/);
        state.checkoutInput = body;
        return void await respond({ checkout_url: `${STRIPE_CHECKOUT}/cs_offer_1`, checkout_session_id: "cs_offer_1", currency: prices.currency, amount: cancelOffer.amount, amount_due: cancelOffer.discounted_amount });
      }
      if (path === "/billing/checkout/confirm") {
        assert.equal(body.session_id, "cs_offer_1");
        state.paid = true;
        return void await respond(billing());
      }
      if (path === "/billing/portal") return void await respond({ portal_url: `${PORTAL}/session` });
      if (path === "/master-cvs" || path === "/tailored-cvs") return void await respond([]);
      unexpected.push(`${req.method()} ${path}`);
      await fail(404, "NOT_FOUND", "Unconfigured test transport");
    } catch (error) { unexpected.push(error.message); if (!req.isInterceptResolutionHandled()) await req.abort(); }
  });
  await page.evaluateOnNewDocument(({ session, locale }) => {
    localStorage.setItem("cv-interface-locale", locale);
    localStorage.setItem("cv-builder:privacy-choices", JSON.stringify({ version: "2026-10-06.2", analytics: false, expires_at: new Date(Date.now() + 86400000).toISOString() }));
    if (!localStorage.getItem("sb-journey-fixture-auth-token")) localStorage.setItem("sb-journey-fixture-auth-token", JSON.stringify(session));
  }, { session, locale });
  return { context, page, requests, errors, unexpected, state };
}

// App pages scroll inside the shell; unclip every ancestor of the screen so the full-page capture includes it all.
const shot = async (page, name) => {
  await page.evaluate(() => {
    for (let el = document.querySelector(".checkout-screen"); el; el = el.parentElement) {
      el.style.setProperty("overflow", "visible", "important");
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("max-height", "none", "important");
    }
  });
  await page.screenshot({ path: new URL(`${name}.png`, output).pathname, fullPage: true });
};
const cancelFromProfile = async (f, label) => {
  await f.page.goto(`${base}/app/profile`, { waitUntil: "networkidle0" });
  await clickText(f.page, label);
};
const portalCalls = f => f.requests.filter(r => r.path === "/billing/portal");

try {
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const run = async (name, test) => {
    process.stdout.write(`- ${name} … `);
    await test();
    console.log("ok");
  };

  for (const [locale, mobile] of [["en", false], ["en", true], ["tr", false], ["tr", true]]) {
    await run(`offer screen ${locale} ${mobile ? "mobile" : "desktop"}`, async () => {
      const f = await fixture({ locale, mobile });
      await cancelFromProfile(f, locale === "tr" ? "Denemeyi iptal et" : "Cancel trial");
      await waitText(f.page, locale === "tr" ? "TEK SEFERLİK TEKLİF" : "ONE-TIME OFFER");
      assert.equal(new URL(f.page.url()).pathname, "/app/cancel");
      // Opening the screen never opens the portal on its own.
      assert.equal(portalCalls(f).length, 0);
      const text = await f.page.evaluate(() => document.body.innerText);
      assert.match(text, locale === "tr" ? /₺174,95/ : /₺174\.95/);
      assert.match(text, locale === "tr" ? /Hayır, teşekkürler\. Denememi iptal et/ : /No thanks, cancel my trial/);
      // No horizontal scroll on a phone.
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page scrolls sideways");
      await new Promise(resolve => setTimeout(resolve, 400));
      await shot(f.page, `offer-${locale}-${mobile ? "mobile" : "desktop"}`);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    });
  }

  for (const locale of ["en", "tr"]) {
    await run(`keep Pro pays at Stripe and lands on the Pro welcome (${locale})`, async () => {
      const f = await fixture({ locale });
      await cancelFromProfile(f, locale === "tr" ? "Denemeyi iptal et" : "Cancel trial");
      await clickText(f.page, locale === "tr" ? "%50 indirimle Pro’da kalın" : "Keep Pro at 50% off");
      await f.page.waitForFunction(origin => location.origin === origin, {}, STRIPE_CHECKOUT);
      assert.equal(portalCalls(f).length, 0);
      await clickText(f.page, "Pay");
      await waitText(f.page, locale === "tr" ? "PRO AKTİF" : "PRO IS ACTIVE");
      const text = await f.page.evaluate(() => document.body.innerText);
      assert.match(text, locale === "tr" ? /Sınırsız PDF/ : /Unlimited PDF & DOCX downloads/);
      assert.equal(f.requests.filter(r => r.path === "/billing/checkout/confirm").length, 1);
      await new Promise(resolve => setTimeout(resolve, 400));
      await shot(f.page, `welcome-${locale}-desktop`);
      assert.deepEqual(f.errors, []);
      await f.context.close();
    });
  }

  await run("backing out of Stripe returns to the offer with nothing changed", async () => {
    const f = await fixture();
    await cancelFromProfile(f, "Cancel trial");
    await clickText(f.page, "Keep Pro at 50% off");
    await f.page.waitForFunction(origin => location.origin === origin, {}, STRIPE_CHECKOUT);
    await clickText(f.page, "Back");
    await waitText(f.page, "Payment wasn’t completed. Your free trial hasn’t changed.");
    assert.equal(new URL(f.page.url()).pathname, "/app/cancel");
    assert.equal(f.requests.filter(r => r.path === "/billing/checkout/confirm").length, 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    await shot(f.page, "returned-en-desktop");
    await f.context.close();
  });

  await run("no thanks opens Stripe's cancellation step", async () => {
    const f = await fixture();
    await cancelFromProfile(f, "Cancel trial");
    await clickText(f.page, "No thanks, cancel my trial");
    await f.page.waitForFunction(origin => location.origin === origin, {}, PORTAL);
    assert.deepEqual(portalCalls(f).map(r => r.body.flow), ["cancel"]);
    assert.equal(f.requests.filter(r => r.path === "/billing/cancel-offer/checkout").length, 0);
    await f.context.close();
  });

  await run("without an offer, a trial sees what Pro includes, then cancels at Stripe", async () => {
    const f = await fixture({ offer: false });
    await cancelFromProfile(f, "Cancel trial");
    await waitText(f.page, "Are you sure? Here’s what you’d lose.");
    assert.equal(portalCalls(f).length, 0);
    await clickText(f.page, "No thanks, cancel my trial");
    await f.page.waitForFunction(origin => location.origin === origin, {}, PORTAL);
    assert.deepEqual(portalCalls(f).map(r => r.body.flow), ["cancel"]);
    await f.context.close();
  });

  for (const [plan, locale] of [["weekly", "en"], ["monthly", "en"], ["monthly", "tr"]]) {
    await run(`paid ${plan} (${locale}): the offer is applied in place, nothing charged, then the confirmation`, async () => {
      const f = await fixture({ status: "active", plan, locale });
      await cancelFromProfile(f, locale === "tr" ? "Aboneliği iptal et" : "Cancel subscription");
      await waitText(f.page, locale === "tr" ? "TEK SEFERLİK TEKLİF" : "ONE-TIME OFFER");
      const text = await f.page.evaluate(() => document.body.innerText);
      if (locale === "en") assert.match(text, plan === "weekly" ? /Get a month of Pro for half price/ : /Your next month is half price/);
      await new Promise(resolve => setTimeout(resolve, 400));
      await shot(f.page, `offer-${plan}-${locale}-desktop`);
      await clickText(f.page, locale === "tr" ? (plan === "weekly" ? "Aylık plana geçin" : "Pro’da kalın") : plan === "weekly" ? "Switch to Monthly at 50% off" : "Keep Pro at 50% off");
      await waitText(f.page, locale === "tr" ? "Her şey hazır" : "You’re all set. Pro stays on.");
      assert.equal(f.requests.filter(r => r.path === "/billing/cancel-offer/accept").length, 1);
      assert.equal(f.requests.filter(r => r.path === "/billing/cancel-offer/checkout").length, 0);
      assert.equal(portalCalls(f).length, 0);
      await new Promise(resolve => setTimeout(resolve, 300));
      await shot(f.page, `accepted-${plan}-${locale}-desktop`);
      if (plan === "weekly") {
        // Profile shows the switch waiting for the end of the paid week.
        await f.page.goto(`${base}/app/profile`, { waitUntil: "networkidle0" });
        await waitText(f.page, "Switching to Monthly on");
      }
      assert.deepEqual(f.errors, []);
      await f.context.close();
    });
  }

  await run("paid annual without an offer: what Pro includes, Keep Pro, or cancel at Stripe", async () => {
    const f = await fixture({ status: "active", plan: "annual" });
    await cancelFromProfile(f, "Cancel subscription");
    await waitText(f.page, "Are you sure? Here’s what you’d lose.");
    await waitText(f.page, "Your Yearly plan stays active until");
    await new Promise(resolve => setTimeout(resolve, 300));
    await shot(f.page, "no-offer-annual-en-desktop");
    await clickText(f.page, "Keep Pro");
    await f.page.waitForFunction(() => location.pathname === "/app" || location.pathname.startsWith("/app/resumes"));
    assert.equal(portalCalls(f).length, 0);
    await f.page.goto(`${base}/app/cancel`, { waitUntil: "networkidle0" });
    await clickText(f.page, "No thanks, cancel my plan");
    await f.page.waitForFunction(origin => location.origin === origin, {}, PORTAL);
    assert.deepEqual(portalCalls(f).map(r => r.body.flow), ["cancel"]);
    await f.context.close();
  });

  await run("pricing: an upgrade opens Stripe's confirmation for that plan", async () => {
    const f = await fixture({ status: "active", plan: "weekly" });
    await f.page.goto(`${base}/app/pricing`, { waitUntil: "networkidle0" });
    await clickText(f.page, "Choose Annual");
    await f.page.waitForFunction(origin => location.origin === origin, {}, PORTAL);
    assert.deepEqual(portalCalls(f).map(r => [r.body.flow, r.body.plan_code]), [["change_plan", "annual"]]);
    await f.context.close();
  });

  await run("pricing: a downgrade waits for the end of the paid period, and can be dropped", async () => {
    const f = await fixture({ status: "active", plan: "annual" });
    await f.page.goto(`${base}/app/pricing`, { waitUntil: "networkidle0" });
    await clickText(f.page, "Choose Monthly");
    await waitText(f.page, "Switch to Monthly when your current plan ends");
    assert.equal(new URL(f.page.url()).pathname, "/app/change-plan");
    assert.equal(portalCalls(f).length, 0);
    await new Promise(resolve => setTimeout(resolve, 300));
    await shot(f.page, "downgrade-en-desktop");
    await clickText(f.page, "Switch on");
    await waitText(f.page, "Your switch to Monthly is scheduled.");
    assert.deepEqual(f.requests.filter(r => r.path === "/billing/plan-change").map(r => [r.method, r.body.plan_code]), [["POST", "monthly"]]);
    await shot(f.page, "downgrade-scheduled-en-desktop");
    await f.page.goto(`${base}/app/profile`, { waitUntil: "networkidle0" });
    await waitText(f.page, "Switching to Monthly on");
    await clickText(f.page, "Keep Yearly");
    await f.page.waitForFunction(() => !document.body.innerText.includes("Switching to Monthly on"));
    assert.deepEqual(f.requests.filter(r => r.path === "/billing/plan-change").map(r => r.method), ["POST", "DELETE"]);
    assert.equal(portalCalls(f).length, 0);
    await f.context.close();
  });

  await run("a checkout that cannot open says nothing changed and keeps both choices", async () => {
    const f = await fixture({ checkoutFails: "provider" });
    await cancelFromProfile(f, "Cancel trial");
    await clickText(f.page, "Keep Pro at 50% off");
    await waitText(f.page, "We couldn’t open the secure checkout. Nothing has changed");
    await clickText(f.page, "Keep Pro at 50% off");
    await clickText(f.page, "No thanks, cancel my trial");
    await f.page.waitForFunction(origin => location.origin === origin, {}, PORTAL);
    await f.context.close();
  });

  await run("an offer that is gone leaves only cancelling", async () => {
    const f = await fixture({ checkoutFails: "gone" });
    await cancelFromProfile(f, "Cancel trial");
    await clickText(f.page, "Keep Pro at 50% off");
    await waitText(f.page, "This offer is no longer available.");
    assert.equal(await f.page.evaluate(() => [...document.querySelectorAll("button")].some(b => b.textContent.includes("Keep Pro"))), false);
    await f.context.close();
  });

  console.log(`Screenshots: ${output.pathname}`);
} finally {
  await browser?.close();
  await server.close();
}
