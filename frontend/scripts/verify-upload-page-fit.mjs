import assert from "node:assert/strict";
import puppeteer from "puppeteer";

// Uses isolated demo data and real editor pagination. No live uploads or account writes.
const base = process.env.CV_FIT_TEST_URL ?? "http://127.0.0.1:5173";
const browser = await puppeteer.launch({ headless: true });
try {
  for (const [target, entries, fits] of [
    [1, 6, true],
    [2, 16, true],
    [1, 16, false],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1100 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const host = new URL("/__page-fit-check", base).href;
    await page.setRequestInterception(true);
    page.on("request", (request) =>
      request.url() === host
        ? request.respond({
            status: 200,
            contentType: "text/html",
            body: '<iframe style="width:1500px;height:1000px" src="/app/resumes?languagePreview=1&previewSession=page-fit-test&demoPlan=monthly&demoState=populated"></iframe>',
          })
        : request.continue(),
    );
    await page.goto(host);
    const frame = await (await page.$("iframe")).contentFrame();
    await frame.waitForSelector('a[href="/app/cv/demo-master-en"]');
    await frame.evaluate(
      async ({ target, entries }) => {
        const { getStudioRuntime } =
          await import("/src/app/integration/studio-runtime.ts");
        const runtime = getStudioRuntime();
        const cv = await runtime.client.get("/master-cvs/demo-master-en");
        const experience = cv.current_content.sections.find(
          (s) => s.type === "experience",
        );
        experience.blocks = Array.from({ length: entries }, (_, i) => ({
          ...experience.blocks[0],
          id: `fit-job-${i}`,
          fields: {
            ...experience.blocks[0].fields,
            role: `Engineer ${i}`,
            description:
              "Designed reliable applications and improved performance for customers. ".repeat(
                3,
              ),
          },
        }));
        cv.current_content.metadata.source_page_count = target;
        await runtime.client.put("/master-cvs/demo-master-en/content", {
          current_content: cv.current_content,
        });
        const put = runtime.client.put.bind(runtime.client);
        window.fitSaves = [];
        runtime.client.put = async (path, body, ...args) => {
          if (path.endsWith("/content"))
            window.fitSaves.push(structuredClone(body));
          return put(path, body, ...args);
        };
        window.fitHistory = [];
        new MutationObserver(() => {
          const text = document.querySelector(
            '[data-onboarding="layout-btn"]',
          )?.textContent;
          if (text && window.fitHistory.at(-1) !== text)
            window.fitHistory.push(text);
        }).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
        history.pushState(
          {
            usr: { cvKind: "master", masterCvId: cv.id, isUploaded: true },
            key: "fit",
            idx: 1,
          },
          "",
          "/app/cv/" + cv.id + location.search,
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      { target, entries },
    );
    await frame.waitForSelector('[data-onboarding="layout-btn"]');
    try {
      await frame.waitForFunction(() => window.fitSaves.length > 0, {
        timeout: 25000,
      });
    } catch (e) {
      console.log(
        "debug",
        await frame.evaluate(() => ({
          history: window.fitHistory,
          body: document.body.textContent.slice(0, 1800),
          stored: Object.keys(sessionStorage),
        })),
        errors,
      );
      throw e;
    }
    const result = await frame.evaluate(() => ({
      history: window.fitHistory,
      saved: window.fitSaves.at(-1).current_content.metadata,
      final: document.querySelector('[data-onboarding="layout-btn"]')
        .textContent,
    }));
    console.log(
      JSON.stringify({
        target,
        entries,
        initial: result.history.find((text) => text.includes("pages")),
        final: result.final,
        saved: result.saved,
      }),
    );
    assert.equal(result.saved.source_page_count, target);
    assert.ok(result.saved.font_scale < 1);
    if (fits) {
      assert.ok(result.final.includes(`${target} page`));
      assert.equal(result.saved.spacing_scale, 1);
    } else {
      assert.equal(result.saved.font_scale, 0.5);
      assert.equal(result.saved.spacing_scale, 0.2);
      assert.ok(!result.final.includes("1 page"));
      assert.ok(
        await frame.evaluate(() =>
          document.body.textContent.includes("longer than the original upload"),
        ),
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Upload page fitting browser checks passed");
} finally {
  await browser.close();
}
