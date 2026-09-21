// UI regression checks use intercepted synthetic API fixtures, NOT signed-in Supabase.
// See docs/GARAGE_VALIDATION.md for reproducible setup and separate live gates.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.GARAGE_PLAYWRIGHT_MODULE) throw new Error('Set GARAGE_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.GARAGE_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.GARAGE_BROWSER_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const origin = process.env.GARAGE_TEST_ORIGIN ?? 'http://127.0.0.1:3100';
const output = '.garage-qa';
await mkdir(output, { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const vehicles = [
  { id: '00000000-0000-4000-8000-000000000001', make: 'Toyota', model: 'Corolla', variant: 'Ascent Sport', year: 2020, registration: 'DEMO001', registration_state: 'SA', revision: 1, archived_at: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000002', make: 'Mazda', model: 'CX-5', variant: 'Touring', year: 2022, registration: 'DEMO002', registration_state: 'SA', revision: 1, archived_at: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z' },
];
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const real = await page.request.get(`${origin}/api/v1/garage/vehicles`);
  check(real.status() === 503, 'unconfigured real endpoint fails closed');
  check(real.headers()['cache-control'] === 'private, no-store', 'private endpoint is uncached');
  await page.goto(`${origin}/garage`);
  await page.getByRole('heading', { name: 'We couldn’t load your Garage' }).waitFor();
  check(await page.getByText('Garage is not available yet.').count() === 1, 'unavailable state is explicit');

  let mode = 'normal'; const retries = []; const ledger = new Map();
  await page.route('**/api/v1/garage/vehicles**', async route => {
    const request = route.request(), url = new URL(request.url());
    const success = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, meta: { requestId: 'fixture' } }) });
    const failure = (status, code, message, retryable = false) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message, fieldErrors: {}, retryable } }) });
    if (mode === 'unauthenticated') return failure(401, 'UNAUTHENTICATED', 'Sign in to access your Garage.');
    if (request.method() === 'GET') {
      if (url.pathname.endsWith('/history')) return success({ items: [{ id: 'history-1', event_type: 'vehicle_added', occurred_at: '2026-09-20T00:00:00Z', source: 'garage', payload: {} }], nextCursor: null });
      return success({ items: vehicles.filter(v => !!v.archived_at === (url.searchParams.get('archived') === 'true')), nextCursor: null });
    }
    const body = request.postDataJSON();
    if (request.method() === 'PATCH') return failure(409, 'REVISION_CONFLICT', 'This vehicle changed. Reload it before saving again.');
    if (url.pathname.endsWith('/archive')) {
      const vehicle = vehicles.find(v => url.pathname.includes(v.id));
      vehicle.archived_at = '2026-09-20T01:00:00Z'; vehicle.revision++;
      return success(vehicle);
    }
    const key = request.headers()['idempotency-key'];
    retries.push({ key, body });
    let vehicle = ledger.get(key);
    if (!vehicle) {
      vehicle = { ...vehicles[0], ...body, id: `00000000-0000-4000-8000-${String(vehicles.length + 1).padStart(12, '0')}`, revision: 1 };
      vehicles.push(vehicle); ledger.set(key, vehicle);
    }
    if (mode === 'uncertain') { mode = 'normal'; return failure(503, 'TEMPORARILY_UNAVAILABLE', 'Please retry the save.', true); }
    return success(vehicle);
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Corolla', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'CX-5', exact: true }).count() === 1, 'desktop lists both fixtures');
  await page.screenshot({ path: `${output}/garage-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'History +' }).first().click();
  await page.getByText('Added to Garage').waitFor();
  check(await page.getByText('Added to Garage').count() === 1, 'history renders');
  await page.getByRole('button', { name: 'Edit details' }).first().click();
  await page.getByLabel('Model', { exact: true }).fill('Unsaved change');
  await page.getByRole('button', { name: 'Save vehicle', exact: true }).click();
  await page.getByText('This vehicle changed.').waitFor();
  check(await page.getByLabel('Model', { exact: true }).inputValue() === 'Unsaved change', 'conflict preserves unsaved input');
  await page.getByRole('button', { name: 'Discard edits and reload' }).click();
  await page.getByRole('button', { name: '+ Add a vehicle', exact: true }).click();
  await page.getByLabel('Make', { exact: true }).fill('Honda');
  await page.getByLabel('Model', { exact: true }).fill('Civic');
  mode = 'uncertain';
  await page.getByRole('button', { name: 'Save vehicle', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same save' }).waitFor();
  check(await page.getByLabel('Make', { exact: true }).isDisabled(), 'uncertain save prevents changing the retry payload');
  await page.getByRole('button', { name: 'Retry same save' }).click();
  await page.getByRole('heading', { name: 'Civic', exact: true }).waitFor();
  check(retries.length === 2 && retries[0].key === retries[1].key && JSON.stringify(retries[0].body) === JSON.stringify(retries[1].body), 'uncertain retry preserves key and payload');
  check(vehicles.filter(v => v.model === 'Civic').length === 1, 'retry does not create duplicate fixture vehicle');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Archive vehicle', exact: true }).first().click();
  await page.getByText('Vehicle archived. Its history is still available in Archived.').waitFor();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('heading', { name: 'Corolla', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Edit details' }).count() === 0, 'archived vehicles are read-only');
  await page.getByRole('button', { name: 'My vehicles', exact: true }).click();
  await page.getByRole('heading', { name: 'CX-5', exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/garage-mobile.png`, fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile list has no horizontal overflow');
  await page.getByRole('button', { name: '+ Add a vehicle', exact: true }).click();
  await page.screenshot({ path: `${output}/garage-mobile-form.png`, fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile editor has no horizontal overflow');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  mode = 'unauthenticated';
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('heading', { name: 'Your Garage is private' }).waitFor();
  check(await page.locator('.vehicle-card').count() === 0 && await page.getByRole('button', { name: 'Edit details' }).count() === 0, 'expired session hides vehicle cards and edit controls');
  check(errors.length === 0, `no browser runtime errors: ${errors.join('; ')}`);
  console.log(`PASS: ${checks} browser checks. Synthetic API fixtures; live auth/DB/device checks remain separate.`);
} finally { await browser.close(); }
