// Mocked transport isolates interrupted edits; API/DB authority is covered separately.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {availabilityOffsetLabels, availabilityReadSettled} from './support/availability-browser.mjs';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3206';
const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const endpoint = '**/api/v1/technician/availability';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3206'], {stdio: 'ignore'});
let browser;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const freshSchedule = (revision = 3, starts = '09:00') => ({timezone: 'Australia/Adelaide', revision, weekly_windows: [{weekday: 1, starts_at: starts, ends_at: '17:00'}], exceptions: [], evaluated_at: new Date().toISOString()});

try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'local production app starts');
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  page.setDefaultTimeout(10000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  let account = accountA, schedule = freshSchedule(), readStatus = 0, writeMode = 'success', readGate, writeGate;
  await page.route(endpoint, async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (readStatus === 'network') return route.abort('failed');
      if (readStatus === 'malformed-json') return route.fulfill({body: 'invalid-json', headers: {'X-Skycar-Account': account}});
      const response = readStatus ? {status: readStatus, json: {error: {message: 'Technician access unavailable', retryable: false}}}
        : {json: {data: structuredClone(schedule)}, headers: {'X-Skycar-Account': account}};
      const gate = readGate;
      readGate = undefined;
      if (gate) { gate.started.resolve(); await gate.release.promise; }
      await route.fulfill(response).catch(() => {}); // A superseded fetch may be aborted.
      return;
    }
    assert.equal(request.method(), 'PUT');
    const originalAccount = account, mode = writeMode, body = request.postDataJSON();
    const original = {body, key: request.headers()['idempotency-key'], account: request.headers()['x-skycar-account']};
    assert.ok(original.key);
    assert.equal(original.account, originalAccount);
    writes.push(original);
    const gate = writeGate;
    writeGate = undefined;
    if (gate) { gate.started.resolve(); await gate.release.promise; }
    if (typeof mode === 'number') return route.fulfill({status: mode, json: {error: {message: 'Technician access unavailable', retryable: false}}});
    if (mode === 'conflict') {
      schedule = freshSchedule(schedule.revision + 1, '08:30');
      return route.fulfill({status: 409, json: {error: {message: 'Refresh the saved hours before replacing them.', retryable: false}}});
    }
    const revision = body.expected_revision + 1;
    if (account === originalAccount && mode !== 'replay') schedule = {timezone: body.timezone, revision, weekly_windows: body.weekly_windows, exceptions: body.exceptions, evaluated_at: new Date().toISOString()};
    if (mode === 'lost') return route.abort('failed');
    return route.fulfill({json: {data: {revision, replayed: mode === 'replay'}}, headers: {'X-Skycar-Account': mode === 'changed' ? accountB : originalAccount}});
  });
  const monday = page.locator('.availability-day').filter({has: page.getByRole('heading', {name: 'Monday', exact: true})});
  const starts = () => monday.getByLabel('Starts', {exact: true});
  const save = () => page.getByRole('button', {name: 'Save hours', exact: true});
  const settled = async () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Refresh' && !button.disabled));
  const trigger = async (event = 'focus') => {
    const response = readStatus === 'network'
      ? page.waitForEvent('requestfailed', request => request.url().endsWith('/api/v1/technician/availability') && request.method() === 'GET')
      : page.waitForResponse(response => response.url().endsWith('/api/v1/technician/availability') && response.request().method() === 'GET');
    await page.evaluate(event => {
      if (event === 'visibilitychange') {
        Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
        document.dispatchEvent(new Event(event));
      } else window.dispatchEvent(new Event(event));
    }, event);
    await response;
    await page.waitForFunction(availabilityReadSettled);
  };
  const refresh = async (accept = true) => {
    page.once('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
    await page.getByRole('button', {name: 'Refresh', exact: true}).click();
    await settled();
  };
  const reset = async () => {
    account = accountA; schedule = freshSchedule(); readStatus = 0; writeMode = 'success';
    await page.goto(`${origin}/technician/availability`);
    await settled();
    await starts().waitFor();
  };
  await reset();
  await starts().fill('10:15');
  await page.getByRole('button', {name: 'Add a date', exact: true}).click();
  const exceptionDate = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  await page.getByLabel('Date', {exact: true}).fill(exceptionDate);
  const originalNode = await starts().elementHandle();
  for (const event of ['focus', 'pageshow', 'visibilitychange']) {
    await trigger(event);
    assert.equal(await starts().inputValue(), '10:15', `${event} preserves unsaved weekly hours`);
    assert.equal(await page.getByLabel('Date', {exact: true}).inputValue(), exceptionDate, `${event} preserves unsaved exceptions`);
    assert.ok(await originalNode.evaluate(node => node.isConnected), 'background validation keeps the original editor mounted');
  }
  await refresh(false);
  assert.equal(await starts().inputValue(), '10:15');
  await refresh();
  assert.equal(await starts().inputValue(), '09:00');
  assert.equal(await page.getByLabel('Date', {exact: true}).count(), 0, 'confirmed Refresh discards unsaved exceptions');

  // Every editing route, including blank drafts and deletion, must survive revalidation.
  await page.getByRole('button', {name: 'Add a date', exact: true}).click();
  await trigger();
  assert.equal(await page.getByLabel('Date', {exact: true}).inputValue(), '');
  await page.getByLabel('Date', {exact: true}).fill(exceptionDate);
  await page.getByLabel('Closed that day').uncheck();
  const exception = page.locator('.availability-day').filter({has: page.getByLabel('Date', {exact: true})});
  await exception.getByLabel('Starts', {exact: true}).fill('11:30');
  await exception.getByLabel('Ends', {exact: true}).fill('15:45');
  await exception.getByLabel(availabilityOffsetLabels.start).selectOption('+09:30');
  await exception.getByLabel(availabilityOffsetLabels.end).selectOption('+09:30');
  await trigger('pageshow');
  assert.equal(await exception.getByLabel('Starts', {exact: true}).inputValue(), '11:30');
  assert.equal(await exception.getByLabel('Ends', {exact: true}).inputValue(), '15:45');
  assert.equal(await exception.getByLabel(availabilityOffsetLabels.start).inputValue(), '+09:30');
  assert.equal(await exception.getByLabel(availabilityOffsetLabels.end).inputValue(), '+09:30');
  await page.getByRole('button', {name: 'Remove date', exact: true}).click();
  await monday.getByRole('button', {name: 'Remove', exact: true}).click();
  await trigger();
  assert.equal(await starts().count(), 0);
  assert.equal(await page.getByLabel('Date', {exact: true}).count(), 0);
  await monday.getByRole('button', {name: 'Add hours', exact: true}).click();
  await trigger();
  assert.equal(await starts().inputValue(), '09:00');
  await refresh();

  // Transient verification failures retain drafts privately, never access to them.
  for (const failure of [503, 'network']) {
    await starts().fill('10:30'); readStatus = failure; await trigger();
    assert.equal(await page.locator('form').isHidden(), true);
    assert.equal(await page.locator('input[type=time]').first().inputValue(), '10:30');
    assert.equal(await page.locator('form button[type=submit]').isDisabled(), true);
    const beforeSubmit = writes.length;
    await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
    assert.equal(writes.length, beforeSubmit);
    readStatus = 0;
    await page.getByRole('button', {name: 'Refresh', exact: true}).click(); await settled();
    assert.equal(await starts().inputValue(), '10:30', 'successful access check restores the retained draft');
    await refresh();
  }

  // Clean forms follow current server state; dirty forms never silently rebase.
  schedule = freshSchedule(4, '08:00');
  await trigger();
  assert.equal(await starts().inputValue(), '08:00');
  await starts().fill('10:00');
  schedule = freshSchedule(5, '07:00');
  await trigger();
  assert.equal(await starts().inputValue(), '10:00');
  await page.getByText(/Your edits are kept with revision 4/).waitFor();
  assert.equal(await save().isDisabled(), true);
  assert.equal(writes.length, 0);
  await refresh();
  assert.equal(await starts().inputValue(), '07:00');
  await starts().fill('10:00');
  writeMode = 'conflict';
  await save().click();
  await page.getByRole('alert').waitFor();
  assert.equal(writes.at(-1).body.expected_revision, 5);
  assert.equal(await starts().inputValue(), '10:00', '409 retains the rejected draft');
  await trigger();
  assert.equal(await starts().inputValue(), '10:00');
  await refresh();
  assert.equal(await starts().inputValue(), '08:30');

  // Unknown save outcomes freeze the exact command, but the retry stays usable.
  await starts().fill('11:00');
  writeMode = 'lost';
  await save().click();
  await page.getByRole('button', {name: 'Retry the same hours', exact: true}).waitFor();
  assert.equal(await starts().isDisabled(), true);
  const lost = writes.at(-1);
  await trigger();
  assert.equal(await starts().inputValue(), '11:00');
  readStatus = 503; await trigger();
  assert.equal(await page.locator('form').isHidden(), true);
  assert.equal(await page.locator('form button[type=submit]').isDisabled(), true, 'uncertain retry also requires verified access');
  readStatus = 0; await trigger();
  writeMode = 'replay';
  await page.getByRole('button', {name: 'Retry the same hours', exact: true}).click();
  await page.getByText('The same hours were already saved.', {exact: true}).waitFor();
  assert.deepEqual(writes.at(-1), lost, 'retry sends identical key, account and body');
  assert.equal(await starts().isDisabled(), false);

  // A focus read during a live save must not invalidate its successful response.
  await reset();
  await starts().fill('12:00');
  const saving = {started: deferred(), release: deferred()};
  writeGate = saving;
  await save().click();
  await saving.started.promise;
  await trigger();
  saving.release.resolve();
  await page.getByText('Hours saved. Confirmed jobs are unchanged.', {exact: true}).waitFor();
  assert.equal(await starts().inputValue(), '12:00');
  assert.equal(await page.getByRole('button', {name: 'Retry the same hours', exact: true}).count(), 0);

  // Changed-account reads clear both a private draft and an older write completion.
  await starts().fill('13:15');
  const oldWrite = {started: deferred(), release: deferred()};
  writeGate = oldWrite;
  await save().click();
  await oldWrite.started.promise;
  account = accountB; schedule = freshSchedule(20, '06:00');
  await trigger();
  assert.equal(await starts().inputValue(), '06:00');
  oldWrite.release.resolve();
  await settled();
  assert.equal(await starts().inputValue(), '06:00');
  assert.equal(await page.getByText('Hours saved. Confirmed jobs are unchanged.', {exact: true}).count(), 0);

  for (const denial of [401, 403, 404]) {
    await reset();
    await starts().fill('13:15');
    await page.getByRole('button', {name: 'Add a date', exact: true}).click();
    readStatus = denial;
    await trigger();
    assert.equal(await page.locator('form').count(), 0, `${denial} read clears private draft`);
    await page.getByRole('alert').waitFor();
  }
  for (const denial of [401, 403, 404, 'changed']) {
    await reset();
    await starts().fill('13:15');
    writeMode = denial;
    await save().click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('form').count(), 0, `${denial} write clears private draft`);
    assert.equal(await page.getByRole('button', {name: 'Retry the same hours', exact: true}).count(), 0);
  }
  for (const malformed of ['schedule', 'malformed-json']) {
    await reset(); await starts().fill('13:15');
    if (malformed === 'schedule') schedule = {}; else readStatus = malformed;
    await trigger();
    assert.equal(await page.locator('form').count(), 0, 'malformed successful response fails closed');
  }
  await reset();
  await starts().fill('13:15');
  account = 'unverified';
  await trigger();
  assert.equal(await page.locator('form').count(), 0, 'unverified account header clears the old draft');

  // An older GET cannot resurrect private state after a denied write.
  await reset();
  await starts().fill('13:15');
  writeMode = 403;
  const deniedWrite = {started: deferred(), release: deferred()};
  writeGate = deniedWrite;
  await save().click();
  await deniedWrite.started.promise;
  const oldRead = {started: deferred(), release: deferred()};
  readGate = oldRead;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await oldRead.started.promise;
  deniedWrite.release.resolve();
  await page.getByRole('alert').waitFor();
  oldRead.release.resolve();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('form').count(), 0, 'late authorized GET does not revive revoked state');

  await reset();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({width, height: 900});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: availability focus/pageshow/visibility draft preservation, confirmed discard, revision conflicts, exact retry, concurrent save/read ordering, denied read/write and account-change privacy, responsive UI (mock API).');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
