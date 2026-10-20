import assert from 'node:assert/strict';

export async function verifyEditorTour(page, { mode = 'browse', width = 1280, screenshotDir } = {}) {
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
  await waitForGuide('customize-btn');
  await page.click('[data-onboarding-guide] button');
  await waitForGuide('template-btn');
  assert(!new URL(page.url()).pathname.includes('/tailor/'));
  if (mode === 'dismiss') await page.keyboard.press('Escape');
  else {
    await page.click('[data-onboarding="template-btn"]');
    await page.waitForSelector('[data-slot="dialog-content"]');
    assert.equal(await page.$('[data-onboarding-guide]'), null, 'next tip must wait for the gallery to close');
    if (mode === 'select') {
      await page.waitForSelector('[data-slot="dialog-content"] .grid button');
      await page.click('[data-slot="dialog-content"] .grid button');
    } else await page.click('[data-slot="dialog-content"] > button:last-child');
    await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'));
  }
  await waitForGuide('layout-btn');
  await page.click('[data-onboarding="layout-btn"]');
  await page.waitForSelector('[data-slot="popover-content"] input[type="range"]');
  assert.equal(await page.$('[data-onboarding-guide]'), null, 'next tip must wait for font controls to close');
  const font = await page.$('[data-slot="popover-content"] input[type="range"]');
  const before = await font.evaluate(el => el.value);
  await font.focus();
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await font.evaluate(el => el.value), before, 'font controls must respond to keyboard input');
  await page.keyboard.press('Escape');
  await waitForGuide('export-btn');
  await page.click('[data-onboarding-guide] button');
  await page.waitForFunction(() => !document.querySelector('[data-onboarding-guide]'));
  // Tailoring remains available later, including its job-description guidance.
  await page.click('[data-onboarding="customize-btn"]');
  await page.waitForFunction(() => document.querySelector('[data-onboarding-guide]')?.getAttribute('data-onboarding-guide') === '[data-onboarding="job-form"]' || document.querySelector('#ai-resume-heading'));
  if (await page.$('#ai-resume-heading')) {
    const minimize = await page.$('button[aria-label="Minimize checklist"], button[aria-label="Kontrol listesini küçült"]');
    if (minimize) await minimize.click();
    await page.click('.privacy-actions button');
  }
  try { await page.waitForFunction(() => document.querySelector('[data-onboarding-guide]')?.getAttribute('data-onboarding-guide') === '[data-onboarding="job-form"]'); } catch { throw new Error(JSON.stringify({ width, mode, path: new URL(page.url()).pathname, text: await page.evaluate(() => document.body.innerText) })); }
  await page.keyboard.press('Escape');
  console.log(`Editor tour: ${width}px, ${mode} templates → interactive fonts → export; job guidance remains available when tailoring`);
}
