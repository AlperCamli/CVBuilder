// Browser integration verification with isolated transport fixtures. No real
// authentication, analytics, billing, storage or CV-provider requests are sent.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
const base = process.env.PRIVACY_BROWSER_URL ?? 'http://127.0.0.1:5174';
const dir = await mkdtemp(join(tmpdir(), 'cv-privacy-browser-'));
const cvPath = join(dir, 'private-person-cv.pdf');
await writeFile(cvPath, '%PDF-1.4\nIsolated browser fixture');
const browser = await puppeteer.launch({ headless: true });
const version = '2026-10-06.2';
const config = { notice_version: version, controller: 'Isolated test operator', address: 'Test only', contact: 'privacy@example.invalid', processors: [], collection_enabled: true, ai_required: true, ai_enabled: true, ai_provider: 'Test provider', analytics_enabled: true };
const clickText = async (page, text) => {
  await page.waitForFunction(text => [...document.querySelectorAll('button,a')].some(el => el.textContent.trim() === text && !el.disabled), {}, text);
  await page.evaluate(text => [...document.querySelectorAll('button,a')].find(el => el.textContent.trim() === text && !el.disabled).click(), text);
};
const waitText = (page, text) => page.waitForFunction(text => document.body.innerText.includes(text), { polling: 100 }, text);
const limits = { tailored_cv_generations: 3, exports: 5, ai_actions: 20, storage_bytes: 1000000 };
const content = { schema_version: '1.0', language: 'en', metadata: {}, sections: [{ id: 'header', type: 'header', title: 'Personal details', order: 0, blocks: [{ id: 'header-block', type: 'header', data: { full_name: 'Test Candidate', headline: 'Software engineer', email: 'candidate@example.invalid' }, meta: {} }] }] };
const review = { status: 'scored', score: 72, summary: 'Your CV is readable. Guidance only.', strengths: [], improvements: [], dimensions: [], limitations: ['Guidance, not an employment guarantee.'], matched_keywords: [], missing_keywords: [], version: 'fixture' };
async function scenario(method) {
  const context = await browser.createBrowserContext();
  const userId = randomUUID(), authId = randomUUID(), guestId = randomUUID(), importId = randomUUID(), cvId = randomUUID();
  const now = new Date().toISOString();
  const user = { id: authId, aud: 'authenticated', email: 'candidate@example.invalid', role: 'authenticated', app_metadata: { provider: method === 'google' ? 'google' : 'email', providers: [method === 'google' ? 'google' : 'email'] }, user_metadata: { full_name: 'Test Candidate' }, identities: [], created_at: now };
  const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: authId, exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), amr: [{ method: method === 'google' ? 'oauth' : 'password', timestamp: Math.floor(Date.now()/1000) }] })).toString('base64url'), 'fixture-signature'].join('.');
  const session = { access_token: jwt, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user };
  const appUser = { id: userId, auth_user_id: authId, email: user.email, full_name: 'Test Candidate', locale: 'en', default_cv_language: 'en', onboarding_completed: false, onboarding_state: {}, onboarding_answers: {}, created_at: now, updated_at: now };
  const me = { user: appUser, current_plan: { plan_code: 'free', status: 'active' }, entitlements: { plan_code: 'free', limits, remaining: limits }, usage_summary: { plan_code: 'free', limits, remaining: limits, period_month: now.slice(0,7), ai_actions_count: 0, exports_count: 0, tailored_cv_generations_count: 0, storage_bytes_used: 0 } };
  const master = { id: cvId, user_id: userId, title: 'Imported CV', language: 'en', template_id: null, module_type: 'standard', current_content: content, original_content: content, source_type: 'import', created_at: now, updated_at: now, is_deleted: false };
  let answers = {}, parsed = false, uploaded = false, claimed = false;
  const requests = [], googleRequests = [], unexpected = [], errors = [];
  const preferences = { analytics: false, ai_processing: false, privacy_revision: 0 };
  const attach = async page => {
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async req => {
      try {
        const url = new URL(req.url());
        const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        const respond = data => req.respond({ status: 200, headers, body: JSON.stringify({ success: true, data }) });
        const raw = data => req.respond({ status: 200, headers, body: JSON.stringify(data) });
        if (url.hostname.includes('googletagmanager') || url.hostname.includes('google-analytics')) {
          googleRequests.push(url.pathname); await req.respond({ status: 200, contentType: 'application/javascript', body: '// Isolated Google tag fixture' }); return;
        }
        if (req.method() === 'OPTIONS') { await req.respond({ status: 204, headers }); return; }
        if (url.hostname === 'privacy-fixture.supabase.invalid') {
          if (url.pathname.includes('/storage/')) { uploaded = true; await raw({ Key: `imports/guests/${guestId}/source.pdf` }); return; }
          if (url.pathname.endsWith('/authorize')) {
            assert.equal(url.searchParams.get('provider'), 'google');
            await req.respond({ status: 302, headers: { location: `${base}/auth/callback#access_token=${jwt}&refresh_token=fixture-refresh&token_type=bearer&expires_in=3600&type=signup` } }); return;
          }
          if (url.pathname.endsWith('/user')) { await raw(user); return; }
          if (url.pathname.endsWith('/signup') || url.pathname.endsWith('/token')) { await raw(session); return; }
          if (url.pathname.endsWith('/logout')) { await raw({}); return; }
          unexpected.push('unhandled fixture authentication route'); await req.abort(); return;
        }
        if (url.origin !== base) { unexpected.push('unexpected external request'); await req.abort(); return; }
        if (!url.pathname.startsWith('/api/v1/')) { await req.continue(); return; }
        const path = url.pathname.slice('/api/v1'.length);
        const body = req.postData() ? JSON.parse(req.postData()) : {};
        // Record controlled API paths/body only. Never print credentials or URLs.
        requests.push({ path, method: req.method(), body });
        const status = () => ({ answers, original_filename: 'private-person-cv.pdf', ...preferences, status: parsed ? 'parsed' : 'uploaded', retry_available: true, can_resume: true, error_message: null });
        if (path === '/privacy/config') { await respond(config); return; }
        if (path === '/me') { assert(claimed || req.headers().authorization); await respond(me); return; }
        if (path === '/me/privacy') { if (req.method() === 'PATCH') Object.assign(preferences, body); await respond(preferences); return; }
        if (path === '/me/settings') { await respond({ settings: { default_cv_language: 'en', locale: 'en', onboarding_completed: false, onboarding_state: {} } }); return; }
        if (path === '/me/onboarding-answers') { appUser.onboarding_answers = body; await respond({ answers: body }); return; }
        if (path === '/guest-imports') { assert.equal(body.ai_processing, true); assert.equal(body.analytics, false); Object.assign(preferences, body); await respond({ id: guestId, guest_token: 't'.repeat(43), expires_at: new Date(Date.now()+86400000).toISOString(), upload: { storage_bucket: 'imports', storage_path: `guests/${guestId}/source.pdf`, token: 'fixture-upload' } }); return; }
        if (path.startsWith(`/guest-imports/${guestId}`)) {
          assert.equal(req.headers()['x-guest-token'], 't'.repeat(43));
          if (path.endsWith('/answers')) { answers = body; await respond({ saved: true }); return; }
          if (path.endsWith('/privacy')) { Object.assign(preferences, body); await respond(status()); return; }
          if (path.endsWith('/process')) { assert(uploaded); await new Promise(resolve => setTimeout(resolve, 1200)); parsed = true; await respond(status()); return; }
          if (path.endsWith('/claim')) { assert(req.headers().authorization); assert(parsed); claimed = true; appUser.onboarding_answers = answers; await respond({ import_id: importId, original_filename: 'private-person-cv.pdf', answers }); return; }
          if (req.method() === 'DELETE') { await respond({ status: 'deletion_requested' }); return; }
          await respond(status()); return;
        }
        if (path === `/imports/${importId}/result`) { await respond({ status: 'parsed', module_type: 'standard', parsed_content: content, review }); return; }
        if (path === `/imports/${importId}`) { await respond({ import: { id: importId }, target_master_cv: null }); return; }
        if (path === `/imports/${importId}/create-master-cv`) { await respond({ master_cv: master }); return; }
        if (path === `/master-cvs/${cvId}`) { await respond(master); return; }
        if (path === `/tailored-cvs/${cvId}`) { await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'This fixture CV is a master CV.' } }) }); return; }
        if (path.endsWith('/ai/block-versions')) { await respond({ blocks: [] }); return; }
        if (path === '/templates') { await respond({ templates: [] }); return; }
        if (path === '/rendering/preview') { await respond({ presentation: null }); return; }
        if (path === '/billing/usage') { await respond(me.usage_summary); return; }
        if (path === '/billing/plan') { await respond({ ...me.current_plan, entitlements: me.entitlements }); return; }
        if (path === '/me/privacy/deletion') { assert.equal(body.confirmation, 'DELETE'); await respond({ status: 'deletion_requested' }); return; }
        unexpected.push(`unhandled API fixture: ${req.method()} ${path}`); await req.respond({ status: 404, headers, body: JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Unconfigured isolated fixture' } }) });
      } catch (error) { unexpected.push(error.message); if (!req.isInterceptResolutionHandled()) await req.abort(); }
    });
  };
  const page = await context.newPage(); await attach(page);
  await page.goto(`${base}/guided-journey`, { waitUntil: 'networkidle0' });
  assert.equal(googleRequests.length, 0);
  await clickText(page, 'Reject analytics');
  await page.goto(`${base}/onboarding`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type=checkbox]:not([disabled])');
  assert.equal(await page.$eval('input[type=checkbox]', el => el.checked), false);
  assert.equal(await page.$eval('#onboarding-cv-file', el => el.disabled), true);
  await clickText(page, 'Not now'); await waitText(page, 'AI remains off.');
  assert(!uploaded);
  await page.click('input[type=checkbox]');
  await page.waitForSelector('#onboarding-cv-file:not([disabled])');
  await (await page.$('#onboarding-cv-file')).uploadFile(cvPath);
  await waitText(page, 'Question 1 of 4');
  assert(!parsed, 'questions must begin before parsing finishes');
  await page.click('.ob-option input'); await clickText(page, 'Continue');
  await waitText(page, 'Question 2 of 4');
  const firstAnswers = { ...answers };
  await page.reload({ waitUntil: 'networkidle0' }); await waitText(page, 'Question 2 of 4');
  assert.deepEqual(answers, firstAnswers, 'refresh must not overwrite server answers with an empty local record');
  await page.click('input[aria-label="AI processing for this upload"]');
  await waitText(page, 'Enable AI to continue'); assert.equal(preferences.ai_processing, false);
  await page.click('input[aria-label="AI processing for this upload"]');
  await waitText(page, 'Question 2 of 4'); assert.equal(preferences.ai_processing, true);
  const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem('cv-builder:guest-import')));
  assert.deepEqual(Object.keys(recovery).sort(), ['expires_at','guest_token','id','question','step']);
  for (let index = 2; index <= 4; index++) { await waitText(page, `Question ${index} of 4`); await clickText(page, 'Skip'); }
  await waitText(page, 'Save your CV');
  assert.equal(googleRequests.length, 0);
  if (method === 'google') await clickText(page, 'Continue with Google');
  else {
    await page.type('#onboarding-name', 'Test Candidate'); await page.type('#onboarding-email', user.email); await page.type('#onboarding-password', 'fixture-password');
    await clickText(page, 'Create account & see my score');
  }
  await waitText(page, 'Your CV Score');
  assert(claimed); assert.equal(preferences.ai_processing, true); assert.equal(preferences.analytics, false);
  assert.equal(await page.evaluate(() => localStorage.getItem('cv-builder:guest-import')), null);
  await clickText(page, 'Continue to CV editor');
  await page.waitForFunction(id => location.pathname === `/app/cv/${id}`, {}, cvId);
  await waitText(page, 'Imported CV');
  assert.equal(googleRequests.length, 0);
  await page.goto(`${base}/app/profile`, { waitUntil: 'networkidle0' });
  await waitText(page, 'Privacy & your data');
  await clickText(page, 'Clear onboarding answers'); await waitText(page, 'Your onboarding answers have been cleared.');
  assert.deepEqual(appUser.onboarding_answers, {});
  await page.click('.privacy-panel input[type=checkbox]');
  await waitText(page, 'AI-dependent features are paused');
  await page.goto(`${base}/app/cv/${cvId}`, { waitUntil: 'networkidle0' });
  await waitText(page, 'Enable AI to continue');
  assert.equal(preferences.ai_processing, false);
  await clickText(page, 'Enable AI & continue');
  await waitText(page, 'Imported CV'); assert.equal(preferences.ai_processing, true);
  await page.goto(`${base}/app/profile`, { waitUntil: 'networkidle0' });
  await waitText(page, 'Privacy & your data');
  // Consent acceptance and withdrawal across two tabs, without transmitting GA.
  await clickText(page, 'Privacy choices'); await clickText(page, 'Accept analytics');
  await page.waitForFunction(() => !!document.getElementById('ga4-google-tag'));
  assert(googleRequests.length > 0);
  const tab = await context.newPage(); await attach(tab); await tab.goto(`${base}/cookies`, { waitUntil: 'networkidle0' });
  await tab.waitForFunction(() => !!document.getElementById('ga4-google-tag'));
  await clickText(page, 'Privacy choices'); await clickText(page, 'Reject analytics');
  await page.waitForFunction(() => !document.getElementById('ga4-google-tag'));
  await tab.waitForFunction(() => !document.getElementById('ga4-google-tag'));
  const afterWithdrawal = googleRequests.length;
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(googleRequests.length, afterWithdrawal);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('analytics:')).length), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.bringToFront();
  await clickText(page, 'Delete account');
  await page.type('#privacy-delete-confirmation', 'DELETE');
  if (method === 'email') await page.type('#privacy-reauth-password', 'fixture-password');
  await clickText(page, 'Confirm account deletion');
  try { await page.waitForFunction(() => location.pathname === '/guided-journey'); } catch { throw new Error(JSON.stringify({ path: new URL(page.url()).pathname, text: await page.evaluate(() => document.body.innerText), unexpected, requestPaths: requests.slice(-8).map(r=>r.path) })); }
  try { await waitText(page, 'Your account deletion has been requested.'); } catch { throw new Error(JSON.stringify({ publicUrl: page.url(), errors, text: await page.evaluate(() => document.body.innerText.slice(0,800)), unexpected })); }
  assert.equal(requests.filter(req => req.path === '/me/privacy/deletion').length, 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.deepEqual(unexpected, []);
  await page.screenshot({ path: join(dir, `${method}-deletion-confirmation.png`) });
  await context.close();
  return `${method}: upload → optional questions during processing → signup → score → editor; AI rejection/re-enable before upload, guest and account AI withdrawal/resumption, minimal browser recovery, clear answers, cross-tab analytics withdrawal and deletion confirmation passed`;
}
async function gpcScenario() {
  const context = await browser.createBrowserContext(); const page = await context.newPage();
  let google = 0; const errors = [];
  await page.evaluateOnNewDocument(version => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
    localStorage.setItem('cv-builder:privacy-choices', JSON.stringify({ version, analytics: true, expires_at: new Date(Date.now()+86400000).toISOString() }));
  }, version);
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const url = new URL(req.url());
    if (url.hostname.includes('google-analytics') || url.hostname.includes('googletagmanager')) { google++; await req.abort(); return; }
    if (url.pathname === '/api/v1/privacy/config') { await req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: config }) }); return; }
    if (url.origin !== base) { await req.abort(); return; }
    await req.continue();
  });
  await page.goto(`${base}/cookies`, { waitUntil: 'networkidle0' });
  await clickText(page, 'Privacy choices'); await waitText(page, 'Global Privacy Control is enabled.');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].find(el=>el.textContent === 'Accept analytics').disabled), true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cv-builder:privacy-choices')).analytics), false);
  assert.equal(google, 0); assert.deepEqual(errors, []);
  await context.close(); return 'Global Privacy Control overrides a previously accepted choice; Google remains unloaded';
}
try {
  console.log(await scenario('email'));
  console.log(await scenario('google'));
  console.log(await gpcScenario());
} finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
