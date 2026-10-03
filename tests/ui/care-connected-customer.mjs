// Mocked connected customer/operations story; not hosted authorization or persistence proof.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3196';
const id = '11111111-1111-4111-8111-111111111111';
const vehicleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const expertId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quoteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customerAccount = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const operationsAccount = 'operations-admin';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3196'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'server started');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const endsAt = new Date(Date.now() + 2 * 86400000 + 7200000).toISOString();
  const vehicle = { id: vehicleId, make: 'Toyota', model: 'Corolla', variant: 'Ascent Sport', year: 2020, registration: 'SKY123', registration_state: 'SA', revision: 1, archived_at: null, created_at: now, updated_at: now };
  const expert = { id: expertId, business_name: 'Adelaide Panel Care', description: 'Verified mobile repair specialist.', services: ['repair'], postcodes: ['5000'], insurance_valid_until: '2027-12-31', active: true };
  const quote = { id: quoteId, expert_name: expert.business_name, expert_description: expert.description, scope_summary: 'Inspect and repair the left rear door scratch.', total_price_cents: 49500, currency: 'AUD', status: 'issued', expires_at: new Date(Date.now() + 86400000).toISOString(), starts_at: startsAt, ends_at: endsAt };
  let state = 'quotes_ready';
  let completionPhotos = [];
  let activeAccount = customerAccount;
  const commands = [];
  const events = () => [
    ...(state === 'booking_requested' || ['scheduled', 'in_progress', 'completed'].includes(state) ? [{ id: 1, type: 'booking_requested', occurred_at: now }] : []),
    ...(['scheduled', 'in_progress', 'completed'].includes(state) ? [{ id: 2, type: 'booking_confirmed', occurred_at: now }] : []),
    ...(['in_progress', 'completed'].includes(state) ? [{ id: 3, type: 'work_started', occurred_at: now }] : []),
    ...(state === 'completed' ? [{ id: 4, type: 'work_completed', occurred_at: now }] : []),
  ];
  const snapshot = () => ({ id, kind: 'account', state, revision: events().length + 1, request: { vehicle: '2020 Toyota Corolla · SKY123', service: 'repair', description: 'Visible scratch on the left rear door', created_at: now }, details: { name: 'Synthetic Customer', phone: '0400000000', suburb: 'Adelaide', postcode: '5000', ...(state !== 'quotes_ready' ? { address: '1 Test Street' } : {}) }, quotes: [quote], selected_quote_id: state === 'quotes_ready' ? null : quoteId, appointment: state === 'quotes_ready' ? null : { starts_at: startsAt, ends_at: endsAt }, events: events(), photos: [], completion_photos: completionPhotos });
  const projection = () => ({ id, vehicle_id: vehicleId, vehicle_archived: false, service: 'repair', quote_state: state === 'quotes_ready' ? 'issued' : 'accepted', assignment_state: state === 'quotes_ready' ? 'none' : state === 'booking_requested' ? 'reserved' : 'accepted', fulfilment_state: state === 'quotes_ready' || state === 'booking_requested' ? null : state === 'scheduled' ? 'scheduled' : state === 'in_progress' ? 'in_progress' : 'completed', money_state: null, customer_stage: 'no_match', next_action: 'choose_recovery', responsible_role: 'customer', created_at: now, updated_at: now, next_update_at: null, is_overdue: false });
  const receipt = () => ({ ...projection(), description: 'Visible scratch on the left rear door', preferred_window: 'flexible', events: [{ id: 'legacy-1', sequence: 1, type: 'request_received', occurred_at: now }] });

  await page.route('**/api/v1/garage/vehicles**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/history')) return route.fulfill({ json: { data: { items: state === 'completed' ? [{ id: 'history-1', event_type: 'care_service_completed', occurred_at: now, source: 'skycar_care', payload: { journey_id: id, quote_id: quoteId, expert_id: expertId } }] : [], nextCursor: null } } });
    if (url.pathname.endsWith('/photo')) return route.fulfill({ status: 204, headers: { 'X-Skycar-Account': customerAccount } });
    return route.fulfill({ json: { meta: { accountId: customerAccount }, data: { items: url.searchParams.get('archived') === 'true' ? [] : [vehicle], nextCursor: null } } });
  });
  await page.route(/\/api\/v1\/care\/requests(?:\/[^/]+)?(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/care/requests') return route.fulfill({ json: { data: { items: [projection()], next_cursor: null, evaluated_at: now } } });
    return route.fulfill({ json: { data: receipt() } });
  });
  await page.route(/\/api\/v1\/care\/journey\/[^/]+\/photos(?:\/\d+)?(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') { completionPhotos = [1]; return route.fulfill({ status: 201, json: { data: { stored: 1 } }, headers: { 'X-Skycar-Account': activeAccount } }); }
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    return route.fulfill({ body: pixel, contentType: 'image/png', headers: { 'X-Skycar-Account': activeAccount } });
  });
  await page.route(/\/api\/v1\/care\/journey\/[^/]+$/, async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      commands.push(body.action);
      assert.equal(body.action, 'select_quote');
      assert.equal(body.payload.quote_id, quoteId);
      state = 'booking_requested';
      return route.fulfill({ json: { data: { id, state, replayed: false } }, headers: { 'X-Skycar-Account': customerAccount } });
    }
    return route.fulfill({ json: { data: snapshot() }, headers: { 'X-Skycar-Account': customerAccount } });
  });
  await page.route('**/api/v1/operations/care**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const data = url.searchParams.has('id') ? snapshot() : { queue: [{ id, kind: 'account', service: 'repair', description: 'Visible scratch on the left rear door', created_at: now, state }], experts: [expert], integrations: { assessment: 'Manual expert review — Ravin API not connected', payments: 'Not connected — no customer payments taken', notifications: 'In-app updates only' } };
      return route.fulfill({ json: { data }, headers: { 'X-Skycar-Account': operationsAccount } });
    }
    const body = request.postDataJSON();
    commands.push(body.action);
    if (body.action === 'confirm') { assert.deepEqual(body.payload, { availability_confirmed: true }); state = 'scheduled'; }
    if (body.action === 'start') state = 'in_progress';
    if (body.action === 'complete') state = 'completed';
    return route.fulfill({ json: { data: { id, state, replayed: false } }, headers: { 'X-Skycar-Account': operationsAccount } });
  });

  await page.goto(`${origin}/garage/jobs`);
  await page.getByRole('heading', { name: 'Toyota Corolla · SKY123' }).waitFor();
  await page.getByText('Quote ready', { exact: true }).waitFor();
  assert.equal(await page.getByText('No match yet', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Update overdue', { exact: true }).count(), 0);
  await page.getByRole('link', { name: /Review quotes/ }).click();
  await page.getByRole('heading', { name: 'Review your quotes' }).waitFor();
  await page.getByRole('button', { name: /Review this quote/ }).click();
  await page.getByLabel('Service street address').fill('1 Test Street');
  await page.getByRole('button', { name: 'Request this appointment' }).click();
  await page.getByRole('heading', { name: 'Your appointment is requested' }).waitFor();
  await page.getByText('Proposed appointment — confirmation required').waitFor();
  assert.equal(await page.getByText('Confirmed appointment', { exact: true }).count(), 0);

  activeAccount = operationsAccount;
  await page.goto(`${origin}/operations/care`);
  await page.getByRole('button', { name: /Repair · Your appointment is requested/ }).click();
  await page.getByRole('heading', { name: 'Requested, not confirmed' }).waitFor();
  await page.getByLabel(/I checked this expert/).check();
  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  await page.getByRole('heading', { name: 'Confirmed appointment', exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Record work started' }).click();
  await page.getByRole('heading', { name: 'Record the result' }).waitFor();
  const photo = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; canvas.getContext('2d').fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.getByLabel('Add damage photos').setInputFiles({ name: 'completion.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('button', { name: 'Remove photo 1' }).waitFor();
  await page.getByRole('button', { name: 'Save completion evidence' }).click();
  await page.getByRole('button', { name: 'Complete job with this evidence' }).waitFor();
  await page.getByRole('button', { name: 'Complete job with this evidence' }).click();
  await page.getByRole('heading', { name: 'Your service is complete' }).waitFor();

  activeAccount = customerAccount;
  await page.goto(`${origin}/care/journey/${id}`);
  await page.getByRole('heading', { name: 'Your service is complete' }).waitFor();
  await page.getByRole('img', { name: 'Completed work photo 1' }).waitFor();
  await page.goto(`${origin}/care/requests/${id}`);
  await page.getByRole('heading', { name: 'Your service is complete' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Ask for another review' }).count(), 0);
  await page.getByRole('link', { name: 'View completion record' }).click();
  await page.getByRole('heading', { name: 'Your service is complete' }).waitFor();
  await page.goto(`${origin}/garage/jobs`);
  await page.getByText('Service complete', { exact: true }).waitFor();
  assert.equal(await page.getByText('Update overdue', { exact: true }).count(), 0);
  await page.goto(`${origin}/garage`);
  await page.getByRole('button', { name: 'History +' }).click();
  await page.getByText('Care service completed', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(commands, ['select_quote', 'confirm', 'start', 'complete']);
  assert.deepEqual(errors, []);
  console.log('PASS: stale My Jobs → quote → requested appointment → operations confirmation → completion evidence → receipt/journey → Garage history');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
