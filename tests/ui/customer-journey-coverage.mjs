// 20261115100000: the journey "Service details" form when update_details is refused by the service-area
// re-check. Error bodies come from the real journey boundary (src/server/care/journey/http.ts), served to the
// browser through a synthetic API route; not hosted auth proof.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { journeyBoundary, JourneyError } from '../../src/server/care/journey/http.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3193';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3193'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (server.exitCode !== null) throw new Error('Fixture server exited before readiness');
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); await response.text(); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Fixture server was not ready within 30 seconds');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const id = '22222222-2222-4222-8222-222222222222';
  const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const now = new Date().toISOString();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let details = { name: 'Synthetic Customer', phone: '0400000000', suburb: 'Adelaide', postcode: '5000' };
  let revision = 1;
  const posts = []; const answers = [];
  const snapshot = () => ({ id, kind: 'account', state: 'review', revision, request: { vehicle: '2020 Toyota Corolla · SKY123', service: 'repair', description: 'Synthetic scratch repair test.', created_at: now }, details, quotes: [], selected_quote_id: null, appointment: null, events: [], photos: [], completion_photos: [], completion_review: { state: null } });
  await page.route(/\/api\/v1\/care\/journey\/[^/]+$/, async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); posts.push({ key: request.headers()['idempotency-key'], postcode: body.payload?.postcode });
      const answer = answers.shift();
      if (answer) {
        const response = await journeyBoundary(async () => { throw new JourneyError(answer); });
        return route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text(), headers: { 'X-Skycar-Account': account } });
      }
      details = body.payload; revision++;
      return route.fulfill({ json: { data: { id, state: 'review', replayed: false } }, headers: { 'X-Skycar-Account': account } });
    }
    return route.fulfill({ json: { data: snapshot() }, headers: { 'X-Skycar-Account': account } });
  });
  const field = () => page.getByLabel('Postcode', { exact: true });
  const save = () => page.getByRole('button', { name: 'Save service details' }).click();
  const alert = () => page.locator('.care-entry-warning[role=alert]');
  const uncertain = () => page.getByText('The previous action has not been confirmed.');
  await page.goto(`${origin}/care/journey/${id}`);
  await field().waitFor();
  assert.equal(await field().inputValue(), '5000');

  // 1. Out of area (422): shown, nothing kept for a blind retry, the form stays usable.
  answers.push('OUT_OF_AREA');
  await field().fill('5290'); await save();
  await alert().filter({ hasText: 'does not cover that postcode' }).waitFor();
  assert.match(await alert().innerText(), /Your service details were not changed/);
  assert.equal(await uncertain().count(), 0, 'a coverage refusal is not an uncertain write');
  assert.equal(await field().isEnabled(), true);
  // 2. A covered postcode is a new command with a new key.
  await field().fill('5061'); await save();
  await page.waitForFunction(() => !document.querySelector('.care-entry-warning[role=alert]'));
  await page.waitForFunction(() => document.querySelector('input[name=postcode]')?.value === '5061');
  // 3. Coverage list unavailable (503): fail closed, not retryable, form usable, a later save uses a new key.
  answers.push('COVERAGE_UNAVAILABLE');
  await field().fill('5000'); await save();
  await alert().filter({ hasText: "can't check your service area" }).waitFor();
  assert.equal(await uncertain().count(), 0, 'COVERAGE_UNAVAILABLE is not retried with the same key');
  assert.equal(await field().isEnabled(), true);
  await save();
  await page.waitForFunction(() => !document.querySelector('.care-entry-warning[role=alert]'));
  assert.deepEqual(posts.map(post => post.postcode), ['5290', '5061', '5000', '5000']);
  assert.equal(new Set(posts.map(post => post.key)).size, 4, 'every refused attempt released its idempotency key');
  assert.equal(details.postcode, '5000');
  // 4. Control: an outage (503 UNAVAILABLE) is still an uncertain write that keeps its key.
  answers.push('UNAVAILABLE');
  await field().fill('5061'); await save();
  await uncertain().waitFor();
  assert.deepEqual(errors, []);
  await page.close();
  console.log('PASS: journey service details show OUT_OF_AREA and COVERAGE_UNAVAILABLE as final, non-retryable answers');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
