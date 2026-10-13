// Uses isolated Language Studio data; no account, live AI or database mutations.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const base = process.env.LANGUAGE_STUDIO_URL ?? "http://127.0.0.1:5173";
const artifacts = await mkdtemp(join(tmpdir(), "cv-translation-"));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: artifacts });
const click = async (context, text) => {
  await context.waitForFunction(text => [...document.querySelectorAll(document.querySelector("dialog[open]") ? "dialog[open] button" : "button")].some(button => button.textContent.trim() === text && !button.disabled), {}, text);
  await context.evaluate(text => [...document.querySelectorAll(document.querySelector("dialog[open]") ? "dialog[open] button" : "button")].find(button => button.textContent.trim() === text && !button.disabled).click(), text);
};
try {
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto(`${base}/designs/guided-journey/languages`);
  await page.waitForSelector("#ls-language");
  await page.select("#ls-language", "tr");
  await click(page, "CV languages & headings");
  await page.$eval("#cv-heading-experience", input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Deneyimler");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(page, "Export CV languages");
  let exported;
  for (let i = 0; i < 40; i++) {
    try { exported = JSON.parse(await readFile(join(artifacts, "cv-languages.json"), "utf8")); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.equal(exported.languages.find(language => language.code === "tr").section_titles.experience, "Deneyimler");
  await page.screenshot({ path: join(artifacts, "cv-language-studio.png"), fullPage: true });
  await page.select(".ls-preview-toolbar select", "cvs");
  await page.waitForFunction(() => !document.querySelector(".ls-loading"));
  await page.select("#ls-language", "en");
  await page.waitForFunction(() => !document.querySelector(".ls-loading"));
  await click(page, "Click text to edit");
  const frame = page.frames().find(frame => frame.url().includes("languagePreview=1"));
  await frame.waitForFunction(() => document.documentElement.dataset.languageInspect === "false");
  await frame.evaluate(async () => {
    const { getStudioRuntime } = await import("/src/app/integration/studio-runtime.ts");
    const runtime = getStudioRuntime();
    const get = runtime.client.get.bind(runtime.client);
    const post = runtime.client.post.bind(runtime.client);
    window.translationCalls = [];
    const output = { current_content: { version: "v1", language: "de", metadata: { full_name: "Deniz Yılmaz" }, sections: [{ id: "exp", type: "experience", title: "Berufserfahrung", order: 0, meta: {}, blocks: [{ id: "job", type: "experience", order: 0, visibility: "visible", meta: {}, fields: { role: "Analytiker", description: "20 Berichte erstellt." } }] }] }, target_language: "de", target_direction: "ltr" };
    Object.assign(output.current_content.metadata, { font_scale: "0.85", spacing_scale: 0.8, layout_scale: 1.1 });
    output.current_content.sections[0].blocks = Array.from({ length: 16 }, (_, index) => ({ ...output.current_content.sections[0].blocks[0], id: `job-${index}`, fields: { role: "Analytiker", description: "20 Berichte erstellt. " + "Analyse und Kommunikation im Team. ".repeat(8) } }));
    runtime.client.get = async path => {
      if (path.endsWith("/preview") && path.includes("/translations/")) {
        if (window.translationPreviewFailure) throw new Error("Preview temporarily unavailable");
        return post("/rendering/preview", { cv_kind: "master", current_content: output.current_content, template_id: "demo-template-1" });
      }
      if (path === "/cv-languages") return { languages: [{ code: "en", name: "English", direction: "ltr", section_titles: {} }, { code: "de", name: "Deutsch", direction: "ltr", section_titles: { experience: "Berufserfahrung" } }] };
      if (path.includes("/translations/")) return { id: "fixture-run", status: window.translationFixture?.status ?? "completed", output_payload: window.translationFixture?.output ?? output, progress_stage: window.translationFixture?.status ?? "completed", error_message: null };
      return get(path);
    };
    // The analytics decorator retains the original get function. Replace it on
    // the existing API instance when the dialog loads its catalog.
    // Use the module URL loaded by the app, including Vite's HMR version.
    const apiModuleUrl = performance.getEntriesByType("resource").map(entry => entry.name).find(name => new URL(name).pathname === "/src/app/integration/backend-api.ts");
    const { BackendApi } = await import(apiModuleUrl ?? "/src/app/integration/backend-api.ts");
    const getCvLanguages = BackendApi.prototype.getCvLanguages;
    BackendApi.prototype.getCvLanguages = function () {
      this.client.get = runtime.client.get;
      return getCvLanguages.call(this);
    };
    runtime.client.post = async (path, body) => {
      if (path.includes("/translations")) {
        window.translationCalls.push({ path, body });
        if (path.endsWith("/translations")) return { ai_run_id: "fixture-run" };
        if (path.endsWith("/apply")) return { id: "demo-master-en" };
        return { id: "fixture-run", status: window.translationFixture?.status ?? "completed", output_payload: window.translationFixture?.output ?? output };
      }
      return post(path, body);
    };
    // Set the preview interface to English while retaining its data.
    const { i18n } = await import("/src/app/localization/i18n.ts");
    await i18n.changeLanguage("en");
  });
  await click(frame, "Translate");
  await frame.waitForSelector("#translation-language option[value=de]");
  assert.deepEqual(await frame.$$eval("#translation-language option", options => options.map(option => option.value)), ["", "de"]);
  assert.equal(await frame.$eval("dialog[open] button:last-child", button => button.disabled), true);
  await frame.select("#translation-language", "de");
  await click(frame, "Translate");
  await frame.waitForFunction(() => document.querySelector("dialog[open]")?.textContent.includes("Berufserfahrung"));
  assert.equal((await frame.evaluate(() => window.translationCalls))[0].body.target_language, "de");
  assert.equal(await frame.$eval("#translation-language", select => select.disabled), true);
  const previewSelector = '[aria-label="Translated CV preview"]';
  await frame.waitForSelector(`${previewSelector} .shadow-lg`);
  await frame.waitForFunction(() => document.querySelectorAll('[aria-label="Translated CV preview"] .shadow-lg').length > 1);
  const layout = await frame.$eval(previewSelector, element => {
    const pages = element.querySelectorAll(".shadow-lg");
    return { count: pages.length, font: getComputedStyle(pages[0]).fontFamily, fontScale: getComputedStyle(pages[0]).getPropertyValue("--cv-font-scale"), margin: getComputedStyle(pages[0].firstElementChild).paddingLeft, text: pages[0].textContent };
  });
  assert.match(layout.font, /Noto Sans/);
  assert.equal(Number(layout.fontScale), 0.85);
  assert.match(layout.text, /Deniz Yılmaz/);
  assert.match(layout.text, /Berufserfahrung/);
  await page.screenshot({ path: join(artifacts, "translation-review.png"), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.select('.ls-preview-toolbar label:nth-of-type(2) select', "390");
  await frame.waitForFunction(() => {
    const element = document.querySelector('[aria-label="Translated CV preview"]');
    const page = element?.querySelector(".shadow-lg");
    return page && page.getBoundingClientRect().width <= element.clientWidth;
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await frame.$$eval(`${previewSelector} .shadow-lg`, pages => pages.length), layout.count);
  assert.equal(await frame.$eval(`${previewSelector} .shadow-lg > div`, element => getComputedStyle(element).paddingLeft), layout.margin);
  assert.equal(await frame.$eval('dialog[open]', element => element.scrollWidth <= element.clientWidth), true);
  await page.screenshot({ path: join(artifacts, "translation-review-mobile.png"), fullPage: true });
  await click(frame, "Cancel");
  await frame.evaluate(() => { window.translationPreviewFailure = true; });
  await click(frame, "Translate");
  await frame.waitForSelector("#translation-language option[value=de]");
  await frame.select("#translation-language", "de");
  await click(frame, "Translate");
  await frame.waitForFunction(() => document.querySelector('dialog[open] [role="alert"]')?.textContent.includes("Failed to load CV preview"));
  const callsBeforePreviewRetry = await frame.evaluate(() => window.translationCalls.length);
  await frame.evaluate(() => { window.translationPreviewFailure = false; });
  await click(frame, "Retry");
  await frame.waitForSelector(`${previewSelector} .shadow-lg`);
  assert.equal(await frame.evaluate(() => window.translationCalls.length), callsBeforePreviewRetry);
  await page.setViewport({ width: 1440, height: 1100 });
  await page.select('.ls-preview-toolbar label:nth-of-type(2) select', "1280");
  await click(frame, "Cancel");
  await frame.evaluate(() => {
    window.translationFixture = { status: "failed", output: { target_language: "de", target_direction: "ltr", validation_issues: [{ path: "sections/0/blocks/0/fields/description", section_title: "Work Experience", block_title: "Analyst", field_label: "Description", original_text: "Delivered 20 reports.", translated_text: "200 Berichte erstellt.", original_numbers: ["20"], translated_numbers: ["200"] }] } };
  });
  await click(frame, "Translate");
  await frame.waitForSelector("#translation-language option[value=de]");
  await frame.select("#translation-language", "de");
  await click(frame, "Translate");
  await frame.waitForSelector('[aria-label="Translation comparison"]');
  assert.equal(await frame.$$eval('dialog[open] [role="alert"]', alerts => alerts.length), 1);
  const comparison = await frame.$eval('[aria-label="Translation comparison"]', element => element.textContent);
  assert.match(comparison, /Delivered 20 reports/);
  assert.match(comparison, /200 Berichte erstellt/);
  assert.match(comparison, /Work Experience/);
  assert.match(comparison, /No AI action was charged/);
  assert.equal(await frame.$$eval("dialog[open] button", buttons => buttons.some(button => button.textContent.trim() === "Create translated master")), false);
  await page.screenshot({ path: join(artifacts, "number-comparison.png"), fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.select('.ls-preview-toolbar label:nth-of-type(2) select', "390");
  await page.screenshot({ path: join(artifacts, "number-comparison-mobile.png"), fullPage: true });
  await frame.evaluate(() => { window.translationFixture = null; });
  await click(frame, "Translate");
  await frame.waitForFunction(() => document.querySelector("dialog[open]")?.textContent.includes("Berufserfahrung"));
  assert.equal(await frame.$('[aria-label="Translation comparison"]'), null);
  await click(frame, "Create translated master");
  await frame.waitForFunction(() => location.pathname === "/app/cv/demo-master-en");
  assert.equal((await frame.evaluate(() => window.translationCalls)).at(-1).path.endsWith("/apply"), true);
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, "mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(`CV language editing/export, rendered translation preview/layout/mobile/retry, apply and numerical failure browser checks passed: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true });
  console.error(`Failure artifacts: ${artifacts}; browser errors: ${JSON.stringify(errors)}`);
  throw error;
} finally { await browser.close(); }
