import assert from "node:assert/strict";
import puppeteer from "puppeteer";
const base = process.env.LANGUAGE_STUDIO_URL ?? "http://127.0.0.1:5173";
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [],
  leaks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  const frame = request.frame();
  const url = new URL(request.url());
  if (
    frame?.parentFrame() &&
    (/supabase|stripe/.test(url.hostname) ||
      /\/api\/|\/auth\/v1/.test(url.pathname))
  )
    leaks.push(request.url());
});
await page.setViewport({ width: 1600, height: 1100 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("cv-interface-locale", "en");
  localStorage.setItem("real-cv-draft-sentinel", "keep");
  sessionStorage.setItem("real-checkout-sentinel", "keep");
});
const ready = () =>
  page.waitForFunction(() => !document.querySelector(".ls-loading"), {
    timeout: 20000,
  });
const frame = () =>
  page.frames().find((frame) => frame.url().includes("languagePreview=1"));
const select = async (label, value) => {
  await page.select(`[aria-label="${label}"]`, value);
  await ready();
};
const choose = async (value) => {
  await page.select(".ls-preview-toolbar label:first-of-type select", value);
  await ready();
};
const contains = (text) =>
  frame().waitForFunction(
    (text) =>
      `${document.body.textContent} ${[...document.querySelectorAll("input, textarea")].map((input) => input.value).join(" ")}`.includes(
        text,
      ),
    { timeout: 20000 },
    text,
  );
try {
  await page.goto(`${base}/designs/guided-journey/languages`, {
    waitUntil: "networkidle0",
  });
  await ready();
  await page.select("#ls-language", "en");
  await ready();
  const expected = {
    dashboard: "Deniz",
    cvs: "English CV",
    editor: "Deniz",
    "editor-tr": "Deniz",
    billing: "Pricing",
    applications: "Example Studio",
    letters: "Example Studio",
    "letter-editor": "Dear Hiring Team",
    "letter-editor-tr": "Sayın Yetkili",
    profile: "deniz@example.invalid",
    create: "Upload",
    tailor: "English CV",
  };
  for (const [scene, text] of Object.entries(expected)) {
    await choose(scene);
    await contains(text);
    assert.ok(
      frame().url().includes("/app"),
      `App scene ${scene} was redirected`,
    );
    console.log(`Checked ${scene}`);
  }
  await choose("cvs");
  await select("Demo state", "empty");
  await contains("Create or upload CV");
  await select("Demo state", "error");
  await frame().waitForSelector('[role="alert"]');
  await select("Demo state", "loading");
  await contains("Loading");
  await select("Demo state", "populated");
  await contains("English CV");
  await choose("billing");
  await select("Demo pricing market", "GLOBAL");
  await contains("$");
  await select("Demo pricing market", "TR");
  await frame().waitForFunction(() => /TRY|₺/.test(document.body.textContent));
  await select("Demo account plan", "free");
  await contains("Free");
  await choose("editor");
  // Turn off text inspection to navigate and interact with real components.
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.includes("Click text to edit"))
      .click(),
  );
  await frame().evaluate(() =>
    [...document.querySelectorAll("a")]
      .find((a) => a.textContent.trim() === "My CVs")
      .click(),
  );
  await contains("English CV");
  assert.ok(
    frame().url().includes("previewSession="),
    "Navigation lost preview context",
  );
  const direct = await frame().evaluate(async () => {
    try {
      await fetch("/api/v1/master-cvs");
      return "escaped";
    } catch {
      return "blocked";
    }
  });
  assert.equal(direct, "blocked");
  await choose("profile");
  await contains("deniz@example.invalid");
  const unchangedUrl = frame().url();
  await frame().evaluate(() => {
    const input = [...document.querySelectorAll("input")].find(
      (input) => input.value === "Deniz Yılmaz",
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, "Edited demo name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.select("#ls-language", "tr");
  await ready();
  assert.equal(frame().url(), unchangedUrl);
  assert.ok(
    await frame().evaluate(() =>
      [...document.querySelectorAll("input")].some(
        (input) => input.value === "Edited demo name",
      ),
    ),
  );
  await page.select("#ls-language", "en");
  await ready();
  await frame().evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Save changes")
      .click(),
  );
  await contains("Profile updated successfully.");
  await frame().evaluate(() => {
    localStorage.setItem("real-cv-draft-sentinel", "demo-change");
    sessionStorage.setItem("real-checkout-sentinel", "demo-change");
  });
  assert.deepEqual(
    await page.evaluate(() => [
      localStorage.getItem("real-cv-draft-sentinel"),
      sessionStorage.getItem("real-checkout-sentinel"),
    ]),
    ["keep", "keep"],
  );
  assert.deepEqual(leaks, []);
  assert.deepEqual(errors, []);
  // A normal app tab still requires authentication even with query parameters.
  const normal = await browser.newPage();
  await normal.goto(
    `${base}/app?languagePreview=1&previewSession=untrusted-test`,
    { waitUntil: "networkidle0" },
  );
  await normal.waitForFunction(() => location.pathname === "/signup");
  await normal.close();
  console.log(
    "Demo browser checks passed: all app scenes, states, pricing, navigation, storage/network isolation and normal auth.",
  );
} catch (error) {
  console.error(
    "Failed preview:",
    frame()?.url(),
    await frame()?.evaluate(() => document.body.innerText.slice(0, 2500)),
    errors,
    leaks,
  );
  await page.screenshot({ path: "/tmp/cv-language-demo-failure.png" });
  throw error;
} finally {
  await browser.close();
}
