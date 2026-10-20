import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

export async function verifyEditorTour(page, { mode = 'browse', width = 1280, screenshotDir, getProgress, getRequests } = {}) {
  await page.setViewport({ width, height: 900 });
  const waitForGuide = async name => {
    const target = `[data-onboarding="${name}"]`;
    await page.waitForFunction(target => {
      const guide = document.querySelector('[data-onboarding-guide]');
      return guide?.getAttribute('data-onboarding-guide') === target && guide.getBoundingClientRect().top >= 0;
    }, {}, target);
    const box = await page.evaluate(target => {
      const guide = document.querySelector('[data-onboarding-guide]');
      const button = document.querySelector(target);
      const g = guide.getBoundingClientRect(), b = button.getBoundingClientRect(), close = guide.querySelector('button').getBoundingClientRect();
      return { left: g.left, top: g.top, right: g.right, bottom: g.bottom, closeWidth: close.width, closeHeight: close.height,
        overlap: Math.max(0, Math.min(g.right, b.right) - Math.max(g.left, b.left)) * Math.max(0, Math.min(g.bottom, b.bottom) - Math.max(g.top, b.top)),
        targetClickable: button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)), viewportWidth: innerWidth, viewportHeight: innerHeight };
    }, target);
    assert(box.left >= 11 && box.top >= 11 && box.right <= box.viewportWidth - 11 && box.bottom <= box.viewportHeight - 11, `${name}: popup outside viewport`);
    assert.equal(box.overlap, 0, `${name}: popup covers the highlighted button`);
    assert(box.closeWidth >= 44 && box.closeHeight >= 44);
    assert(box.targetClickable, `${name}: target is blocked`);
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${width}-${mode}-${name}.png` });
  };
  const waitForSaved = async step => {
    for (let attempt = 0; attempt < 100 && !getProgress().steps?.[step]; attempt++) await pause(25);
    assert(getProgress().steps?.[step], `${step} must be saved when its feature is opened`);
  };
  const reloadAt = async step => {
    await page.reload({ waitUntil: 'networkidle0' });
    await waitForGuide('customize-btn');
    await page.click('[data-onboarding-guide] button');
    await waitForGuide(step);
  };
  const closeDialog = async () => {
    await page.click('[data-slot="dialog-content"] > button:last-child');
    await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'));
  };
  const openTemplates = async () => {
    await page.click('[data-onboarding="template-btn"]');
    await page.waitForSelector('[data-slot="dialog-content"]');
    await waitForSaved('template');
    assert.equal(await page.$('[data-onboarding-guide]'), null, 'next tip must wait for the gallery to close');
    if (mode === 'select') await page.click('[data-slot="dialog-content"] .grid button');
    else await closeDialog();
    await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'));
  };
  await waitForGuide('customize-btn');
  if (mode === 'select') {
    await page.click('[data-onboarding="customize-btn"]');
    await waitForSaved('customize');
    await page.waitForFunction(() => document.querySelector('[data-onboarding-guide]')?.getAttribute('data-onboarding-guide') === '[data-onboarding="job-form"]' || document.querySelector('#ai-resume-heading'));
    if (await page.$('#ai-resume-heading')) {
      const minimize = await page.$('button[aria-label="Minimize checklist"], button[aria-label="Kontrol listesini küçült"]');
      if (minimize) await minimize.click();
      await page.click('.privacy-actions button');
    }
    await page.waitForSelector('[data-onboarding="job-form"] input');
    await page.click('[data-onboarding="job-form"] input');
    await waitForSaved('job_details');
    await page.goBack({ waitUntil: 'networkidle0' });
  } else await page.click('[data-onboarding-guide] button');
  await waitForGuide('template-btn');
  if (mode === 'dismiss') await page.keyboard.press('Escape');
  else {
    await openTemplates();
    if (mode === 'browse') await reloadAt('layout-btn');
  }
  await waitForGuide('layout-btn');
  await page.click('[data-onboarding="layout-btn"]');
  await page.waitForSelector('[data-slot="popover-content"] input[type="range"]');
  await waitForSaved('layout');
  assert.equal(await page.$('[data-onboarding-guide]'), null, 'next tip must wait for font controls to close');
  // Leave every font, spacing and layout setting unchanged.
  await page.keyboard.press('Escape');
  if (mode === 'browse') await reloadAt('export-btn');
  await waitForGuide('export-btn');
  await page.click('[data-onboarding="export-btn"]');
  await page.waitForSelector('[data-slot="dialog-content"]');
  await waitForSaved('export');
  await closeDialog();
  if (mode === 'dismiss') {
    assert(!getProgress().completed_at, 'opening export first must not finish the unvisited template step');
    await reloadAt('template-btn');
    await openTemplates();
  }
  assert(getProgress().completed_at, 'exploring all essential editor features completes the tour');
  const progressBeforeReload = structuredClone(getProgress());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-onboarding="template-btn"]');
  await pause(800);
  assert.equal(await page.$('[data-onboarding-guide]'), null, 'completed discovery tips must not return after refresh');
  assert.deepEqual(getProgress(), progressBeforeReload);
  assert.equal(getRequests().filter(req => req.method === 'POST' && /\/exports\/(pdf|docx)$/.test(req.path)).length, 0, 'export discovery does not require creating a file');
  assert.equal(getRequests().filter(req => req.method === 'PUT' && req.path.endsWith('/content')).length, 0, 'font discovery must not require changing CV settings');
  console.log(`Editor tour: ${width}px, ${mode}; template/font/export visits persisted without changes or download, no repeated tips after refresh`);
}
