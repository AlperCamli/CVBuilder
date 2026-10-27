import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const base = process.env.CAROUSEL_URL ?? "http://127.0.0.1:5173";
const artifacts = await mkdtemp(join(tmpdir(), "cv-company-carousel-"));
const browser = await puppeteer.launch({ headless: true });
const errors = [];
const checks = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const page = await browser.newPage();
  let responseMarket = "GLOBAL";
  let pricingRequests = 0;
  let pricingFailure = false;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!new URL(request.url()).pathname.endsWith("/billing/prices")) return request.continue();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "*",
    };
    if (request.method() === "OPTIONS") return request.respond({ status: 204, headers });
    pricingRequests++;
    return request.respond({
      status: pricingFailure ? 503 : 200,
      contentType: "application/json",
      headers,
      body: JSON.stringify(pricingFailure ? { success: false } : { success: true, data: {
        market: responseMarket, currency: responseMarket === "TR" ? "try" : "usd",
        available: true, quote: "carousel-browser-fixture",
        plans: [
          { code: "weekly", amount: 499, interval: "week", interval_count: 1, trial_days: 3 },
          { code: "monthly", amount: 1499, interval: "month", interval_count: 1, trial_days: 0 },
          { code: "annual", amount: 9990, interval: "year", interval_count: 1, trial_days: 0 },
        ],
      } }),
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cv-interface-locale", location.pathname.startsWith("/tr") ? "tr" : "en");
    localStorage.setItem("cv-builder:privacy-choices", JSON.stringify({
      version: "2026-10-06.2", analytics: false, pending_sync: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }));
  });
  const visit = async (path, width, language = "en") => {
    pricingRequests = 0;
    await page.setViewport({ width, height: 1000 });
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/billing/prices")),
      page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" }),
    ]);
    await page.waitForSelector("#companies");
    await page.evaluate(() => document.getElementById("companies").scrollIntoView({ block: "center" }));
    await page.waitForFunction(() => document.querySelector(".gj-rail")?.dataset.context === "companies");
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".gj-company-group:first-child img")).every((image) => image.complete && image.naturalWidth > 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.$eval("#companies h2", (el) => el.textContent), language === "tr" ? "Önde gelen şirketlerin çalışanları jobspecificCV kullanıyor:" : "People at leading companies use jobspecificCV:");
    const expected = responseMarket === "TR" && !pricingFailure ? "Amazon,Accenture,Coca-Cola,Jotform,Trendyol,QNB,Akbank" : "Amazon,Accenture,Coca-Cola,Jotform";
    await page.waitForFunction((expected) => Array.from(document.querySelectorAll(".gj-company-group:first-child img")).map((image) => image.alt).join(",") === expected, {}, expected);
    assert.equal(pricingRequests, 1, "Carousel and pricing must share one pricing request");
    assert.equal(await page.$eval(".gj-company-group:last-child", (el) => el.getAttribute("aria-hidden")), "true");
    assert.match(await page.$eval(".gj-rail-character", (el) => el.className), /gj-pose-celebrate/);
  };
  await visit("/", 1440);
  await page.mouse.move(0, 0);
  const transform = () => page.$eval(".gj-company-track", (el) => getComputedStyle(el).transform);
  const before = await transform(); await delay(250); assert.notEqual(await transform(), before);
  await page.hover(".gj-company-window");
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationPlayState), "paused");
  const held = await transform(); await delay(250); assert.equal(await transform(), held);
  await page.mouse.move(0, 0);
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationPlayState), "running");
  const resumed = await transform(); await delay(250); assert.notEqual(await transform(), resumed);
  assert.equal(await page.$("#companies button"), null);
  // Mouse focus should not hold the animation after the pointer leaves.
  await page.click(".gj-company-window"); await page.mouse.move(0, 0);
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationPlayState), "running");
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Tab");
  await page.focus(".gj-company-carousel");
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationPlayState), "paused");
  await page.keyboard.press("Tab");
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationPlayState), "running");
  await page.screenshot({ path: join(artifacts, "desktop.png") });
  checks.push("Desktop logos, hover pause and automatic resume, keyboard focus pause, no pause button, celebrating guide");

  await page.evaluate(() => document.getElementById("demo").scrollIntoView());
  await page.waitForFunction(() => document.querySelector(".gj-rail")?.dataset.context === "demo");
  await page.evaluate(() => document.getElementById("companies").scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => document.querySelector(".gj-rail")?.dataset.context === "companies");
  checks.push("Mascot returns to carousel when scrolling back from demo");

  await visit("/tr", 1440, "tr");
  responseMarket = "TR";
  await visit("/", 1440);
  checks.push("International Turkish page excludes Trendyol, QNB and Akbank; English page in Turkey includes them; one shared pricing request");

  for (const width of [768, 390, 320]) {
    await visit("/tr", width, "tr");
    await page.click(".gj-rail-character");
    assert.equal(await page.$eval(".gj-rail-character", (el) => el.getAttribute("aria-expanded")), "true");
    // A greeting temporarily supersedes the carousel message.
    await delay(2800);
    assert.match(await page.$eval(".gj-rail-bubble p", (el) => el.textContent), /Hedeflerin büyük mü/);
    await page.screenshot({ path: join(artifacts, `turkish-${width}.png`) });
  }
  checks.push("Turkish text and compact guidance at 768px, 390px and 320px, no horizontal overflow");

  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await visit("/tr", 320, "tr");
  assert.equal(await page.$eval(".gj-company-track", (el) => getComputedStyle(el).animationName), "none");
  assert.equal(await page.$eval(".gj-company-group:last-child", (el) => getComputedStyle(el).display), "none");
  assert.equal(await page.$("#companies button"), null);
  assert.equal(await page.$$eval(".gj-company-group:first-child li", (els) => els.every((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })), true);
  await page.screenshot({ path: join(artifacts, "reduced-motion.png") });
  checks.push("Reduced motion: all seven Turkey companies visible in static wrapped layout");

  pricingFailure = true;
  await visit("/tr", 390, "tr");
  checks.push("Pricing failure falls back to international logos independently of Turkish interface language");
  pricingFailure = false;

  await page.goto(`${base}/pricing`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#plans");
  assert.equal(await page.$("#companies"), null);
  checks.push("Pricing omits company carousel");
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, "results.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, artifacts }, null, 2));
} finally { await browser.close(); }
