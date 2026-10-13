// Isolated browser checks. Billing, authentication and privacy requests use fixtures.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const base = process.env.LANGUAGE_STUDIO_URL ?? "http://127.0.0.1:5173";
const artifacts = await mkdtemp(join(tmpdir(), "cv-language-studio-"));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const client = await page.createCDPSession();
await client.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: artifacts,
});
await page.setViewport({ width: 1600, height: 1100 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("cv-interface-locale", "en");
  localStorage.setItem(
    "cv-builder:privacy-choices",
    JSON.stringify({
      version: "2026-10-06.2",
      analytics: false,
      pending_sync: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  );
});
await page.setRequestInterception(true);
page.on("request", (request) => {
  const url = new URL(request.url());
  if (
    url.pathname.startsWith("/api/v1") ||
    url.hostname.endsWith("supabase.co")
  ) {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
      "access-control-allow-headers": "*",
    };
    if (request.method() === "OPTIONS")
      return request.respond({ status: 204, headers });
    let data = null;
    if (url.pathname.endsWith("/billing/prices"))
      data = {
        market: "TR",
        currency: "try",
        available: true,
        quote: "isolated-preview",
        plans: [
          {
            code: "weekly",
            amount: 9900,
            interval: "week",
            interval_count: 1,
            trial_days: 3,
          },
          {
            code: "monthly",
            amount: 24900,
            interval: "month",
            interval_count: 1,
            trial_days: 0,
          },
          {
            code: "annual",
            amount: 149900,
            interval: "year",
            interval_count: 1,
            trial_days: 0,
          },
        ],
      };
    if (url.pathname.endsWith("/privacy/config"))
      data = {
        notice_version: "2026-10-06.2",
        controller: "Test operator",
        address: "Test only",
        contact: "test@example.invalid",
        analytics_enabled: false,
        collection_enabled: true,
        ai_enabled: true,
        ai_required: true,
        ai_provider: "Fixture",
        processors: [],
      };
    return request.respond({
      status: data ? 200 : 401,
      headers,
      contentType: "application/json",
      body: JSON.stringify(
        data
          ? { success: true, data }
          : {
              success: false,
              error: { code: "UNAUTHORIZED", message: "Isolated browser test" },
            },
      ),
    });
  }
  request.continue();
});
const click = async (text) => {
  await page.waitForFunction(
    (text) =>
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent.trim() === text && !button.disabled,
      ),
    {},
    text,
  );
  await page.evaluate(
    (text) =>
      Array.from(document.querySelectorAll("button"))
        .find(
          (button) => button.textContent.trim() === text && !button.disabled,
        )
        .click(),
    text,
  );
};
const value = async (target, selector, text) =>
  target.$eval(
    selector,
    (element, text) => {
      const prototype =
        element.tagName === "TEXTAREA"
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(
        element,
        text,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    text,
  );
const ready = () =>
  page.waitForFunction(() => !document.querySelector(".ls-loading"), {
    timeout: 20000,
  });
const preview = () =>
  page.frames().find((frame) => frame.url().includes("languagePreview=1"));
const clickPreviewText = async (selector) => {
  const point = await preview().$eval(selector, element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const frame = await page.$eval("iframe", element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, scale: rect.width / Number(element.width) };
  });
  await page.mouse.click(frame.x + point.x * frame.scale, frame.y + point.y * frame.scale);
};
const chooseText = async (text) => {
  await value(page, ".ls-search input", text);
  await page.select(".ls-filters label:nth-child(2) select", "all");
  await page.waitForFunction(
    (text) =>
      Array.from(document.querySelectorAll(".ls-text-list strong")).some(
        (element) => element.textContent === text,
      ),
    {},
    text,
  );
  await page.evaluate(
    (text) =>
      Array.from(document.querySelectorAll(".ls-text-list strong"))
        .find((element) => element.textContent === text)
        .closest("button")
        .click(),
    text,
  );
  await page.waitForFunction(
    (text) => document.querySelector("#ls-source").value === text,
    {},
    text,
  );
};
const readDownload = async (name) => {
  const filename = join(artifacts, name);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(filename);
      return JSON.parse(await readFile(filename, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Download did not finish: ${name}`);
};
try {
  await page.goto(`${base}/designs/guided-journey/languages`, {
    waitUntil: "networkidle2",
  });
  await ready();
  assert.equal(
    await page.$eval("h1", (element) => element.textContent),
    "Language Studio",
  );
  assert.equal(await page.$("dialog[open]"), null);
  await preview().waitForFunction(() =>
    document.querySelector("h1").textContent.includes("Özgeçmişinizi"),
  );
  const custom = "Hayalindeki işe ilk adım — ıİğĞşŞöÖüÜçÇ";
  await value(page, "#ls-translation", custom);
  await preview().waitForFunction(
    (text) => document.querySelector("h1").textContent.includes(text),
    {},
    custom,
  );
  // Correct source with a wrong session must not override the preview.
  await page.evaluate(() => {
    const frame = document.querySelector("iframe");
    frame.contentWindow.postMessage(
      {
        type: "language:configure",
        session: "wrong-session",
        configuration: {
          version: 1,
          code: "tr",
          name: "Türkçe",
          direction: "ltr",
          translations: { "Tailor your CV to any": "FORGED" },
          reviewed: [],
        },
      },
      location.origin,
    );
  });
  await preview().evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert(
    (await preview().$eval("h1", (element) => element.textContent)).includes(
      custom,
    ),
  );
  await page.click(".ls-reviewed input");
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("cv-language-studio-v1"))
      .languages.find((language) => language.code === "tr")
      .reviewed.includes("Tailor your CV to any"),
  );
  await click("Export catalog");
  const catalog = await readDownload("tr.json");
  assert.equal(catalog["Tailor your CV to any"], custom);
  assert.equal(catalog.Save, "Kaydet");
  await page.screenshot({ path: join(artifacts, "desktop.png") });
  await page.reload({ waitUntil: "networkidle2" });
  await ready();
  await preview().waitForFunction(
    (text) => document.querySelector("h1").textContent.includes(text),
    {},
    custom,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cv-interface-locale")),
    "en",
  );
  await clickPreviewText("h1");
  await page.waitForFunction(
    () => document.querySelector("#ls-source").value.length > 0,
  );
  await page.click('[aria-label="Add a language"]');
  await value(
    page,
    '.ls-add-language input[placeholder="de, fr, ar, pt-BR"]',
    "de",
  );
  await value(page, '.ls-add-language input[placeholder="Deutsch"]', "Deutsch");
  await click("Create language draft");
  await ready();
  await chooseText("Tailor your CV to any");
  await value(page, "#ls-translation", "Dein nächster Karriereschritt");
  await preview().waitForFunction(() =>
    document
      .querySelector("h1")
      .textContent.includes("Dein nächster Karriereschritt"),
  );
  assert.equal(
    await preview().evaluate(() => document.documentElement.lang),
    "de",
  );
  await click("Export workspace");
  const workspace = await readDownload("language-workspace.json");
  assert.equal(
    workspace.languages.find((language) => language.code === "de").translations[
      "Tailor your CV to any"
    ],
    "Dein nächster Karriereschritt",
  );
  assert(
    workspace.languages
      .find((language) => language.code === "tr")
      .reviewed.includes("Tailor your CV to any"),
  );
  const invalid = join(artifacts, "unsafe.json");
  await writeFile(invalid, '{"__proto__":"unsafe"}');
  await (await page.$('input[type="file"]')).uploadFile(invalid);
  await page.waitForFunction(() =>
    document
      .querySelector(".ls-notice.is-error")
      ?.textContent.includes("unsafe keys"),
  );
  assert.equal(
    await page.$eval("#ls-translation", (element) => element.value),
    "Dein nächster Karriereschritt",
  );
  await page.click('[aria-label="Dismiss message"]');
  await page.click('[aria-label="Add a language"]');
  await value(
    page,
    '.ls-add-language input[placeholder="de, fr, ar, pt-BR"]',
    "ar",
  );
  await value(page, '.ls-add-language input[placeholder="Deutsch"]', "العربية");
  await page.select(".ls-add-language select", "rtl");
  await click("Create language draft");
  await ready();
  await chooseText("Tailor your CV to any");
  await value(page, "#ls-translation", "خطوتك المهنية التالية");
  await preview().waitForFunction(() =>
    document.querySelector("h1").textContent.includes("خطوتك المهنية التالية"),
  );
  assert.equal(
    await preview().evaluate(() => document.documentElement.dir),
    "rtl",
  );
  await page.click('[aria-label="Undo language change"]');
  await preview().waitForFunction(
    () =>
      !document
        .querySelector("h1")
        .textContent.includes("خطوتك المهنية التالية"),
  );
  await page.click('[aria-label="Redo language change"]');
  await preview().waitForFunction(() =>
    document.querySelector("h1").textContent.includes("خطوتك المهنية التالية"),
  );
  await (
    await page.$('input[type="file"]')
  ).uploadFile(join(artifacts, "language-workspace.json"));
  await page.waitForFunction(
    () =>
      document.querySelector("#ls-language").value === "de" &&
      document.querySelectorAll("#ls-language option").length === 3,
  );
  await preview().waitForFunction(() => document.documentElement.lang === "de");
  await page.select("#ls-language", "tr");
  await ready();
  await page.select(".ls-preview-toolbar select", "signin");
  await ready();
  await preview().waitForSelector('input[type="email"]');
  await value(preview(), 'input[type="email"]', "test@example.invalid");
  await chooseText("Email address");
  await value(page, "#ls-translation", "E-posta adresiniz");
  await preview().waitForFunction(() =>
    document.body.textContent.includes("E-posta adresiniz"),
  );
  assert.equal(
    await preview().$eval('input[type="email"]', (element) => element.value),
    "test@example.invalid",
  );
  await page.select("#ls-language", "en");
  await preview().waitForFunction(() => document.documentElement.lang === "en");
  assert.equal(
    await preview().$eval('input[type="email"]', (element) => element.value),
    "test@example.invalid",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cv-interface-locale")),
    "en",
  );
  await page.select("#ls-language", "tr");
  await ready();
  await page.select(".ls-preview-toolbar select", "language-chooser");
  await ready();
  await preview().waitForSelector("dialog[open]");
  await clickPreviewText('dialog[open] p[lang="tr"]');
  await page.waitForFunction(() => document.querySelector("#ls-source").value === "Choose your language");
  await value(page, "#ls-translation", "Dilinizi birlikte seçelim");
  await preview().waitForFunction(() => document.querySelector('dialog[open] p[lang="tr"]')?.textContent.includes("Dilinizi birlikte seçelim"));
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({
    path: join(artifacts, "mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    `Language Studio browser checks passed. Screenshots and exported JSON: ${artifacts}`,
  );
} catch (error) {
  await page.screenshot({
    path: join(artifacts, "failure.png"),
    fullPage: true,
  });
  console.error(
    `Browser failure artifacts: ${artifacts}. Page errors: ${JSON.stringify(errors)}`,
  );
  throw error;
} finally {
  await browser.close();
}
