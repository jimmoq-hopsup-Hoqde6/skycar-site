// Synthetic intercepted API fixtures: not live authentication or database verification.
// Install Playwright separately; PLAYWRIGHT_MODULE and CHROMIUM_PATH may point to an existing installation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = playwright.chromium ?? playwright.default?.chromium;
const port = 3187;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
let browser;
try {
  let ready = false;
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (server.exitCode !== null) throw new Error('Fixture server exited before readiness');
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      await response.text();
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Fixture server was not ready within 30 seconds');
  console.log('Starting browser', output);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader'], timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const evidence = new URL('../../docs/qa/care-status/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  const id = '11111111-1111-4111-8111-111111111111';
  const received = { id, vehicle_id: id, service: 'repair', description: 'Synthetic request for a door scratch', preferred_window: 'flexible', customer_stage: 'request_received', responsible_role: 'operations', next_action: 'review_request', created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', next_update_at: '2020-01-01T00:00:00Z', events: [{ id: 'event-1', sequence: 1, type: 'request_received', occurred_at: '2026-09-20T12:00:00Z' }] };
  let mode = 'received';
  let releaseDelayedStatus;
  let delayedStatusStarted;
  const keys = [];
  await page.route('**/api/v1/care/requests/**', async route => {
    if (route.request().method() === 'POST') {
      keys.push(route.request().headers()['idempotency-key']);
      assert.deepEqual(JSON.parse(route.request().postData()), {});
      if (keys.length === 1) return route.abort();
      return route.fulfill({ json: { data: { request: { ...received, next_update_at: '2099-01-01T00:00:00Z' }, replayed: true } } });
    }
    if (mode === 'unauthorized') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
    if (mode === 'offline') return route.abort();
    const requestMode = mode;
    if (requestMode === 'delayed_received') {
      delayedStatusStarted?.();
      await new Promise(resolve => { releaseDelayedStatus = resolve; });
    }
    const data = requestMode === 'no_match' ? { ...received, customer_stage: 'no_match', responsible_role: 'customer', next_update_at: null } : received;
    return route.fulfill({ json: { data } });
  });
  page.setDefaultTimeout(10000);
  console.log('Opening request');
  await page.goto(`${origin}/care/requests/${id}`);
  await page.getByRole('heading', { name: 'Your update is overdue' }).waitFor();
  await page.screenshot({ path: new URL('desktop-overdue.png', evidence).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('mobile-overdue.png', evidence).pathname, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  // A delayed prior-session response must not restore private details after a
  // focus-triggered session replacement/access failure.
  mode = 'delayed_received';
  const delayedStarted = new Promise(resolve => { delayedStatusStarted = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await delayedStarted;
  mode = 'unauthorized';
  const deniedRevalidation = page.waitForResponse(response => response.url().includes(`/api/v1/care/requests/${id}`) && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await deniedRevalidation;
  await page.getByText('Sign in to Skycar, then refresh this page to see your request.').waitFor();
  assert.equal(await page.getByText(received.description).count(), 0);
  releaseDelayedStatus();
  await page.waitForTimeout(100);
  assert.equal(await page.getByText(received.description).count(), 0);

  mode = 'received';
  const restoredStatus = page.waitForResponse(response => response.url().includes(`/api/v1/care/requests/${id}`) && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await restoredStatus;
  await page.getByText(received.description).waitFor();

  mode = 'offline';
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('alert').filter({ hasText: 'may have changed' }).waitFor();
  assert.match(await page.getByRole('alert').filter({ hasText: 'may have changed' }).textContent(), /may have changed/);
  await page.screenshot({ path: new URL('mobile-stale-refresh.png', evidence).pathname, fullPage: true });
  mode = 'no_match';
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('heading', { name: 'No match yet' }).waitFor();
  await page.screenshot({ path: new URL('mobile-no-match.png', evidence).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Ask for another review' }).click();
  await page.getByRole('button', { name: 'Check reopening' }).waitFor();
  const storedKey = await page.evaluate(requestId => JSON.parse(sessionStorage.getItem(`skycar:care-retry:v1:${requestId}`))?.idempotency_key, id);
  assert.equal(storedKey, keys[0]);
  await page.reload();
  await page.getByRole('button', { name: 'Check reopening' }).waitFor();
  await page.getByText('This tab saved the attempt and will reuse it after a reload.').waitFor();
  await page.screenshot({ path: new URL('mobile-reload-recovery.png', evidence).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Check reopening' }).click();
  await page.getByRole('heading', { name: 'We have your request' }).waitFor();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(await page.evaluate(requestId => sessionStorage.getItem(`skycar:care-retry:v1:${requestId}`), id), null);
  mode = 'unauthorized';
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByText('Sign in to Skycar, then refresh this page to see your request.').waitFor();
  assert.equal(await page.getByText(received.description).count(), 0);
  await page.screenshot({ path: new URL('mobile-access-expired.png', evidence).pathname, fullPage: true });
  console.log('PASS: overdue before worker, mobile overflow, focus/pageshow session revalidation, delayed prior-session response isolation, stale failure notice, no-match, cross-reload retry key reuse, reopened receipt, expired-session redaction');
} finally {
  if (browser) await browser.close();
  server.kill();
}
