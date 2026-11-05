// Opt-in verification against Stripe test mode. Never creates live objects.
// Run from backend: npx tsx scripts/verify-regional-trial-sandbox.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parse } from "dotenv";
import Stripe from "stripe";
import { StripeBillingGateway, trialEndLabel, trialSubmitMessage } from "../src/modules/billing/stripe-gateway";
import { createPlanCatalog, trialPlanCodes } from "../src/modules/entitlements/plan-definitions";

// The live price each market charges for a plan (read only), and its Stripe interval.
const PLAN_PRICES = {
  weekly: { TR: "STRIPE_TRY_WEEKLY_PRICE_ID", GLOBAL: "STRIPE_WEEKLY_PRICE_ID", interval: "week" },
  monthly: { TR: "STRIPE_TRY_MONTHLY_PRICE_ID", GLOBAL: "STRIPE_MONTHLY_PRICE_ID", interval: "month" },
  annual: { TR: "STRIPE_TRY_ANNUAL_PRICE_ID", GLOBAL: "STRIPE_ANNUAL_PRICE_ID", interval: "year" }
} as const;
type TrialPlan = keyof typeof PLAN_PRICES;

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Run from backend: npx tsx scripts/verify-regional-trial-sandbox.ts");
    console.log("Uses STRIPE_TEST_SECRET_KEY or the Stripe CLI default profile. Copies the current prices of the trial plan (the plan catalog's trial_supported plan, Monthly since 2026-11-05) from .env.local into test mode, completes hosted test-card checkouts with the trial, advances a test clock past the trial end to check the first charge, then removes test customers/subscriptions and archives temporary prices/products.");
    return;
  }
  const trialPlans = trialPlanCodes(createPlanCatalog());
  assert.equal(trialPlans.length, 1, "Exactly one plan carries the trial");
  const trialPlan = trialPlans[0] as TrialPlan;
  assert(trialPlan in PLAN_PRICES, `Unexpected trial plan ${trialPlan}`);
  const { interval } = PLAN_PRICES[trialPlan];
  let testKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!testKey) {
    const profiles = JSON.parse(execFileSync("python3", ["-c", "import json,tomllib;from pathlib import Path;print(json.dumps(tomllib.loads((Path.home()/'.config/stripe/config.toml').read_text())))"], { encoding: "utf8" }));
    testKey = Object.values(profiles.default ?? {}).find(value => typeof value === "string" && /^(sk|rk)_test_/.test(value)) as string | undefined;
  }
  assert(testKey, "A test-mode Stripe key is required");
  assert.match(testKey, /^(sk|rk)_test_/, "A test-mode Stripe key is required");
  const env = { ...parse(await readFile(resolve(__dirname, "../.env.local"))), ...process.env };
  const stripe = new Stripe(testKey, { apiVersion: "2024-06-20", maxNetworkRetries: 0, timeout: 20000 });
  // Read the real catalog without modifying it; all writes use the test client.
  const catalog = new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20", maxNetworkRetries: 0, timeout: 20000 });
  const gateway = new StripeBillingGateway(testKey);
  const run = `cv-trial-check-${Date.now()}`;
  const directory = await mkdtemp(join(tmpdir(), "cv-stripe-trial-"));
  const report: Array<Record<string, unknown>> = [];
  const cleanup: Array<() => Promise<unknown>> = [];
  const frontendRequire = createRequire(resolve(__dirname, "../../frontend/package.json"));
  const browser = await frontendRequire("puppeteer").launch({ headless: true });
  console.log(JSON.stringify({ sandbox_access: true, artifacts: directory }));
  try {
    for (const market of ["TR", "GLOBAL"] as const) {
      const source = await catalog.prices.retrieve(env[PLAN_PRICES[trialPlan][market]]!);
      assert.equal(source.active, true);
      // The source amounts are production's only when the catalog key is live; a test-mode key is tolerated.
      if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "")) assert.equal(source.livemode, true, "The source price is the live catalog's");
      else console.log(JSON.stringify({ warning: "STRIPE_SECRET_KEY is not a live key: source prices come from test mode and may differ from production", market }));
      assert.equal(source.recurring?.interval, interval);
      assert.equal(source.recurring?.interval_count, 1);
      const product = await stripe.products.create({ name: `${trialPlan} Pro sandbox verification ${market}`, metadata: { verification_run: run } });
      cleanup.unshift(() => stripe.products.update(product.id, { active: false }));
      const price = await stripe.prices.create({ product: product.id, unit_amount: source.unit_amount!, currency: source.currency, recurring: { interval }, metadata: { verification_run: run } });
      cleanup.unshift(() => stripe.prices.update(price.id, { active: false }));
      const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `${run}-${market}` });
      cleanup.unshift(() => stripe.testHelpers.testClocks.del(clock.id));
      const customer = await stripe.customers.create({ name: "Sandbox Trial Verification", email: "stripe-trial-verification@example.invalid", test_clock: clock.id, metadata: { verification_run: run } });
      // The same Checkout parameters BillingService sends for a trial (card required, trial days, submit message).
      const submitMessage = trialSubmitMessage("en", trialEndLabel("en", 3, "UTC", market));
      const checkout = await gateway.createCheckoutSession({ customer_id: customer.id, price_id: price.id, currency: source.currency, locale: "en", success_url: "http://127.0.0.1:1/trial-success?session_id={CHECKOUT_SESSION_ID}", cancel_url: "http://127.0.0.1:1/trial-cancel", client_reference_id: run, mode: "subscription", trial_period_days: 3, submit_message: submitMessage, metadata: { verification_run: run, plan_code: trialPlan, billing_market: market, billing_currency: source.currency } });
      cleanup.unshift(async () => {
        const current = await stripe.checkout.sessions.retrieve(checkout.id);
        if (current.status === "open") await stripe.checkout.sessions.expire(checkout.id);
      });
      assert(checkout.url);
      const session = await stripe.checkout.sessions.retrieve(checkout.id);
      assert.equal(session.livemode, false);
      assert.equal(session.amount_total, 0);
      console.log(JSON.stringify({ market, plan: trialPlan, currency: source.currency, plan_amount: source.unit_amount, checkout_id: session.id, due_today: session.amount_total }));
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1100 });
      // Keep Checkout's success redirect local to the test browser.
      await page.setRequestInterception(true);
      page.on("request", async (request: any) => {
        if (request.url().startsWith("http://127.0.0.1:1/")) await request.respond({ status: 200, contentType: "text/html", body: "<h1>Sandbox trial completed</h1>" });
        else await request.continue();
      });
      try {
        await page.goto(checkout.url, { waitUntil: "networkidle2", timeout: 45000 });
        await page.screenshot({ path: join(directory, `${market}-checkout.png`), fullPage: true });
        console.log(JSON.stringify({ market, checkout_text: (await page.evaluate(() => document.body.innerText)).split("\n").slice(0, 7).join("\n") }));
        await page.waitForSelector('input[name="cardNumber"]', { timeout: 20000 });
        await page.type('input[name="cardNumber"]', "4242424242424242");
        await page.type('input[name="cardExpiry"]', "1230");
        await page.type('input[name="cardCvc"]', "123");
        const name = await page.$('input[name="billingName"]');
        if (name) await name.type("Sandbox Trial Verification");
        const country = await page.$('select[name="billingCountry"]');
        if (country) await country.select("CA");
        const postal = await page.$('input[name="billingPostalCode"]');
        if (postal) await postal.type("M5V 2T6");
        await page.screenshot({ path: join(directory, `${market}-ready.png`), fullPage: true });
        await page.click('button[type="submit"]');
        let completed: Stripe.Checkout.Session = session;
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          completed = await stripe.checkout.sessions.retrieve(checkout.id, { expand: ["subscription.latest_invoice"] });
          if (completed.status === "complete") break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        await page.screenshot({ path: join(directory, `${market}-result.png`), fullPage: true }).catch(() => {});
        assert.equal(completed.status, "complete", "Hosted Stripe checkout did not complete");
        const subscription = completed.subscription as Stripe.Subscription;
        assert.equal(subscription.status, "trialing");
        assert.equal(subscription.trial_end! - subscription.trial_start!, 3 * 86400);
        assert.equal(subscription.items.data[0].price.currency, source.currency);
        assert.equal(subscription.items.data[0].price.unit_amount, source.unit_amount);
        assert.equal(subscription.items.data[0].price.recurring?.interval, interval);
        assert.equal(subscription.metadata.plan_code, trialPlan);
        const invoice = subscription.latest_invoice as Stripe.Invoice;
        assert.equal(invoice.amount_due, 0);
        assert.equal(invoice.amount_paid, 0);
        assert.equal(invoice.currency, source.currency);
        // Move the customer's test clock past the trial end (and Stripe's ~1h invoice finalization): the first charge
        // is the trial plan's full price, and the subscription is active on that plan's interval.
        await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: subscription.trial_end! + 2 * 3600 });
        const advanceDeadline = Date.now() + 180000;
        while ((await stripe.testHelpers.testClocks.retrieve(clock.id)).status !== "ready") {
          assert(Date.now() < advanceDeadline, "Test clock did not finish advancing");
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        const converted = await stripe.subscriptions.retrieve(subscription.id, { expand: ["latest_invoice"] });
        const firstCharge = converted.latest_invoice as Stripe.Invoice;
        assert.equal(converted.status, "active");
        assert.equal(firstCharge.billing_reason, "subscription_cycle");
        assert.equal(firstCharge.status, "paid");
        assert.equal(firstCharge.amount_paid, source.unit_amount);
        assert.equal(firstCharge.currency, source.currency);
        assert.equal(converted.items.data[0].price.recurring?.interval, interval);
        const result = { market, plan: trialPlan, currency: source.currency, plan_amount: source.unit_amount, checkout_id: checkout.id, subscription_id: subscription.id, status: subscription.status, trial_days: (subscription.trial_end! - subscription.trial_start!) / 86400, invoice_amount_due: invoice.amount_due, invoice_amount_paid: invoice.amount_paid, after_trial: { status: converted.status, billing_reason: firstCharge.billing_reason, amount_paid: firstCharge.amount_paid, interval: converted.items.data[0].price.recurring?.interval }, livemode: subscription.livemode };
        report.push(result);
        console.log(JSON.stringify({ result }));
        await stripe.subscriptions.cancel(subscription.id);
      } finally { await page.close(); }
    }
  } finally {
    await browser.close();
    let cleanupFailures = 0;
    for (const remove of cleanup) {
      try { await remove(); }
      catch (error) { cleanupFailures++; console.log(JSON.stringify({ cleanup_error: (error as { type?: string }).type ?? "unknown" })); }
    }
    await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ completed_scenarios: report.length, artifacts: directory, cleanup_finished: cleanupFailures === 0 }));
    if (cleanupFailures) process.exitCode = 1;
  }
}

main().catch(error => {
  const safeMessage = String(error.message ?? error).replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g, "[redacted]");
  console.error(JSON.stringify({ error: error.type ?? error.name, message: safeMessage }));
  process.exitCode = 1;
});
