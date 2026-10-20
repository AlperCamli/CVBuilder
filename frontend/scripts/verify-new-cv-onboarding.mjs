// Isolated browser transport fixtures: no real signup, email, AI, or storage calls.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
const base = process.env.ONBOARDING_BROWSER_URL ?? 'http://127.0.0.1:5174';
const output = new URL('../../artifacts/new-cv-onboarding/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
const waitText = (page, text) => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
const clickText = async (page, text) => {
  await page.waitForFunction(text => [...document.querySelectorAll('button,a')].some(el => el.textContent.trim() === text && !el.disabled), {}, text);
  await page.evaluate(text => [...document.querySelectorAll('button,a')].find(el => el.textContent.trim() === text && !el.disabled).click(), text);
};
async function scenario(method) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [], unexpected = [], requests = [];
  const now = new Date().toISOString(), userId = randomUUID(), authId = randomUUID(), cvId = randomUUID();
  const user = { id: authId, aud: 'authenticated', email: 'candidate@example.invalid', role: 'authenticated', app_metadata: { provider: method === 'google' ? 'google' : 'email', providers: [method === 'google' ? 'google' : 'email'] }, user_metadata: { full_name: 'Test Candidate' }, identities: [], created_at: now };
  const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: authId, exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), amr: [{ method: 'password', timestamp: Math.floor(Date.now()/1000) }] })).toString('base64url'), 'fixture-signature'].join('.');
  const session = { access_token: jwt, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user };
  const limits = { tailored_cv_generations: 3, exports: 5, ai_actions: 20, storage_bytes: 1000000 };
  const appUser = { id: userId, auth_user_id: authId, email: user.email, full_name: 'Test Candidate', locale: 'en', default_cv_language: 'en', onboarding_completed: false, onboarding_state: {}, onboarding_answers: {}, created_at: now, updated_at: now };
  const me = { user: appUser, current_plan: { plan_code: 'free', status: 'active' }, entitlements: { plan_code: 'free', limits, remaining: limits }, usage_summary: { plan_code: 'free', limits, remaining: limits, period_month: now.slice(0,7), ai_actions_count: 0, exports_count: 0, tailored_cv_generations_count: 0, storage_bytes_used: 0 } };
  const config = { notice_version: '2026-10-06.2', controller: 'Fixture', address: 'Test only', contact: 'privacy@example.invalid', processors: [], collection_enabled: true, ai_required: true, ai_enabled: true, ai_provider: 'Test provider', analytics_enabled: false };
  const content = { version: 'v1', language: 'en', metadata: {}, sections: [] };
  const master = { id: cvId, user_id: userId, title: 'My Main CV', language: 'en', template_id: null, module_type: 'standard', current_content: content, original_content: content, source_type: 'scratch', created_at: now, updated_at: now };
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async req => {
    try {
      const url = new URL(req.url());
      const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      const respond = data => req.respond({ status: 200, headers, body: JSON.stringify({ success: true, data }) });
      const raw = data => req.respond({ status: 200, headers, body: JSON.stringify(data) });
      if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers }); return; }
      if (url.hostname === 'privacy-fixture.supabase.invalid') {
        if (url.pathname.endsWith('/authorize')) { await req.respond({ status: 302, headers: { location: `${base}/auth/callback#access_token=${jwt}&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600&type=signup` } }); return; }
        if (url.pathname.endsWith('/user')) { await raw(user); return; }
        if (url.pathname.endsWith('/signup')) { await raw(method === 'verification' ? { user, session: null } : session); return; }
        if (url.pathname.endsWith('/token')) { await raw(session); return; }
        unexpected.push('unexpected auth route'); await req.abort(); return;
      }
      if (url.origin !== base) { unexpected.push('unexpected external request'); await req.abort(); return; }
      if (!url.pathname.startsWith('/api/v1/')) { await req.continue(); return; }
      const path = url.pathname.slice('/api/v1'.length), body = req.postData() ? JSON.parse(req.postData()) : {};
      requests.push({ path, method: req.method(), body });
      if (path === '/privacy/config') { await respond(config); return; }
      assert(req.headers().authorization, `authenticated request required: ${path}`);
      if (path === '/me') { await respond(me); return; }
      if (path === '/me/privacy') { await respond({ analytics: false, ai_processing: false, privacy_revision: 0 }); return; }
      if (path === '/me/settings') { await respond({ settings: { default_cv_language: 'en', locale: 'en', onboarding_completed: false, onboarding_state: {} } }); return; }
      if (path === '/me/onboarding-answers') { appUser.onboarding_answers = body; await respond({ answers: body }); return; }
      if (path === '/master-cvs' && req.method() === 'POST') { assert.deepEqual(body, { title: 'My Main CV', language: 'en' }); await respond(master); return; }
      if (path === '/master-cvs') { await respond([master]); return; }
      if (path === `/tailored-cvs/${cvId}`) { await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Master CV fixture' } }) }); return; }
      if (path === `/master-cvs/${cvId}`) { await respond(master); return; }
      if ((path.endsWith('/ai/block-versions') || path.endsWith('/ai-block-versions'))) { await respond({ blocks: [] }); return; }
      if (path === '/templates') { await respond({ templates: [] }); return; }
      if (path === '/rendering/preview') { await respond({ presentation: null, resolved_template: { resolution: 'none', template: null } }); return; }
      if (path === '/billing/prices') { await respond({ market: 'GLOBAL', currency: 'usd', available: false, quote: null, plans: [] }); return; }
      if (path === '/billing/usage') { await respond(me.usage_summary); return; }
      if (path === '/billing/plan') { await respond({ ...me.current_plan, entitlements: me.entitlements }); return; }
      unexpected.push(`unhandled API fixture: ${req.method()} ${path}`);
      await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Unconfigured fixture' } }) });
    } catch (err) { unexpected.push(err.message); if (!req.isInterceptResolutionHandled()) await req.abort(); }
  });
  await page.evaluateOnNewDocument(() => {
    if (!localStorage.getItem('cv-builder:privacy-choices')) localStorage.setItem('cv-builder:privacy-choices', JSON.stringify({ version: '2026-10-06.2', analytics: false, expires_at: new Date(Date.now()+86400000).toISOString() }));
    localStorage.setItem('cv-interface-locale', 'en');
  });
  await page.goto(`${base}/onboarding`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ob-create-zone');
  assert.equal(await page.$eval('.ai-upload-details', el => el.open), false);
  assert.equal(await page.$eval('.ai-upload-choice input', el => el.checked), false);
  const geometry = await page.evaluate(() => {
    const box = selector => { const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height }; };
    return { guide: box('.ob-start-guidance'), upload: box('.ob-upload-zone'), create: box('.ob-create-zone') };
  });
  assert(geometry.guide.x < geometry.upload.x);
  assert(geometry.upload.y < geometry.create.y);
  assert.equal(geometry.upload.width, geometry.create.width);
  assert(Math.abs(geometry.upload.height - geometry.create.height) < 4);
  if (method === 'email') {
    await page.screenshot({ path: new URL('desktop.png', output).pathname, fullPage: true });
    for (const width of [320, 390, 768]) {
      await page.setViewport({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}px`);
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: new URL('mobile.png', output).pathname, fullPage: true });
    await page.setViewport({ width: 1280, height: 900 });
  }
  await page.click('.ob-create-zone');
  await waitText(page, 'Question 1 of 4');
  assert.equal(requests.filter(row => row.path.startsWith('/guest-imports')).length, 0);
  await page.click('input[value="tailor"]');
  await clickText(page, 'Continue');
  await waitText(page, 'Question 2 of 4');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitText(page, 'Question 2 of 4');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cv-builder:new-cv-onboarding')).answers.goal), 'tailor');
  await clickText(page, 'Back');
  await waitText(page, 'Question 1 of 4');
  assert.equal(await page.$eval('input[value="tailor"]', el => el.checked), true);
  await clickText(page, 'Continue');
  await page.click('input[value="student"]');
  await clickText(page, 'Continue');
  await waitText(page, 'Question 3 of 4');
  await clickText(page, 'Skip');
  await waitText(page, 'Question 4 of 4');
  await clickText(page, 'Skip');
  await waitText(page, 'Create a free account to start building your new CV.');
  await page.reload({ waitUntil: 'networkidle0' });
  await waitText(page, 'Create account & open CV editor');
  if (method === 'google') await clickText(page, 'Continue with Google');
  else {
    await page.type('#onboarding-name', 'Test Candidate');
    await page.type('#onboarding-email', 'candidate@example.invalid');
    await page.type('#onboarding-password', 'fixture-password');
    await clickText(page, 'Create account & open CV editor');
    if (method === 'verification') {
      await waitText(page, 'Check your email');
      assert.equal(requests.filter(row => row.path === '/master-cvs').length, 0);
      await page.goto(`${base}/auth/callback#access_token=${jwt}&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600&type=signup`, { waitUntil: 'networkidle0' });
    }
  }
  try { await page.waitForFunction(id => location.pathname === `/app/cv/${id}`, {}, cvId); }
  catch { throw new Error(JSON.stringify({ method, path: new URL(page.url()).pathname, text: await page.evaluate(() => document.body.innerText), unexpected, errors })); }
  try { await waitText(page, 'My Main CV'); } catch { throw new Error(JSON.stringify({ method, path: new URL(page.url()).pathname, text: await page.evaluate(() => document.body.innerText), unexpected, errors, paths: requests.slice(-18).map(row => row.path) })); }
  assert.deepEqual(appUser.onboarding_answers, { goal: 'tailor', career: 'student' });
  assert.equal(requests.filter(row => row.path === '/master-cvs' && row.method === 'POST').length, 1);
  assert.equal(requests.filter(row => /guest-imports|imports\//.test(row.path)).length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('cv-builder:new-cv-onboarding')), null);
  assert.deepEqual(master.current_content.sections, []);
  await page.reload({ waitUntil: 'networkidle0' });
  try { await waitText(page, 'My Main CV'); } catch { throw new Error(JSON.stringify({ method, path: new URL(page.url()).pathname, text: await page.evaluate(() => document.body.innerText), unexpected, errors, paths: requests.slice(-18).map(row => row.path) })); }
  assert.equal(requests.filter(row => row.path === '/master-cvs' && row.method === 'POST').length, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await context.close();
  console.log(`${method}: new CV → questions/back/skip/refresh → signup → blank CV editor; exactly one creation, no upload or parsing requests`);
}
try {
  await scenario('email');
  await scenario('google');
  await scenario('verification');
  console.log('Desktop/mobile layouts and collapsed privacy details passed. Screenshots: artifacts/new-cv-onboarding');
} finally { await browser.close(); }
