import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
const base = process.env.STUDIO_URL ?? 'http://127.0.0.1:5177';
const output = fileURLToPath(new URL('../../artifacts/template-order-studio/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto(`${base}/designs/template-order`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.tos-card');
  const order = () => page.$$eval('.tos-card', cards => cards.map(card => card.dataset.templateSlug));
  const original = await order();
  assert.equal(original.length, 41);
  assert.equal(new Set(original).size, 41);
  assert.equal(await page.$eval('.tos-grid', el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
  const failedImages = await page.$$eval('.tos-paper img', async images => {
    for (const img of images) img.loading = 'eager';
    return (await Promise.all(images.map(async img => { try { await img.decode(); return img.naturalWidth > 0 ? null : img.src; } catch { return img.src; } }))).filter(Boolean);
  });
  assert.deepEqual(failedImages, []);
  await page.click('.tos-handle');
  await page.keyboard.press('ArrowDown');
  let next = await order();
  assert.equal(next[3], original[0]);
  await page.evaluate(() => [...document.querySelectorAll('.tos-actions button')].find(button => button.textContent === 'Undo').click());
  assert.deepEqual(await order(), original);
  await page.setDragInterception(true);
  const source = await page.$('.tos-card:first-child');
  const destination = await page.$('.tos-card:nth-child(5)');
  await source.dragAndDrop(destination, { delay: 100 });
  next = await order();
  assert.equal(next[4], original[0]);
  assert.equal(new Set(next).size, 41);
  const sidebarOrder = () => page.$$eval('.tos-order-row', rows => rows.map(row => row.dataset.orderSlug));
  assert.deepEqual(await sidebarOrder(), next);
  // Every row and preview has direct top/bottom controls, with shared ordering.
  const quickSlug = next[10];
  await page.$eval(`.tos-order-row[data-order-slug="${quickSlug}"] .tos-edge-actions button:first-child`, button => button.click());
  assert.equal((await order())[0], quickSlug);
  assert.equal(await page.$eval(`.tos-order-row[data-order-slug="${quickSlug}"] .tos-edge-actions button:first-child`, button => button.disabled), true);
  await page.$eval(`.tos-card[data-template-slug="${quickSlug}"] .tos-edge-actions button:last-child`, button => button.click());
  assert.equal((await sidebarOrder()).at(-1), quickSlug);
  assert.deepEqual(await sidebarOrder(), await order());
  next = await order();
  // A direct position edit moves the final item to the beginning of both views.
  const lastSlug = next.at(-1);
  await page.$eval(`.tos-order-row[data-order-slug="${lastSlug}"] input`, input => { input.value = '1'; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  await page.waitForFunction(slug => document.querySelector('.tos-card').dataset.templateSlug === slug, {}, lastSlug);
  next = await order();
  assert.equal(next[0], lastSlug);
  assert.deepEqual(await sidebarOrder(), next);
  // The sidebar's pinned destinations move items across all 41 positions.
  await page.click(`.tos-order-row[data-order-slug="${lastSlug}"] .tos-list-name`);
  await page.evaluate(() => document.querySelector('.tos-quick-moves button:last-child').click());
  await page.waitForFunction(slug => [...document.querySelectorAll('.tos-card')].at(-1).dataset.templateSlug === slug, {}, lastSlug);
  assert.equal((await sidebarOrder()).at(-1), lastSlug);
  // Drag a compact row directly onto the always-visible first-position destination.
  await page.$eval('.tos-order-list', list => { list.scrollTop = list.scrollHeight; });
  await (await page.$('.tos-order-row:last-child')).dragAndDrop(await page.$('.tos-quick-moves button:first-child'), { delay: 100 });
  await page.waitForFunction(slug => document.querySelector('.tos-card').dataset.templateSlug === slug, {}, lastSlug);
  assert.equal((await sidebarOrder())[0], lastSlug);
  // A held drag at the list edge keeps scrolling without further pointer movement.
  await page.$eval('.tos-order-list', list => { list.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 350));
  const bounds = await page.$eval('.tos-order-list', list => { const rect = list.getBoundingClientRect(); return {x:rect.left + rect.width / 2, y:rect.bottom - 8}; });
  const dragData = await (await page.$('.tos-order-row:first-child')).drag(bounds);
  await page.mouse.dragEnter(bounds, dragData);
  await page.mouse.dragOver(bounds, dragData);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.ok(await page.$eval('.tos-order-list', list => list.scrollTop) > 100, 'List should auto-scroll while holding a drag near its edge');
  await page.mouse.drop(bounds, dragData);
  await page.mouse.up();
  next = await order();
  assert.deepEqual(await sidebarOrder(), next);
  assert.equal(new Set(next).size, 41);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.deepEqual(await order(), next);
  await page.click('.tos-paper');
  assert.equal(await page.$eval('.tos-dialog', dialog => dialog.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('.tos-dialog', dialog => dialog.open), false);
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
  await rm(resolve(output, 'cv-template-order.json'), { force: true });
  await page.click('.tos-export');
  let exported;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { exported = JSON.parse(await readFile(resolve(output, 'cv-template-order.json'), 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.deepEqual(exported.template_order, next);
  assert.deepEqual(exported.templates.map(template => template.position), Array.from({length:41}, (_, index) => index + 1));
  await page.screenshot({ path: resolve(output, 'desktop.png') });
  await page.setViewport({ width: 900, height: 900 });
  assert.equal(await page.$eval('.tos-grid', el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 3);
  await page.screenshot({ path: resolve(output, 'compact.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ templates: 41, columns: 3, thumbnails: 'all loaded', keyboard: 'passed', dragAndDrop: 'passed', sidebar: 'passed', directPosition: 'passed', longRangeDrag: 'passed', autoScroll: 'passed', persistence: 'passed', preview: 'passed', export: 'passed', errors }, null, 2));
  console.log('PASS: 41 previews, three columns, sidebar sync, direct positions, long-range drag, auto-scroll, keyboard reorder, persistence and JSON export.');
} finally { await browser.close(); }
