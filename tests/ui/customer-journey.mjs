// Connected UI integration with synthetic owner/API fixtures; not hosted auth proof.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3190';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3190'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const now = new Date().toISOString();
  const vehicle = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', make: 'Toyota', model: 'Corolla', variant: null, year: 2020, registration: 'SKY123', registration_state: 'SA', revision: 1, archived_at: null, created_at: now, updated_at: now };
  let receipt;
  let submissions = 0;
  page.on('pageerror', error => console.error('Synthetic journey page error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('Synthetic journey console:', message.text()); });
  await page.route('**/api/v1/garage/vehicles?*', route => route.fulfill({ json: { data: { items: new URL(route.request().url()).searchParams.get('archived') === 'true' ? [] : [vehicle], nextCursor: null } } }));
  await page.route('**/api/v1/care/requests**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    console.log('Synthetic API', request.method(), url.pathname);
    if (request.method() === 'POST') {
      submissions++;
      const input = request.postDataJSON();
      assert.equal(input.vehicle_id, vehicle.id);
      assert.ok(request.headers()['idempotency-key']);
      receipt = { ...input, id: '11111111-1111-4111-8111-111111111111', quote_state: 'in_review', assignment_state: 'none', fulfilment_state: null, money_state: null, customer_stage: 'request_received', next_action: 'review_request', responsible_role: 'operations', created_at: now, updated_at: now, next_update_at: new Date(Date.now() + 3600000).toISOString(), events: [{ id: '22222222-2222-4222-8222-222222222222', sequence: 1, type: 'request_received', occurred_at: now }] };
      return route.fulfill({ status: 201, json: { data: { request: receipt, replayed: false } } });
    }
    if (url.pathname === '/api/v1/care/requests') return route.fulfill({ json: { data: { items: receipt ? [{ ...receipt, vehicle_archived: false, is_overdue: false }] : [], next_cursor: null, evaluated_at: now } } });
    assert.ok(receipt, 'detail cannot exist before submission');
    return route.fulfill({ json: { data: receipt } });
  });
  await page.goto(`${origin}/garage`);
  await page.getByRole('link', { name: 'Book a service', exact: true }).click();
  await page.getByLabel('Active Garage vehicle').selectOption(vehicle.id);
  await page.getByLabel('Describe the damage or cleaning work').fill('Scratch on the left rear door');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.waitForURL(`**/care/requests/11111111-1111-4111-8111-111111111111`);
  try { await page.getByText('Scratch on the left rear door', { exact: true }).waitFor(); } catch (error) { console.error('Fixture receipt:', JSON.stringify(receipt)); console.error('Rendered receipt page:', await page.locator('body').innerText()); throw error; }
  await page.getByRole('link', { name: 'My Jobs', exact: true }).click();
  await page.getByRole('heading', { name: 'Toyota Corolla · SKY123' }).waitFor();
  await page.getByRole('link', { name: /View request and timeline/ }).click();
  await page.getByRole('heading', { name: 'Recorded updates' }).waitFor();
  assert.equal(submissions, 1, 'reopening a job must not resubmit it');
  receipt = { ...receipt, customer_stage: 'delayed', next_action: 'review_overdue_request', next_update_at: new Date(Date.now() - 1000).toISOString() };
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('heading', { name: 'Your update is overdue' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS: Garage → request → My Jobs → same request → overdue status; one submission');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
