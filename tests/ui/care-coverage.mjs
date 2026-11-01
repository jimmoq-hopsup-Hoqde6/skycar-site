// Synthetic intercepted /api/v1/care/coverage answers: not a real service-area list or hosted verification.
// Postcodes below are arbitrary 4-digit fixtures; the UI must treat the SERVER answer as the only authority.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { coverageRoute } from './support/coverage-fixture.mjs';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium ?? playwright.default?.chromium;
const PLAIN = { port: 3204, env: {} };
const CONTACT = { port: 3205, env: { SKYCAR_SUPPORT_EMAIL: 'support@example.test', SKYCAR_SUPPORT_PHONE: '+61 8 5550 0100' } };
const servers = [];
let browser;

async function start({ port, env }) {
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], { stdio: 'ignore', env: { ...process.env, SKYCAR_SUPPORT_EMAIL: '', SKYCAR_SUPPORT_PHONE: '', ...env } });
  servers.push(child);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('fixture server exited early');
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); await response.text(); if (response.ok) return origin; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`fixture server on ${port} was not ready`);
}

// Every visible text node under `selector` is >= 14px, every control is >= 44px tall, nothing overflows sideways.
async function assertAccessible(page, selector, label) {
  const result = await page.locator(selector).evaluate(root => {
    const small = [], short = [];
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const own = [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      if (own && parseFloat(getComputedStyle(el).fontSize) < 14) small.push(el.tagName + ':' + el.textContent.slice(0, 30));
      if (el.matches('a,button')) { const box = el.getBoundingClientRect(); if (box.height < 44) short.push(el.textContent.slice(0, 30) + ' ' + box.height); }
    }
    return { small, short, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.deepEqual(result, { small: [], short: [], overflow: false }, label);
}

async function fillLocation(page, origin, postcode) {
  await page.goto(`${origin}/care/request`);
  await page.getByLabel('Your car', { exact: true }).fill('Toyota Corolla 2020');
  await page.getByLabel('What would you like done?', { exact: true }).fill('Synthetic scratch repair test.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Suburb', { exact: true }).fill('Testville');
  await page.getByLabel('Postcode', { exact: true }).fill(postcode);
}

async function newGuest(width, answer, origin = null) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const coverage = coverageRoute(answer);
  await page.route(coverage.pattern, coverage.handler);
  const guestCalls = [];
  await page.route('**/api/v1/care/guest-requests', route => { guestCalls.push(route.request().postData()); return route.fulfill({ status: 201, json: { data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stage: 'request_received', created_at: new Date().toISOString() } } }); });
  return { page, coverage, guestCalls, errors };
}

const nameField = page => page.getByLabel('Name', { exact: true });

try {
  const plain = await start(PLAIN);
  const withContact = await start(CONTACT);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  // 1. Out of area: blocked, clear message, no contact line when none is configured, accessible at three widths.
  for (const width of [320, 390, 1440]) {
    const { page, coverage, guestCalls, errors } = await newGuest(width, () => 'unavailable');
    await fillLocation(page, plain, '5999');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const box = page.locator('.coverage-notice');
    await box.waitFor();
    assert.equal(await box.getAttribute('data-coverage'), 'out_of_area');
    assert.equal(await box.getAttribute('data-contact'), 'unconfigured');
    await page.getByRole('heading', { name: 'We don’t cover 5999 yet' }).waitFor();
    assert.equal(await page.getByText('Contact Skycar').count(), 0, 'no contact is invented when none is configured');
    assert.equal(await nameField(page).isVisible(), false, 'out of area cannot reach the details step');
    assert.equal(await page.getByRole('button', { name: /Continue —/ }).count(), 0, 'out of area offers no bypass');
    assert.deepEqual(coverage.calls, [{ service: 'repair', postcode: '5999' }]);
    assert.equal(guestCalls.length, 0);
    await assertAccessible(page, '.coverage-notice', `out of area ${width}px`);
    await page.getByRole('button', { name: 'Change postcode' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'postcode');
    await page.getByLabel('Postcode', { exact: true }).fill('5998');
    assert.equal(await box.count(), 0, 'editing the postcode clears the notice');
    assert.deepEqual(errors, []);
    await page.close();
  }

  // 2. Contact fallback appears only from config, with real links.
  {
    const { page } = await newGuest(390, () => 'unavailable');
    await fillLocation(page, withContact, '5999');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const box = page.locator('.coverage-notice');
    await box.waitFor();
    assert.equal(await box.getAttribute('data-contact'), 'configured');
    assert.equal(await box.getByRole('link', { name: '+61 8 5550 0100' }).getAttribute('href'), 'tel:+61855500100');
    assert.equal(await box.getByRole('link', { name: 'support@example.test' }).getAttribute('href'), 'mailto:support@example.test');
    await assertAccessible(page, '.coverage-notice', 'contact links');
    await page.close();
  }

  // 3. Unavailable (503), network failure and malformed answers are "unknown": retry works, and nothing is called in-area.
  for (const [name, answer] of [['503', 'down'], ['network', 'abort'], ['mismatched echo', { status: 200, json: { data: { service: 'repair', postcode: '1111', coverage: 'available' } } }], ['unrecognised value', { status: 200, json: { data: { service: 'repair', postcode: '5000', coverage: 'maybe' } } }]]) {
    let mode = answer;
    const { page, coverage, guestCalls, errors } = await newGuest(390, () => mode);
    await fillLocation(page, plain, '5000');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const box = page.locator('.coverage-notice');
    await box.waitFor();
    assert.equal(await box.getAttribute('data-coverage'), 'unknown', name);
    await page.getByRole('heading', { name: 'We can’t check your area right now' }).waitFor();
    assert.equal(await nameField(page).isVisible(), false, `${name}: no silent advance`);
    assert.equal(await page.getByRole('button', { name: /Continue —/ }).count(), 0, `${name}: unavailable has no bypass`);
    assert.equal(await page.getByText('Skycar is starting in Adelaide').count(), 0, `${name}: unavailable is not worded as out of area`);
    await assertAccessible(page, '.coverage-notice', `unknown ${name}`);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => document.querySelector('.coverage-notice button')?.textContent === 'Try again');
    assert.equal(coverage.calls.length, 2, `${name}: retry asks the server again`);
    assert.equal(await nameField(page).isVisible(), false);
    mode = 'available';
    await page.getByRole('button', { name: 'Try again' }).click();
    await nameField(page).waitFor();
    assert.equal(await box.count(), 0);
    assert.equal(guestCalls.length, 0, 'checking never submits the request');
    assert.deepEqual(errors, []);
    await page.close();
  }

  // 4. Real route and real data (no interception): in area, out of area and borderline postcodes.
  for (const [postcode, expected] of [['5000', 'in'], ['5251', 'in'], ['5153', 'in'], ['5157', 'in'], ['5235', 'out'], ['5254', 'out'], ['5700', 'out'], ['3000', 'out']]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(10000);
    await fillLocation(page, plain, postcode);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    if (expected === 'in') {
      await nameField(page).waitFor();
      assert.equal(await page.locator('.coverage-notice').count(), 0, postcode);
    } else {
      await page.getByRole('heading', { name: `We don’t cover ${postcode} yet` }).waitFor();
      assert.equal(await nameField(page).isVisible(), false, postcode);
    }
    await page.close();
  }

  // 5. In area: advances, shows an honest confirmation without promising a quote or appointment.
  {
    const { page, coverage } = await newGuest(390, () => 'available');
    await fillLocation(page, plain, '5000');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await nameField(page).waitFor();
    assert.equal(await page.locator('.coverage-notice').count(), 0);
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.com');
    await page.getByLabel('Phone', { exact: true }).fill('0400 000 000');
    await page.getByRole('checkbox').check();
    await page.getByText('Skycar covers 5000.', { exact: false }).waitFor();
    assert.deepEqual(coverage.calls, [{ service: 'repair', postcode: '5000' }]);
    await page.close();
  }

  // 6. Invalid input: shape rejected in the browser (no call), and a server 400 shows the same field message.
  {
    const { page, coverage } = await newGuest(390, () => ({ status: 400, json: { error: { code: 'VALIDATION_FAILED', message: 'x', fieldErrors: { postcode: 'invalid' }, retryable: false } } }));
    await fillLocation(page, plain, '50');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('Enter your 4-digit postcode, for example 5000.').waitFor();
    assert.equal(coverage.calls.length, 0);
    assert.equal(await page.getByLabel('Postcode', { exact: true }).getAttribute('aria-invalid'), 'true');
    await assertAccessible(page, '.coverage-field-error', 'invalid postcode');
    await page.getByLabel('Postcode', { exact: true }).fill('5000');
    assert.equal(await page.getByText('Enter your 4-digit postcode, for example 5000.').count(), 0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('Enter your 4-digit postcode, for example 5000.').waitFor();
    assert.equal(coverage.calls.length, 1, 'a server 400 is surfaced as invalid input');
    await page.close();
  }

  // 7. Signed-in form: same states, and a blocked check never creates a request.
  const vehicle = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', make: 'Toyota', model: 'Corolla', variant: null, year: 2020, registration: 'SKY123', registration_state: 'SA', revision: 1, archived_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' };
  for (const width of [320, 1440]) {
    let mode = 'unavailable';
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(10000);
    const coverage = coverageRoute(() => mode);
    await page.route(coverage.pattern, coverage.handler);
    await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
    await page.route('**/api/v1/garage/vehicles/*/photo', route => route.fulfill({ status: 204, headers: { 'X-Skycar-Account': vehicle.id } }));
    const creates = [];
    await page.route('**/api/v1/care/requests', route => { creates.push(route.request().postData()); return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Nothing was saved.', retryable: true } } }); });
    await page.goto(`${plain}/care/request/garage`);
    await page.getByLabel('Active Garage vehicle').selectOption(vehicle.id);
    await page.getByLabel('Describe the damage or cleaning work').fill('Synthetic scratch repair test.');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page.getByText('Enter your 4-digit postcode, for example 5000.').waitFor();
    assert.equal(coverage.calls.length, 0);
    await page.getByLabel('Where will the work happen? Postcode').fill('5999');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    const box = page.locator('.coverage-notice');
    await box.waitFor();
    assert.equal(await box.getAttribute('data-coverage'), 'out_of_area');
    assert.equal(await page.getByText('Contact Skycar').count(), 0);
    assert.equal(creates.length, 0, 'out of area creates nothing');
    await assertAccessible(page, '.coverage-notice', `signed-in out of area ${width}px`);
    mode = 'down';
    await page.getByLabel('Where will the work happen? Postcode').fill('5000');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page.waitForFunction(() => document.querySelector('.coverage-notice')?.getAttribute('data-coverage') === 'unknown');
    assert.equal(creates.length, 0, 'unknown never creates a request');
    await assertAccessible(page, '.coverage-notice', `signed-in unknown ${width}px`);
    assert.equal(await page.getByRole('button', { name: /Continue —/ }).count(), 0, 'unavailable has no bypass');
    mode = 'available';
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('alert').filter({ hasText: 'Nothing was saved.' }).waitFor();
    assert.equal(creates.length, 1);
    assert.equal(coverage.calls.length, 3);
    assert.equal(JSON.parse(creates[0]).postcode, undefined, 'the postcode is used for the check only and is not sent with the request');
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.setDefaultTimeout(10000);
    const coverage = coverageRoute(() => 'available');
    await page.route(coverage.pattern, coverage.handler);
    await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill({ json: { data: { items: [vehicle], nextCursor: null } } }));
    await page.route('**/api/v1/garage/vehicles/*/photo', route => route.fulfill({ status: 204, headers: { 'X-Skycar-Account': vehicle.id } }));
    const creates = [];
    await page.route('**/api/v1/care/requests', route => { creates.push(route.request().postData()); return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Nothing was saved.', retryable: true } } }); });
    await page.goto(`${plain}/care/request/garage`);
    await page.getByLabel('Active Garage vehicle').selectOption(vehicle.id);
    await page.getByLabel('Describe the damage or cleaning work').fill('Synthetic scratch repair test.');
    await page.getByLabel('Where will the work happen? Postcode').fill('5000');
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page.getByRole('alert').filter({ hasText: 'Nothing was saved.' }).waitFor();
    assert.equal(creates.length, 1);
    assert.deepEqual(coverage.calls, [{ service: 'repair', postcode: '5000' }]);
    await page.close();
  }
  console.log('PASS: coverage out-of-area, unavailable, invalid-input and in-area UX in guest and signed-in forms');
} finally {
  await browser?.close();
  for (const child of servers) child.kill('SIGTERM');
}
