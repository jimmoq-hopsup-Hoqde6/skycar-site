// Synthetic browser regression matrix. Real Supabase/device acceptance is separate.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.GARAGE_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.GARAGE_BROWSER_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const origin = process.env.GARAGE_TEST_ORIGIN ?? 'http://127.0.0.1:3100';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let scenarios = 0;

async function scenario(kind, phase, event, boundary, outcome = 'success') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  const vehicle = { id: '11111111-1111-4111-8111-111111111111', make: 'PRIVATE_A', model: 'Original car', variant: null, year: 2020, registration: 'A123', registration_state: 'SA', revision: 1, archived_at: null, created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z' };
  const bVehicle = { ...vehicle, id: '22222222-2222-4222-8222-222222222222', make: 'PRIVATE_B', model: 'Replacement car', registration: 'B456' };
  const commands = [], ledger = new Map();
  const firstWrite = deferred(), finishWrite = deferred(), validationStarted = deferred(), finishValidation = deferred();
  let account = A, readMode = 'ready', holdReads = false, applied = 0, reads = 0;
  await page.route(/\/api\/v1\/garage\/vehicles(?:[/?].*)?$/, async route => {
    const req = route.request(), url = new URL(req.url());
    const success = (data, owner) => route.fulfill({ json: { data, meta: { accountId: owner } } });
    const failure = (status, code, retryable = false) => route.fulfill({ status, json: { error: { code, message: 'Synthetic verification or write failure', fieldErrors: {}, retryable } } });
    if (req.method() === 'GET') {
      reads++;
      const owner = account, mode = readMode;
      if (holdReads) { validationStarted.resolve(); await finishValidation.promise; }
      if (mode === 'signedout') return failure(401, 'UNAUTHENTICATED');
      if (mode === 'failed') return failure(503, 'TEMPORARILY_UNAVAILABLE', true);
      const items = owner === B ? [bVehicle] : kind === 'create' ? [...ledger.values()] : [vehicle];
      return success({ items: items.filter(v => !!v.archived_at === (url.searchParams.get('archived') === 'true')), nextCursor: null }, mode === 'missing' ? undefined : owner);
    }
    const command = { key: req.headers()['idempotency-key'], account: req.headers()['x-skycar-account'], body: req.postData(), method: req.method(), path: url.pathname };
    commands.push(command);
    const owner = account;
    if (command.account !== owner) return failure(409, 'ACCOUNT_CHANGED');
    const index = commands.length;
    firstWrite.resolve();
    if (phase === 'pending' && index === 1) await finishWrite.promise;
    if (phase === 'pending' && index === 1 && outcome === 'error') return failure(503, 'TEMPORARILY_UNAVAILABLE', true);
    let saved = ledger.get(command.key);
    if (!saved) {
      applied++;
      const input = JSON.parse(command.body);
      saved = { ...vehicle, ...input, revision: vehicle.revision + 1, ...(kind === 'archive' ? { archived_at: '2026-09-21T01:00:00Z' } : {}) };
      ledger.set(command.key, saved);
      if (kind !== 'create') Object.assign(vehicle, saved);
    }
    if (phase === 'uncertain' && index === 1) return failure(503, 'TEMPORARILY_UNAVAILABLE', true);
    return success(saved, owner);
  });
  try {
    await page.goto(`${origin}/garage`);
    if (kind === 'create') {
      await page.getByRole('button', { name: '+ Add a vehicle', exact: true }).click();
      await page.getByLabel('Make', { exact: true }).fill('PRIVATE_A');
      await page.getByLabel('Model', { exact: true }).fill('Unresolved change');
    } else if (kind === 'edit') {
      await page.getByRole('button', { name: 'Edit details', exact: true }).click();
      await page.getByLabel('Model', { exact: true }).fill('Unresolved change');
    }
    await page.getByRole('button', { name: kind === 'archive' ? 'Archive vehicle' : 'Save vehicle', exact: true }).click();
    await firstWrite.promise;
    const retryName = kind === 'archive' ? 'Retry same archive' : 'Retry same save';
    if (phase === 'uncertain') await page.getByRole('button', { name: retryName }).waitFor();
    if (boundary === 'replacement') account = B;
    if (['failed', 'signedout', 'missing'].includes(boundary)) readMode = boundary;
    holdReads = true;
    await page.evaluate(name => {
      if (name === 'visibilitychange') document.dispatchEvent(new Event(name));
      else window.dispatchEvent(new Event(name));
    }, event);
    await validationStarted.promise;
    await page.getByText('Loading your vehicles…').waitFor();
    assert.equal(await page.locator('input').count(), 0, 'private editor is unmounted while validating');
    assert.equal(await page.getByText('PRIVATE_A', { exact: true }).count(), 0, 'old cards are redacted');
    assert.equal(commands.length, 1, 'revalidation cannot start a fresh write');
    holdReads = false; finishValidation.resolve();
    if (['failed', 'signedout', 'missing'].includes(boundary)) {
      await page.getByRole('heading', { name: boundary === 'signedout' ? 'Your Garage is private' : 'We couldn’t load your Garage' }).waitFor();
      assert.equal(await page.locator('input').count(), 0);
      assert.equal(await page.getByRole('button', { name: /Save vehicle|Retry same|Add.*vehicle|Edit details|Archive vehicle/ }).count(), 0);
      if (phase === 'pending') { finishWrite.resolve(); await page.waitForTimeout(60); }
      assert.equal(await page.locator('.garage-notice').count(), 0, 'late success cannot bypass failed validation');
      readMode = 'ready';
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
    }
    if (boundary === 'replacement') {
      await page.getByRole('heading', { name: 'Replacement car', exact: true }).waitFor();
      // Install a B editor before completing A: old success/error/finally must
      // not close, overwrite, reload or unlock this replacement state.
      await page.getByRole('button', { name: 'Edit details', exact: true }).click();
      await page.getByLabel('Model', { exact: true }).fill('B unsaved draft');
      const readsBefore = reads;
      if (phase === 'pending') finishWrite.resolve();
      await page.waitForTimeout(100);
      assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'B unsaved draft');
      assert.equal(await page.getByLabel('Make', { exact: true }).inputValue(), 'PRIVATE_B');
      assert.equal(await page.locator('.garage-notice').count(), 0);
      assert.equal(await page.getByRole('button', { name: retryName }).count(), 0);
      assert.equal(reads, readsBefore, 'late archive/save must not invoke old load closure');
      assert.equal(commands.length, 1, 'old command is never replayed under B');
    } else {
      if (phase === 'pending' && !['failed', 'signedout', 'missing'].includes(boundary)) {
        if (kind !== 'archive') {
          await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
          assert.equal(await page.getByLabel('Model', { exact: true }).isDisabled(), true);
          assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'Unresolved change');
        }
        finishWrite.resolve();
      }
      if (phase === 'uncertain' || outcome === 'error') {
        await page.getByRole('button', { name: retryName }).click();
        assert.equal(commands.length, 2);
        assert.deepEqual(commands[1], commands[0], 'retry retains exact key/body/path/method/account');
      }
      await page.getByText(kind === 'archive' ? 'Vehicle archived. Its history is still available in Archived.' : 'PRIVATE_A Unresolved change saved to your Garage.', { exact: true }).waitFor();
      assert.equal(applied, 1, 'only one committed synthetic mutation');
      assert.equal(new Set(commands.map(c => c.key)).size, 1, 'no fresh mutation key after page return');
      assert.ok(commands.every(c => c.account === A), 'all writes are bound to the initiating identity');
      if (kind === 'archive') {
        await page.getByRole('button', { name: 'Archived', exact: true }).click();
        await page.getByRole('heading', { name: 'Original car', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Edit details' }).count(), 0);
      }
    }
    assert.deepEqual(errors, []);
    scenarios++;
    console.log(`PASS Garage recovery: ${kind}/${phase}/${event}/${boundary}/${outcome}`);
  } finally { finishWrite.resolve(); finishValidation.resolve(); await context.close(); }
}
try {
  for (const kind of ['create', 'edit', 'archive']) {
    for (const phase of ['pending', 'uncertain']) {
      for (const event of ['focus', 'pageshow']) {
        await scenario(kind, phase, event, 'same');
        await scenario(kind, phase, event, 'replacement');
      }
      await scenario(kind, phase, 'visibilitychange', 'failed');
      await scenario(kind, phase, 'pageshow', 'signedout');
    }
    await scenario(kind, 'pending', 'focus', 'replacement', 'error');
    await scenario(kind, 'pending', 'pageshow', 'same', 'error');
  }
  await scenario('create', 'uncertain', 'pageshow', 'missing');
  console.log(`PASS: ${scenarios} Garage browser recovery scenarios; synthetic fixtures, not hosted evidence.`);
} finally { await browser.close(); }
