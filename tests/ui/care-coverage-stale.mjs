// Stale coverage answers and the signed-in postcode hand-off. Synthetic intercepted /api/v1 responses only:
// not a real service-area list, not hosted verification. Ported from QA's stale.mjs for PR #82 (N5/N6 plus the
// guest late-"available" case) and extended with the postcode hand-off to the journey page.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { coverageRoute } from './support/coverage-fixture.mjs';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium ?? playwright.default?.chromium;
const freePort = () => new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], { stdio: 'ignore', env: { ...process.env, SKYCAR_SUPPORT_EMAIL: '', SKYCAR_SUPPORT_PHONE: '' } });
let browser;

const NOTICE = page => page.locator('.coverage-notice');
const notices = page => NOTICE(page).count();
const cont = page => page.getByRole('button', { name: 'Continue', exact: true });
const back = page => page.getByRole('button', { name: 'Back', exact: true });
const heading = async page => (await page.locator('h2').first().textContent()).trim();
const vehicle = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', make: 'Toyota', model: 'Corolla', variant: null, year: 2020, registration: 'SKY123', registration_state: 'SA', revision: 1, archived_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' };
const answerFor = kind => (body) => kind === 'unknown' ? 'down' : 'unavailable';

async function guest(decide) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10000);
  const state = { posts: 0, errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  const coverage = coverageRoute(decide);
  await page.route(coverage.pattern, coverage.handler);
  await page.route('**/api/v1/care/guest-requests', route => { state.posts++; return route.fulfill({ status: 201, json: { data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stage: 'request_received', created_at: new Date().toISOString() } } }); });
  await page.goto(`${origin}/care/request`);
  await page.getByLabel('Your car', { exact: true }).fill('Toyota Corolla 2020');
  await page.getByLabel('What would you like done?', { exact: true }).fill('Synthetic scratch repair test.');
  await cont(page).click();
  await page.getByLabel('Suburb', { exact: true }).fill('Testville');
  await page.getByLabel('Postcode', { exact: true }).fill('5999');
  return { page, coverage, state };
}

async function signedIn(decide) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10000);
  const state = { creates: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  const coverage = coverageRoute(decide);
  await page.route(coverage.pattern, coverage.handler);
  await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
  await page.route('**/api/v1/garage/vehicles/*/photo', route => route.fulfill({ status: 204, headers: { 'X-Skycar-Account': vehicle.id } }));
  await page.route('**/api/v1/care/requests', route => { state.creates.push(route.request().postData()); return route.fulfill({ status: 422, json: { error: { code: 'VALIDATION_FAILED', message: 'Nothing was saved.', retryable: false } } }); });
  await page.goto(`${origin}/care/request/garage`);
  await page.getByLabel('Active Garage vehicle').selectOption(vehicle.id);
  await page.getByLabel('Describe the damage or cleaning work').fill('Synthetic scratch repair test.');
  return { page, coverage, state };
}
const postcodeField = page => page.getByLabel('Where will the work happen? Postcode');
const submitButton = page => page.getByRole('button', { name: 'Submit for review' });

try {
  for (let i = 0; i < 300; i++) {
    if (server.exitCode !== null) throw new Error('fixture server exited early');
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); await response.text(); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // 1. Guest: a service change after a notice clears it at once, forces a fresh check for the new service, and a postcode edit clears it.
  for (const kind of ['out_of_area', 'unknown']) {
    const { page, coverage, state } = await guest(answerFor(kind));
    await cont(page).click();
    await NOTICE(page).waitFor();
    assert.equal(await NOTICE(page).getAttribute('data-coverage'), kind === 'unknown' ? 'unknown' : 'out_of_area');
    await back(page).click();
    await page.getByRole('radio', { name: /Cleaning/ }).check();
    assert.equal(await notices(page), 0, `guest ${kind}: changing the service removes the old notice`);
    await cont(page).click();
    assert.equal(await notices(page), 0, `guest ${kind}: no notice on returning to the Location step`);
    await page.getByLabel('Postcode', { exact: true }).fill('5999');
    await cont(page).click();
    await NOTICE(page).waitFor();
    assert.deepEqual(coverage.calls, [{ service: 'repair', postcode: '5999' }, { service: 'cleaning', postcode: '5999' }], `guest ${kind}: cleaning is checked on its own`);
    await page.getByLabel('Postcode', { exact: true }).press('End');
    await page.keyboard.press('Backspace');
    assert.equal(await notices(page), 0, `guest ${kind}: editing the postcode removes the notice`);
    assert.equal(state.posts, 0);
    assert.deepEqual(state.errors, []);
    await page.close();
  }

  // 2. Guest in flight: the answer for the OLD service arrives after the customer switched service.
  for (const late of ['out_of_area', 'unknown', 'available']) {
    let release; const gate = new Promise(resolve => (release = resolve));
    const { page, coverage, state } = await guest(async (body, call) => {
      if (call === 1) { await gate; return late === 'unknown' ? 'down' : late === 'available' ? 'available' : 'unavailable'; }
      return 'unavailable';
    });
    await cont(page).click();
    await page.getByRole('button', { name: 'Checking your area…' }).waitFor();
    await back(page).click();
    await page.getByRole('radio', { name: /Cleaning/ }).check();
    release();
    await page.waitForFunction(() => !document.querySelector('button[type=submit]')?.textContent?.includes('Checking'));
    await page.waitForTimeout(300);
    assert.equal(await notices(page), 0, `guest in flight (${late}): a stale notice never shows`);
    assert.equal(await heading(page), 'What needs attention?', `guest in flight (${late}): the form does not advance while Cleaning is selected`);
    assert.equal(await page.getByLabel('Name', { exact: true }).isVisible(), false, `guest in flight (${late}): contact step not reached`);
    assert.equal(state.posts, 0);
    // The old answer was ignored, so Cleaning still gets its own check and, being unavailable, is blocked.
    await cont(page).click();
    await page.getByLabel('Postcode', { exact: true }).fill('5999');
    await cont(page).click();
    await NOTICE(page).waitFor();
    assert.equal(await NOTICE(page).getAttribute('data-coverage'), 'out_of_area');
    assert.deepEqual(coverage.calls.map(call => call.service), ['repair', 'cleaning'], `guest in flight (${late}): Cleaning was checked after the stale answer`);
    assert.equal(state.posts, 0);
    assert.deepEqual(state.errors, []);
    await page.close();
  }

  // 3. Guest: a late "available" for the CURRENT service and postcode still advances (the guard is not over-eager).
  {
    let release; const gate = new Promise(resolve => (release = resolve));
    const { page } = await guest(async () => { await gate; return 'available'; });
    await cont(page).click();
    await page.getByRole('button', { name: 'Checking your area…' }).waitFor();
    release();
    await page.getByLabel('Name', { exact: true }).waitFor();
    await page.close();
  }

  // 4. Signed-in (N5/N6): changing the service or editing the postcode removes the old notice; a fresh check follows.
  for (const kind of ['out_of_area', 'unknown']) {
    const { page, coverage, state } = await signedIn(answerFor(kind));
    await postcodeField(page).fill('5999');
    await submitButton(page).click();
    await NOTICE(page).waitFor();
    await page.getByRole('radio', { name: /Detail or clean/ }).check();
    assert.equal(await notices(page), 0, `signed-in ${kind}: changing the service removes the old notice (N5)`);
    await submitButton(page).click();
    await NOTICE(page).waitFor();
    assert.deepEqual(coverage.calls, [{ service: 'repair', postcode: '5999' }, { service: 'cleaning', postcode: '5999' }], `signed-in ${kind}: cleaning is checked on its own`);
    await postcodeField(page).press('End');
    await page.keyboard.press('Backspace');
    assert.equal(await notices(page), 0, `signed-in ${kind}: editing the postcode removes the notice (N6)`);
    assert.equal(state.creates.length, 0, `signed-in ${kind}: nothing is created`);
    assert.deepEqual(state.errors, []);
    await page.close();
  }

  // 5. Signed-in in flight: the form is locked during a check, so a late answer is applied once and nothing goes stale.
  for (const late of ['unavailable', 'available', '503']) {
    let release; const gate = new Promise(resolve => (release = resolve));
    const { page, state } = await signedIn(async (body, call) => { if (call === 1) { await gate; return late === '503' ? 'down' : late; } return 'unavailable'; });
    await postcodeField(page).fill('5999');
    await submitButton(page).click();
    await page.getByRole('button', { name: 'Checking your area…' }).waitFor();
    assert.equal(await postcodeField(page).isDisabled(), true, `signed-in in flight (${late}): postcode locked`);
    assert.equal(await page.getByRole('radio', { name: /Detail or clean/ }).isDisabled(), true, `signed-in in flight (${late}): service locked`);
    release();
    if (late === 'available') await page.waitForFunction(() => document.body.innerText.includes('Nothing was saved.'));
    else await NOTICE(page).waitFor();
    assert.equal(state.creates.length, late === 'available' ? 1 : 0, `signed-in in flight (${late})`);
    await page.close();
  }

  // 6. Signed-in postcode hand-off: the postcode used for the area check is offered, not asked for again, on the journey page.
  {
    const id = '11111111-1111-4111-8111-111111111111';
    const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const now = new Date().toISOString();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const coverage = coverageRoute(); await page.route(coverage.pattern, coverage.handler);
    await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
    await page.route('**/api/v1/garage/vehicles/*/photo', route => route.fulfill({ status: 204, headers: { 'X-Skycar-Account': vehicle.id } }));
    let details = { name: 'Synthetic Customer', phone: '0400000000' };
    let created = 0; const updates = [];
    const receipt = body => ({ ...body, id, quote_state: 'in_review', assignment_state: 'none', fulfilment_state: null, money_state: null, customer_stage: 'request_received', next_action: 'review_request', responsible_role: 'operations', created_at: now, updated_at: now, next_update_at: new Date(Date.now() + 3600000).toISOString(), events: [{ id: '22222222-2222-4222-8222-222222222222', sequence: 1, type: 'request_received', occurred_at: now }] });
    let lastBody;
    await page.route(/\/api\/v1\/care\/requests(?:[/?].*)?$/, route => {
      if (route.request().method() === 'POST') { created++; lastBody = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { data: { request: receipt(lastBody), replayed: false } } }); }
      return route.fulfill({ json: { data: receipt(lastBody) } });
    });
    const snapshot = () => ({ id, kind: 'account', state: 'review', revision: 1, request: { vehicle: '2020 Toyota Corolla · SKY123', service: 'repair', description: 'Synthetic scratch repair test.', created_at: now }, details, quotes: [], selected_quote_id: null, appointment: null, events: [], photos: [], completion_photos: [], completion_review: { state: null } });
    await page.route(/\/api\/v1\/care\/journey\/[^/]+$/, route => {
      if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); updates.push(body); if (body.action === 'update_details') details = body.payload; return route.fulfill({ json: { data: { id, state: 'review', replayed: false } }, headers: { 'X-Skycar-Account': account } }); }
      return route.fulfill({ json: { data: snapshot() }, headers: { 'X-Skycar-Account': account } });
    });
    await page.goto(`${origin}/care/request/garage`);
    await page.getByLabel('Active Garage vehicle').selectOption(vehicle.id);
    await page.getByLabel('Describe the damage or cleaning work').fill('Synthetic scratch repair test.');
    await postcodeField(page).fill('5000');
    await submitButton(page).click();
    await page.waitForURL(`**/care/requests/${id}`);
    assert.equal(created, 1);
    assert.equal(lastBody.postcode, '5000', 'the create request carries the checked postcode');
    await page.goto(`${origin}/care/journey/${id}`);
    const field = page.getByLabel('Postcode', { exact: true });
    await field.waitFor();
    assert.equal(await field.inputValue(), '5000', 'the checked postcode is offered on the journey details form');
    await page.getByTestId('postcode-prefill').waitFor();
    assert.equal(updates.length, 0, 'nothing is saved until the customer submits the form');
    await page.getByLabel('Suburb', { exact: true }).fill('Adelaide');
    await page.getByRole('button', { name: 'Save service details' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=postcode-prefill]'));
    assert.deepEqual(updates.map(update => [update.action, update.payload.postcode]), [['update_details', '5000']], 'the existing update_details action saves it');
    assert.equal(await page.evaluate(id => sessionStorage.getItem(`skycar:checked-postcode:${id}`), id), null, 'the hand-off value is dropped once saved');
    assert.equal(await field.inputValue(), '5000', 'the saved postcode comes from the server snapshot');
    // A different request, or a value already saved on the server, is never overridden by the hand-off.
    await page.evaluate(id => sessionStorage.setItem(`skycar:checked-postcode:${id}`, '5999'), id);
    await page.reload();
    await field.waitFor();
    assert.equal(await field.inputValue(), '5000', 'a server-held postcode wins over the hand-off value');
    assert.equal(await page.getByTestId('postcode-prefill').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: stale coverage answers (guest + signed-in) and signed-in postcode hand-off');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
