// Browser fixtures verify customer recovery; these are not proof of hosted saves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3192';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3192'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'test server must start');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const now = new Date().toISOString();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const receipt = { id, stage: 'request_received', created_at: now };
  const rejected = { error: { code: 'CONFIGURATION_UNAVAILABLE', message: 'Nothing was saved. Please try again later.', retryable: false } };
  let guestMode = 'rejected';
  const guestCalls = [];
  await page.route('**/api/v1/care/guest-requests', async route => {
    guestCalls.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (guestMode === 'lost') return route.abort('failed');
    return route.fulfill({ status: guestMode === 'success' ? 201 : 503, json: guestMode === 'success' ? { data: receipt } : rejected });
  });
  await page.goto(origin);
  await page.getByRole('link', { name: 'Request a service — no account needed' }).click();
  await page.waitForURL('**/care/request');
  assert.equal(new URL(page.url()).pathname, '/care/request');
  await page.getByLabel('Your car', { exact: true }).fill('Toyota Corolla 2020');
  await page.getByLabel('What would you like done?', { exact: true }).fill('Synthetic scratch repair test.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Suburb', { exact: true }).fill('Adelaide');
  await page.getByLabel('Postcode', { exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic Tester');
  await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
  await page.getByLabel('Phone', { exact: true }).fill('0400 000 000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send my request', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Nothing was saved.' }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).isEnabled(), true, 'definite first failure keeps details editable');
  await page.getByLabel('Name', { exact: true }).fill('Updated Tester');
  guestMode = 'lost';
  await page.getByRole('button', { name: 'Send my request', exact: true }).click();
  await page.getByRole('button', { name: 'Check same request' }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).isEnabled(), false);
  guestMode = 'rejected';
  await page.getByRole('button', { name: 'Check same request' }).click();
  await page.getByText('This retry could not confirm your earlier request.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).isEnabled(), false, 'a later rejection cannot resolve an earlier lost response');
  guestMode = 'success';
  await page.getByRole('button', { name: 'Check same request' }).click();
  await page.getByRole('heading', { name: 'Request received.', exact: true }).waitFor();
  assert.notEqual(guestCalls[0].key, guestCalls[1].key, 'editing after a definite failure starts a new request');
  assert.deepEqual(guestCalls.slice(1), [guestCalls[1], guestCalls[1], guestCalls[1]], 'uncertain retries retain key and payload');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS: guest entry, editable first rejection, lost-response retries and confirmed receipt on mobile');

  const png = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), Buffer.alloc(128)]);
  const vehicle = { id, make: 'Toyota', model: 'Corolla', year: 2020, archived_at: null };
  let photoMode = 'rejected';
  let identityFailure = true;
  const photoCalls = [];
  await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill(identityFailure
    ? { status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Unable to verify your account.', retryable: true } } }
    : { json: { meta: { accountId: id }, data: { items: [vehicle], nextCursor: null } } }));
  await page.route(`**/api/v1/garage/vehicles/${id}`, route => route.fulfill({ json: { data: vehicle } }));
  await page.route(`**/api/v1/garage/vehicles/${id}/photo`, route => {
    photoCalls.push(route.request().headers()['idempotency-key']);
    if (photoMode === 'lost') return route.abort('failed');
    return route.fulfill(photoMode === 'success'
      ? { status: 201, json: { data: { vehicle_id: id, original_status: 'stored', processing_state: 'stored' } } }
      : { status: 503, json: rejected });
  });
  await page.goto(`${origin}/garage/vehicles/${id}/photo`);
  await page.getByRole('button', { name: 'Reload vehicle' }).waitFor();
  identityFailure = false;
  await page.getByRole('button', { name: 'Reload vehicle' }).click();
  await page.route(`**/api/v1/garage/vehicles/${id}/photo`, async route => {
    if (route.request().method() === 'GET') return route.fulfill(photoMode === 'success' ? {status:200,contentType:'image/png',body:png,headers:{'X-Skycar-Account':id}} : {status: 204, headers: { 'X-Skycar-Account': id }});
    photoCalls.push(route.request().headers()['idempotency-key']);
    if (photoMode === 'lost') return route.abort('failed');
    return route.fulfill(photoMode === 'success' ? {status:201,json:{data:{vehicle_id:id,original_status:'stored',processing_state:'stored'}}} : {status:503,json:rejected});
  });
  await page.getByLabel('Vehicle photo', { exact: true }).waitFor();
  await page.getByLabel('Vehicle photo', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('img', {name:'Selected vehicle photo',exact:true}).waitFor();
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Nothing was saved.' }).waitFor();
  await page.getByRole('button', { name: 'Upload photo', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Vehicle photo', { exact: true }).isEnabled(), true);
  await page.getByText('Selected photo: fixture.png', { exact: true }).waitFor();
  photoMode = 'lost';
  await page.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same upload', exact: true }).waitFor();
  photoMode = 'rejected';
  await page.getByRole('button', { name: 'Retry same upload', exact: true }).click();
  await page.getByText('This retry could not confirm your earlier upload.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Vehicle photo', { exact: true }).isEnabled(), false);
  photoMode = 'success';
  await page.getByRole('button', { name: 'Retry same upload', exact: true }).click();
  await page.getByText('Photo saved privately to this vehicle.', { exact: false }).waitFor();
  assert.notEqual(photoCalls[0], photoCalls[1]);
  assert.deepEqual(photoCalls.slice(1), [photoCalls[1], photoCalls[1], photoCalls[1]]);
  await page.getByRole('img',{name:'Saved vehicle photo',exact:true}).waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="Saved vehicle photo"]')?.naturalWidth > 0);
  await mkdir('docs/qa/combined-build', {recursive:true});
  await page.screenshot({path:'docs/qa/combined-build/photo-mobile.png',fullPage:true});
  identityFailure = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'Reload vehicle'}).waitFor();
  assert.equal(await page.getByRole('img',{name:'Saved vehicle photo'}).count(),0,'private pixels are cleared on failed account verification');
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto(origin);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:`docs/qa/combined-build/home-${width}.png`,fullPage:true});
  }
  assert.deepEqual(pageErrors, []);
  console.log('PASS: vehicle reload, photo rejection, exact retries and private receipt with no page errors');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
