// Exercises the real UI with isolated auth, billing and document transports.
// No request reaches a real Stripe/Supabase account or production backend.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import puppeteer from "puppeteer";

process.env.VITE_API_BASE_URL = "/api/v1";
process.env.VITE_SUPABASE_URL = "https://journey-fixture.supabase.invalid";
process.env.VITE_SUPABASE_ANON_KEY = "isolated-journey-fixture-key";
const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const output = new URL("../../artifacts/subscription-journeys/", import.meta.url);
await mkdir(output, { recursive: true });
let browser;
const clickText = async (page, text) => {
  await page.waitForFunction(value => [...document.querySelectorAll("button,a")].some(el => el.textContent.trim().includes(value) && !el.disabled), {}, text);
  const element = await page.evaluateHandle(value => [...document.querySelectorAll("button,a")].find(el => el.textContent.trim().includes(value) && !el.disabled), text);
  await element.asElement().click();
};
const waitText = (page, text) => page.waitForFunction(value => document.body.innerText.includes(value), {}, text);

async function fixture({ signedIn = true, method = "email", failPayment = false, checkoutError = false, pauseCheckout = false, pricesUnavailable = false, transition = false, renewedTrialUsed = false, savedTailored = false, locale = "en", market = "GLOBAL" } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport({ width: 1280, height: 900 });
  const userId = randomUUID(), cvId = randomUUID(), importId = randomUUID(), templateId = randomUUID(), guestId = randomUUID();
  let guestAnswers = {};
  const now = new Date().toISOString();
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "candidate@example.invalid", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { full_name: "Test Candidate" }, identities: [], created_at: now };
  const jwt = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) })).toString("base64url"), "fixture-signature"].join(".");
  const session = { access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const limits = { tailored_cv_generations: null, exports: null, ai_actions: null, storage_bytes: null };
  const appUser = { id: userId, auth_user_id: userId, email: user.email, full_name: "Test Candidate", locale, default_cv_language: "en", onboarding_completed: transition, onboarding_state: transition ? { completed_at: now } : {}, onboarding_answers: {}, created_at: now, updated_at: now };
  const entitlements = { plan_code: "free", limits, remaining: limits, can_generate_tailored_cv: true, can_export_pdf: true, can_export_docx: true, can_use_ai_actions: true };
  const usage = { plan_code: "free", limits, remaining: limits, period_month: now.slice(0, 7), tailored_cv_generations_count: 0, exports_count: 0, ai_actions_count: 0, storage_bytes_used: 0 };
  let active = false, checkoutInput, selectedPlan = "weekly", trial = true, masterCreated = transition;
  const billing = () => ({ app_access: active, can_edit_existing_cvs: transition || active, subscription_required: true, trial_transition: transition ? { eligible: !active && !renewedTrialUsed } : null, plan_code: active ? selectedPlan : "free", subscription_status: active ? trial ? "trialing" : "active" : "inactive", current_period_start: now, current_period_end: new Date(Date.now() + 3 * 86400000).toISOString(), cancel_at_period_end: false, trial_eligible: !active && (!transition || !renewedTrialUsed), provider: { provider: "stripe" }, entitlement_summary: entitlements });
  const prices = { market, currency: market === "TR" ? "try" : "usd", available: true, quote: "isolated-pricing", plans: [
    { code: "weekly", amount: market === "TR" ? 14990 : 499, interval: "week", interval_count: 1, trial_days: 3 },
    { code: "monthly", amount: market === "TR" ? 34990 : 1499, interval: "month", interval_count: 1, trial_days: 0 },
    { code: "annual", amount: market === "TR" ? 149900 : 9990, interval: "year", interval_count: 1, trial_days: 0 }
  ] };
  const template = { id: templateId, name: "Mosaic Rose", slug: "mosaic-columns-rose", status: "active", module_type: "standard", preview_config: {}, export_config: {}, created_at: now, updated_at: now };
  const content = { version: "v1", language: "en", metadata: {}, sections: transition ? [{ id: "summary", type: "summary", title: "Professional Summary", order: 0, meta: {}, blocks: [{ id: "summary-block", type: "summary", order: 0, visibility: "visible", meta: {}, fields: { text: "Experienced candidate." } }] }] : [] };
  const master = { id: cvId, title: "My Main CV", language: "en", template_id: null, module_type: "standard", current_content: content, original_content: content, source_type: "import", created_at: now, updated_at: now };
  const review = { version: "cv-review-v1", status: "complete", score: 74, assessed_weight: 100, summary: "A clear starting point.", dimensions: [], strengths: [], improvements: ["Clarify your experience."], matched_keywords: [], missing_keywords: [], limitations: [] };
  const requests = [], errors = [], unexpected = [], visits = [];
  let releaseCheckout;
  let notifyCheckoutStarted;
  const checkoutStarted = new Promise(resolve => { notifyCheckoutStarted = resolve; });
  const checkoutReady = pauseCheckout ? new Promise(resolve => { releaseCheckout = resolve; }) : Promise.resolve();
  page.on("pageerror", error => errors.push(error.message));
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) visits.push(frame.url()); });
  await page.setRequestInterception(true);
  page.on("request", async req => {
    if (req.isInterceptResolutionHandled()) return;
    try {
      const url = new URL(req.url());
      const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
      const raw = data => req.respond({ status: 200, headers, body: JSON.stringify(data) });
      const respond = data => raw({ success: true, data });
      if (req.method() === "OPTIONS") return void await req.respond({ status: 204, headers });
      if (url.origin === "https://checkout.stripe.test") {
        assert(checkoutInput);
        const target = failPayment && !trial ? checkoutInput.cancel_url : checkoutInput.success_url.replace("{CHECKOUT_SESSION_ID}", "cs_test_owned");
        return void await req.respond({ status: 200, contentType: "text/html", body: `<h1>Test payment details</h1><p>Credit card</p><button onclick='location.href=${JSON.stringify(target)}'>${failPayment && !trial ? "Return after failed payment" : "Activate subscription"}</button>` });
      }
      if (url.hostname === "journey-fixture.supabase.invalid") {
        if (url.pathname.startsWith("/storage/v1/")) return void await raw({ Key: "imports/fixture.pdf" });
        if (url.pathname.endsWith("/authorize")) return void await req.respond({ status: 302, headers: { location: `${base}/auth/callback#access_token=${jwt}&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600&type=signup` } });
        if (url.pathname.endsWith("/user")) return void await raw(user);
        if (url.pathname.endsWith("/signup")) return void await raw(method === "verification" ? { user, session: null } : session);
        if (url.pathname.endsWith("/token")) return void await raw(session);
        unexpected.push(`auth ${url.pathname}`); return void await req.abort();
      }
      if (url.origin !== base) { unexpected.push(`external ${url.origin}`); return void await req.abort(); }
      if (!url.pathname.startsWith("/api/v1/")) return void await req.continue();
      const path = url.pathname.slice(7), body = req.postData() ? JSON.parse(req.postData()) : {};
      requests.push({ path, method: req.method(), body, active });
      if (path === "/privacy/config") return void await respond({ notice_version: "2026-10-06.2", controller: "Fixture", address: "Test", contact: "privacy@example.invalid", processors: [], collection_enabled: true, ai_required: true, ai_enabled: true, ai_provider: "Fixture", analytics_enabled: false });
      if (path === "/billing/prices") return void await respond(pricesUnavailable ? { ...prices, available: false, quote: null, plans: [] } : prices);
      if (path === "/guest-imports") return void await respond({ id: guestId, guest_token: "a".repeat(43), expires_at: new Date(Date.now() + 86400000).toISOString(), upload: { storage_bucket: "imports", storage_path: "fixture.pdf", token: "signed-fixture" } });
      if (path.startsWith(`/guest-imports/${guestId}`)) {
        if (path.endsWith("/claim")) return void await respond({ import_id: importId, original_filename: "candidate.pdf", answers: guestAnswers });
        if (path.endsWith("/answers")) guestAnswers = body;
        return void await respond({ answers: guestAnswers, original_filename: "candidate.pdf", ai_processing: true, analytics: false, status: "parsed", error_message: null, retry_available: false, can_resume: false });
      }
      assert(req.headers().authorization, `missing auth for ${path}`);
      if (path === "/me") return void await respond({ user: appUser, current_plan: { ...billing(), status: billing().subscription_status }, entitlements, usage_summary: usage });
      if (path === "/me/privacy") return void await respond({ analytics: false, ai_processing: !transition, privacy_revision: 0 });
      if (path === "/me/onboarding-answers") { appUser.onboarding_answers = body; return void await respond({ answers: body }); }
      if (path === "/me/settings") return void await respond({ settings: { default_cv_language: "en", locale: "en", onboarding_completed: false, onboarding_state: {} } });
      if (path === "/billing/plan") return void await respond(billing());
      if (path === "/billing/usage") return void await respond(usage);
      if (path === "/billing/entitlements") return void await respond(entitlements);
      if (path === "/billing/checkout") {
        checkoutInput = body; selectedPlan = body.plan_code; trial = selectedPlan === "weekly" && body.with_trial !== false;
        notifyCheckoutStarted();
        await checkoutReady;
        if (checkoutError && !trial) return void await req.respond({ status: 502, headers, body: JSON.stringify({ success: false, error: { code: "BILLING_PROVIDER_ERROR", message: "Unable to open payment. Please try again." } }) });
        return void await respond({ checkout_url: "https://checkout.stripe.test/session", checkout_session_id: "cs_test_owned", plan_code: selectedPlan, plan_name: selectedPlan, trial_applied: trial, trial_period_days: trial ? 3 : null, amount: prices.plans.find(item => item.code === selectedPlan).amount, currency: prices.currency });
      }
      if (path === "/billing/checkout/confirm") {
        if (body.session_id !== "cs_test_owned") return void await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Checkout session not found" } }) });
        active = true; return void await respond(billing());
      }
      if (path === "/billing/checkout/cancel") return void await respond({ cancelled: true });
      if (path === `/imports/${importId}/result`) return void await respond({ status: "parsed", parsed_content: content, review, module_type: "standard" });
      if (path === `/imports/${importId}`) return void await respond({ id: importId, target_master_cv: masterCreated ? { id: cvId } : null });
      if (path === `/imports/${importId}/create-master-cv`) { assert(active, "created CV before activation"); masterCreated = true; return void await respond({ master_cv: master }); }
      if (path === "/master-cvs" && req.method() === "POST") { assert(active, "created blank CV before activation"); master.source_type = "scratch"; masterCreated = true; return void await respond(master); }
      if ((path === `/master-cvs/${cvId}/content` || path === `/tailored-cvs/${cvId}/content`) && req.method() === "PUT") {
        assert(active || transition); master.current_content = body.current_content; master.updated_at = new Date().toISOString();
        return void await respond(savedTailored ? { ...master, master_cv_id: cvId, job: null } : master);
      }
      if (path === "/tailored-cvs") return void await respond(savedTailored ? [{ ...master, master_cv_id: cvId, job: null }] : []);
      if (savedTailored && path === `/tailored-cvs/${cvId}`) return void await respond({ ...master, master_cv_id: cvId, job: null });
      if (savedTailored && path === `/tailored-cvs/${cvId}/source`) return void await respond({ master_cv: master, job: null });
      if (path === `/master-cvs/${cvId}/template`) { assert(active || transition); master.template_id = body.template_id; return void await respond(master); }
      if (path === `/master-cvs/${cvId}`) { assert(active || transition); return void await respond(master); }
      if (path === "/master-cvs") return void await respond(masterCreated ? [master] : []);
      if (path === "/templates") return void await respond({ templates: [template] });
      if (path === `/templates/${templateId}`) return void await respond({ template });
      if (path === "/rendering/preview") return void await respond({ presentation: null, resolved_template: { resolution: "selected", template } });
      if (/ai.block.versions/.test(path)) return void await respond({ blocks: [] });
      if (path === `/master-cvs/${cvId}/exports`) return void await respond({ exports: [] });
      if (path === `/tailored-cvs/${cvId}`) return void await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Main CV" } }) });
      if (path === "/ai/import-improve") { assert(active); return void await respond({ improved_content: content, changed_block_ids: [] }); }
      unexpected.push(`${req.method()} ${path}`);
      await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Unconfigured test transport" } }) });
    } catch (error) { unexpected.push(error.message); if (!req.isInterceptResolutionHandled()) await req.abort(); }
  });
  await page.evaluateOnNewDocument(({ signedIn, session, locale }) => {
    localStorage.setItem("cv-interface-locale", locale);
    localStorage.setItem("cv-builder:privacy-choices", JSON.stringify({ version: "2026-10-06.2", analytics: false, expires_at: new Date(Date.now() + 86400000).toISOString() }));
    if (signedIn && !localStorage.getItem("sb-journey-fixture-auth-token")) localStorage.setItem("sb-journey-fixture-auth-token", JSON.stringify(session));
  }, { signedIn, session, locale });
  return { context, page, requests, errors, unexpected, visits, cvId, importId, master, templateId, checkoutStarted, activate: () => { active = true; }, releaseCheckout: () => releaseCheckout?.(), session, async close() { releaseCheckout?.(); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); await context.close(); } };
}

try {
  browser = await puppeteer.launch({ headless: true });
  {
    const f = await fixture({ pauseCheckout: true });
    try {
      await f.page.goto(`${base}/app/checkout?plan=monthly&trial=0&auto=1&next=${encodeURIComponent("/onboarding?step=upload")}`, { waitUntil: "domcontentloaded" });
      let deadline;
      await Promise.race([f.checkoutStarted, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Automatic checkout did not start")), 15000); })]).finally(() => clearTimeout(deadline));
      assert.equal(await f.page.$("h1"), null, "automatic checkout must not show a purchase interstitial");
      assert(!(await f.page.$eval("body", el => el.innerText)).includes("Checking your subscription"));
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 1);
      // A stalled provider request reveals recovery without starting another checkout.
      await waitText(f.page, "Complete your Pro purchase");
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 1);
      f.releaseCheckout();
      await waitText(f.page, "Test payment details");
      await clickText(f.page, "Activate subscription");
      await f.page.waitForSelector(".ob-create-zone");
      console.log("PASS silent automatic checkout -> delayed recovery -> one Stripe session -> saved onboarding destination");
    } catch (error) {
      console.error("Automatic handoff diagnostics", { url: f.page.url(), text: await f.page.$eval("body", el => el.innerText), requests: f.requests.map(row => row.path), errors: f.errors, unexpected: f.unexpected });
      throw error;
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ pricesUnavailable: true });
    try {
      await f.page.goto(`${base}/app/checkout?plan=monthly&trial=0&auto=1`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Pricing is temporarily unavailable");
      assert(await f.page.$("h1"), "unavailable pricing must reveal recovery");
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 0);
      console.log("PASS automatic checkout with unavailable prices reveals recovery without creating a session");
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ transition: true, renewedTrialUsed: true });
    try {
      await f.page.goto(`${base}/app/checkout?plan=weekly&trial=1&auto=1`, { waitUntil: "networkidle0" });
      await waitText(f.page, "This account is not eligible for another free trial.");
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 0);
      console.log("PASS automatic trial ineligibility never silently charges for a paid plan");
    } finally { await f.close(); }
  }
  {
    const f = await fixture();
    try {
      f.activate();
      await f.page.goto(`${base}/app/checkout?plan=monthly&trial=0&auto=1`, { waitUntil: "networkidle0" });
      await f.page.waitForSelector(".ob-create-zone");
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 0);
      console.log("PASS an already active account resumes onboarding without another purchase");
    } finally { await f.close(); }
  }
  for (const savedTailored of [false, true]) {
    const f = await fixture({ transition: true, renewedTrialUsed: true, savedTailored });
    try {
      await f.page.goto(`${base}/app/cv/${f.cvId}`, { waitUntil: "networkidle0" });
      await f.page.waitForSelector('input[placeholder="Full name"]');
      assert.equal(await f.page.$("#trial-transition-heading"), null);
      assert.equal(await f.page.$('[role="dialog"]'), null);
      await f.page.type('input[placeholder="Full name"]', "Manual Candidate");
      const saved = f.page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/content") && response.status() === 200);
      await clickText(f.page, "Save");
      await saved;
      assert(JSON.stringify(f.master.current_content).includes("Manual Candidate"));
      await f.page.reload({ waitUntil: "networkidle0" });
      await f.page.waitForFunction(() => document.querySelector('input[placeholder="Full name"]')?.value === "Manual Candidate");
      for (const label of ["Export", "Improve with AI", ...(!savedTailored ? ["Customize for a job"] : [])]) {
        await clickText(f.page, label);
        await waitText(f.page, label === "Export" ? "You need Pro to export your CV" : label === "Improve with AI" ? "You need Pro to use AI tools" : "You need Pro to tailor your CV");
        await clickText(f.page, "Not now");
        await f.page.waitForSelector('[role="dialog"]', { hidden: true });
        assert.equal(new URL(f.page.url()).pathname, `/app/cv/${f.cvId}`);
      }
      assert.equal(f.requests.filter(row => row.method === "POST" && (row.path.startsWith("/ai/") || row.path.includes("/exports/") || row.path === "/billing/checkout")).length, 0);
      assert.equal(f.requests.filter(row => row.path === "/master-cvs" && row.method === "POST").length, 0);
      if (!savedTailored) {
        await f.page.screenshot({ path: new URL("existing-user-manual-editor.png", output).pathname, fullPage: true });
        await f.page.goto(`${base}/app/resumes`, { waitUntil: "networkidle0" });
        await waitText(f.page, "My Main CV");
        await clickText(f.page, "Customize for a job");
        await waitText(f.page, "You need Pro to tailor your CV");
        await f.page.waitForFunction(path => location.pathname === path, {}, `/app/cv/${f.cvId}`);
        await clickText(f.page, "Not now");
        await f.page.waitForSelector('[role="dialog"]', { hidden: true });
        await clickText(f.page, "Customize for a job");
        await waitText(f.page, "You need Pro to tailor your CV");
        await clickText(f.page, "Start weekly plan");
        await waitText(f.page, "Test payment details");
        const checkout = f.requests.findLast(row => row.path === "/billing/checkout").body;
        assert.equal(checkout.with_trial, false);
        assert.equal(new URL(checkout.success_url).searchParams.get("next"), `/app/tailor/${f.cvId}`);
        await clickText(f.page, "Activate subscription");
        await f.page.waitForFunction(path => location.pathname === path, {}, `/app/tailor/${f.cvId}`);
      }
      console.log(`PASS existing-user ${savedTailored ? "tailored" : "main"} CV: manual save/reload without AI consent; export/AI/tailoring gated`);
    } catch (error) {
      await f.page.screenshot({ path: new URL("manual-access-failure.png", output).pathname, fullPage: true });
      console.log(await f.page.evaluate(() => document.body.innerText.slice(-3500)));
      throw error;
    } finally { await f.close(); }
  }
  for (const locale of ["en", "tr"]) {
    const f = await fixture({ signedIn: false, locale });
    try {
      await f.context.overridePermissions(base, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
      const path = locale === "tr" ? "/tr/support" : "/support";
      await f.page.goto(`${base}${path}`, { waitUntil: "networkidle0" });
      await waitText(f.page, locale === "tr" ? "Bir sonraki adımınız için biraz yardım." : "A little help for your next step.");
      const emailLink = await f.page.$('.support-email-button');
      assert.equal(new URL(await emailLink.evaluate(el => el.href)).searchParams.get("subject"), "JobSpecificCV support: General help");
      await clickText(f.page, locale === "tr" ? "E-posta adresini kopyala" : "Copy email address");
      await f.page.waitForFunction(() => document.querySelector(".support-copy-status")?.textContent);
      assert.equal(await f.page.$eval(".support-copy-status", el => el.textContent), locale === "tr" ? "E-posta adresi panoya kopyalandı." : "Email address copied to clipboard.");
      assert.equal(await f.page.evaluate(() => navigator.clipboard.readText()), "contact@jobspecificcv.com");
      await f.page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
      await clickText(f.page, locale === "tr" ? "E-posta kopyalandı" : "Email copied");
      await waitText(f.page, locale === "tr" ? "Kopyalama kullanılamıyor." : "Copy is unavailable.");
      await f.page.reload({ waitUntil: "networkidle0" });
      await f.page.click(".support-faqs summary");
      assert.equal(await f.page.$eval(".support-faqs details", el => el.open), true);
      assert(await f.page.$(`.support-answer a[href="${locale === "tr" ? "/tr/pricing" : "/pricing"}"]`));
      assert.equal(f.requests.filter(row => row.path.startsWith("/billing") || row.path.startsWith("/master-cvs")).length, 0);
      if (locale === "en") {
        await f.page.screenshot({ path: new URL("support-desktop.png", output).pathname, fullPage: true });
        await f.page.setViewport({ width: 390, height: 844 });
        assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await f.page.screenshot({ path: new URL("support-mobile.png", output).pathname, fullPage: true });
        await f.page.select("header select", "tr");
        await f.page.waitForFunction(() => location.pathname === "/tr/support");
        await waitText(f.page, "Bir sonraki adımınız için biraz yardım.");
      }
      console.log(`PASS public ${locale} support: email, clipboard/fallback, FAQ, locale and no subscription gate`);
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ signedIn: false });
    try {
      await f.page.goto(`${base}/onboarding`, { waitUntil: "networkidle0" });
      await f.page.click(".ai-upload-choice input");
      const file = new URL("invalid-upload.txt", output).pathname;
      await writeFile(file, "unsupported CV format");
      await (await f.page.$("#onboarding-cv-file")).uploadFile(file);
      await waitText(f.page, "Please choose a PDF or DOCX file.");
      const support = await f.page.$('a[href^="mailto:contact@jobspecificcv.com?"]');
      assert.equal(new URL(await support.evaluate(el => el.href)).searchParams.get("subject"), "JobSpecificCV support: CV upload");
      assert(await f.page.$('a[href="/support#contact"][target="_blank"]'));
      assert.equal(new URL(f.page.url()).pathname, "/onboarding");
      console.log("PASS upload error offers email and support guide without leaving onboarding");
    } finally { await f.close(); }
  }

  {
    const f = await fixture({ transition: true });
    try {
      await f.page.goto(`${base}/app/cv/${f.cvId}`, { waitUntil: "networkidle0" });
      await f.page.waitForSelector('input[placeholder="Full name"]');
      assert.equal(await f.page.$("#trial-transition-heading"), null);
      assert.equal(await f.page.$('[role="dialog"]'), null);
      await clickText(f.page, "Export");
      await waitText(f.page, "You need Pro to export your CV");
      await waitText(f.page, "Start your 3-day free trial or choose Pro to continue.");
      await f.page.screenshot({ path: new URL("premium-popup-desktop.png", output).pathname, fullPage: true });
      await f.page.setViewport({ width: 390, height: 1100 });
      await f.page.waitForFunction(() => document.querySelector("aside").getBoundingClientRect().right <= 1);
      await f.page.screenshot({ path: new URL("premium-popup-mobile.png", output).pathname, fullPage: true });
      assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await clickText(f.page, "Start 3-day free trial");
      await waitText(f.page, "Test payment details");
      await clickText(f.page, "Activate subscription");
      await f.page.waitForFunction(path => location.pathname === path, {}, `/app/cv/${f.cvId}`);
      await f.page.waitForSelector('input[placeholder="Full name"]');
      assert.equal(await f.page.$("#trial-transition-heading"), null);
      console.log("PASS existing-user premium popup offers renewed trial on demand and returns to the editor");
    } finally { await f.close(); }
  }
  for (const action of ["editor", "tailor", "improve"]) {
    const f = await fixture();
    try {
      await f.page.goto(`${base}/app/cv-score?source=guest&import=${f.importId}`, { waitUntil: "networkidle0" });
      await f.page.evaluate(() => localStorage.setItem("cv-builder:onboarding-template", JSON.stringify({ slug: "mosaic-columns-rose", expires_at: Date.now() + 86400000 })));
      await clickText(f.page, { editor: "Continue to CV editor", tailor: "Customize for a job", improve: "Improve with AI" }[action]);
      await waitText(f.page, "Activate your 3-day free trial");
      assert.equal(f.requests.filter(row => row.path.endsWith("create-master-cv")).length, 0);
      assert.match(new URL(f.page.url()).searchParams.get("next"), new RegExp(`action=${action}`));
      await f.page.reload({ waitUntil: "networkidle0" });
      await clickText(f.page, "Activate 3-day free trial");
      await waitText(f.page, "Test payment details");
      await clickText(f.page, "Activate subscription");
      const target = action === "editor" ? `/app/cv/${f.cvId}` : action === "tailor" ? `/app/tailor/${f.cvId}` : "/app/ai-improving";
      await f.page.waitForFunction(path => location.pathname === path, {}, target);
      if (action === "improve") await f.page.waitForFunction(path => location.pathname === path, {}, `/app/tailor/${f.cvId}`);
      assert.equal(f.master.template_id, f.templateId);
      assert(f.requests.find(row => row.path === "/billing/checkout/confirm"));
      console.log(`PASS uploaded CV: ${action}, activation, refreshed return, selected template`);
    } finally { await f.close(); }
  }
  for (const [plan, method] of [["weekly", "email"], ["monthly", "verification"], ["annual", "google"]]) {
    const f = await fixture({ signedIn: false, method });
    try {
      await f.page.goto(`${base}/pricing?billing=${plan}`, { waitUntil: "networkidle0" });
      assert.equal(await f.page.$(".gj-trial-link"), null);
      assert(!(await f.page.$eval("body", el => el.innerText)).includes("Let me help you choose"));
      await clickText(f.page, `Choose Pro ${plan}`);
      await f.page.waitForFunction(() => location.pathname === "/signup");
      if (method === "google") await clickText(f.page, "Continue with Google");
      else {
        await f.page.waitForSelector("#name");
        await f.page.type("#name", "Test Candidate"); await f.page.type("#email", "candidate@example.invalid"); await f.page.type("#password", "fixture-password");
        await clickText(f.page, "Create account");
        if (method === "verification") {
          await waitText(f.page, "Check your email");
          await f.page.goto(`${base}/auth/callback#access_token=${f.session.access_token}&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600&type=signup`, { waitUntil: "networkidle0" });
        }
      }
      await waitText(f.page, "Test payment details");
      const checkout = f.requests.find(row => row.path === "/billing/checkout");
      assert.equal(checkout.body.plan_code, plan);
      if (plan === "weekly") assert.equal(checkout.body.with_trial, false);
      assert.equal(f.requests.filter(row => /master-cvs|guest-imports|onboarding-answers/.test(row.path)).length, 0);
      await clickText(f.page, "Activate subscription");
      await f.page.waitForSelector(".ob-create-zone");
      assert.equal(new URL(f.page.url()).pathname, "/onboarding");
      console.log(`PASS direct ${plan} purchase: ${method} authentication -> payment -> upload/create`);
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ failPayment: true });
    try {
      await f.page.goto(`${base}/app/checkout?plan=monthly&trial=0&auto=1&next=${encodeURIComponent("/onboarding?step=upload")}`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Test payment details"); await clickText(f.page, "Return after failed payment");
      await waitText(f.page, "Why don’t you try the free trial first?");
      await f.page.screenshot({ path: new URL("checkout-cancel-desktop.png", output).pathname, fullPage: true });
      await f.page.setViewport({ width: 390, height: 844 });
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await f.page.$eval(".checkout-cancelled-mascot", el => getComputedStyle(el).transform), "matrix(-1, 0, 0, 1, 0, 0)");
      await f.page.screenshot({ path: new URL("checkout-cancel-mobile.png", output).pathname, fullPage: true });
      assert(await f.page.$('a[href="/support#contact"][target="_blank"]'));
      assert(await f.page.$('a[href^="mailto:contact@jobspecificcv.com?"]'));
      await clickText(f.page, "Start my 3-day free trial");
      await clickText(f.page, "Activate 3-day free trial"); await waitText(f.page, "Test payment details"); await clickText(f.page, "Activate subscription");
      await f.page.waitForSelector(".ob-create-zone");
      assert.equal(f.requests.filter(row => row.path === "/billing/checkout").length, 2);
      console.log("PASS failed purchase -> trial activation -> upload/create");
    } finally { await f.close(); }
  }
  {
    const f = await fixture();
    try {
      await f.page.goto(`${base}/`, { waitUntil: "networkidle0" });
      await f.page.click('.ts-lookbook-picker button:nth-child(3)');
      await f.page.click('.ts-lookbook-cta a');
      await f.page.waitForSelector(".ob-create-zone");
      assert.equal(await f.page.evaluate(() => JSON.parse(localStorage.getItem("cv-builder:onboarding-template")).slug), "mosaic-columns-rose");
      await f.page.click(".ob-create-zone");
      for (let question = 1; question <= 4; question++) { await waitText(f.page, `Question ${question} of 4`); await clickText(f.page, "Skip"); }
      await clickText(f.page, "See my CV score");
      await waitText(f.page, "Not scored yet.");
      assert.equal(f.requests.filter(row => row.path === "/master-cvs" && row.method === "POST").length, 0);
      await clickText(f.page, "Continue to CV editor"); await clickText(f.page, "Activate 3-day free trial"); await waitText(f.page, "Test payment details"); await clickText(f.page, "Activate subscription");
      await f.page.waitForFunction(path => location.pathname === path, {}, `/app/cv/${f.cvId}`);
      assert.equal(f.master.template_id, f.templateId);
      assert.equal(f.requests.filter(row => row.path === "/master-cvs" && row.method === "POST").length, 1);
      await f.page.setViewport({ width: 390, height: 844 });
      await f.page.screenshot({ path: new URL("scratch-editor-mobile.png", output).pathname, fullPage: true });
      console.log("PASS Make It Yours -> create -> four questions -> honest score -> trial -> selected template");
    } finally { await f.close(); }
  }
  {
    const f = await fixture();
    try {
      await f.page.goto(`${base}/onboarding?template=mosaic-columns-rose`, { waitUntil: "networkidle0" });
      await f.page.click(".ai-upload-choice input");
      const file = new URL("candidate.pdf", output).pathname;
      await writeFile(file, "%PDF-1.4 synthetic upload transport fixture");
      await (await f.page.$("#onboarding-cv-file")).uploadFile(file);
      for (let question = 1; question <= 4; question++) { await waitText(f.page, `Question ${question} of 4`); await clickText(f.page, "Skip"); }
      await clickText(f.page, "See my CV score"); await waitText(f.page, "Your CV Score");
      assert(f.requests.find(row => row.path.endsWith("/claim")));
      await clickText(f.page, "Customize for a job"); await clickText(f.page, "Activate 3-day free trial"); await waitText(f.page, "Test payment details"); await clickText(f.page, "Activate subscription");
      await f.page.waitForFunction(path => location.pathname === path, {}, `/app/tailor/${f.cvId}`);
      assert.equal(f.master.template_id, f.templateId);
      console.log("PASS upload -> four questions -> claim/score -> trial -> selected tailoring path");
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ transition: true, renewedTrialUsed: true, locale: "tr", market: "TR" });
    try {
      await f.page.setViewport({ width: 320, height: 1100 });
      await f.page.goto(`${base}/app/checkout?plan=annual&trial=0&checkout=cancel`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Kaldığınız yerden devam edelim.");
      assert.equal(await f.page.$('a.checkout-cancelled-primary[href*="trial=1"]'), null);
      assert((await f.page.$eval(".checkout-cancelled-offer", el => el.innerText)).includes("1.499,00"));
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await f.page.screenshot({ path: new URL("checkout-cancel-tr-ineligible.png", output).pathname, fullPage: true });
      await clickText(f.page, "Yıllık plan ödemesini tekrar dene");
      await waitText(f.page, "Test payment details");
      assert.equal(f.requests.find(row => row.path === "/billing/checkout").body.plan_code, "annual");
      console.log("PASS Turkish cancellation without trial eligibility shows live annual price and retries annual purchase");
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ market: "TR" });
    try {
      await f.page.goto(`${base}/app/checkout?plan=weekly&trial=1&checkout=cancel`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Why don’t you try the free trial first?");
      assert((await f.page.$eval(".checkout-cancelled-terms", el => el.innerText)).includes("149.90"));
      await clickText(f.page, "Start my 3-day free trial");
      await waitText(f.page, "Test payment details");
      const checkout = f.requests.find(row => row.path === "/billing/checkout").body;
      assert.equal(checkout.plan_code, "weekly");
      assert.notEqual(checkout.with_trial, false);
      console.log("PASS canceled trial resumes trial activation with the regional weekly renewal price");
    } finally { await f.close(); }
  }
  {
    const f = await fixture({ checkoutError: true });
    try {
      await f.page.goto(`${base}/app/checkout?plan=monthly&trial=0&auto=1`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Having trouble purchasing?"); await clickText(f.page, "Start Free Trial");
      await clickText(f.page, "Activate 3-day free trial"); await waitText(f.page, "Test payment details"); await clickText(f.page, "Activate subscription");
      await f.page.waitForSelector(".ob-create-zone");
      console.log("PASS checkout API error -> trial activation -> upload/create");
    } finally { await f.close(); }
  }
  {
    const f = await fixture();
    try {
      await f.page.goto(`${base}/app/cv/${f.cvId}`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Activate your 3-day free trial");
      assert.equal(f.requests.filter(row => row.path.startsWith("/master-cvs")).length, 0);
      await f.page.goto(`${base}/app/checkout?checkout=success&session_id=cs_forged&next=${encodeURIComponent(`/app/cv/${f.cvId}`)}`, { waitUntil: "networkidle0" });
      await waitText(f.page, "Checkout session not found");
      assert.equal(f.requests.filter(row => row.path.startsWith("/master-cvs")).length, 0);
      console.log("PASS unpaid deep link and forged success return cannot open the app");
    } finally { await f.close(); }
  }
  console.log("All subscription journeys passed using isolated transports.");
} finally { await browser?.close(); await server.close(); }
