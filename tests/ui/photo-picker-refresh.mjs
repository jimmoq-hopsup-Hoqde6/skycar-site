// Real image preparation and mobile lifecycle events, with synthetic API fixtures.
// This is not a native iOS/Android camera or hosted authorization acceptance test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test, before, after} from 'node:test';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:3205';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accountB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', '3205'], {stdio:'ignore'});
let browser;
before(async () => {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited before readiness');
    try { if ((await fetch(origin, {signal:AbortSignal.timeout(1000)})).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'test server started');
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH, headless:true, args:['--no-sandbox', '--disable-dev-shm-usage']});
});
after(async () => { await browser?.close(); server.kill('SIGTERM'); });

async function fixture(role) {
  const page = await browser.newPage({viewport:{width:390, height:844}});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const current = {account:accountA, status:200, revision:0, malformed:false, hold:null, reads:0, posts:[], uploaded:0};
  const snapshot = () => role === 'customer' ? {
    id, kind:'account', state:'review', revision:current.revision,
    request:{vehicle:`Synthetic ${current.account}`, service:'repair', description:'Private damage', created_at:'2026-11-01T00:00:00Z'},
    details:{name:current.account, phone:'0400000000', suburb:'Adelaide', postcode:'5000'},
    quotes:[], selected_quote_id:null, appointment:null, events:[], photos:Array.from({length:current.uploaded}, (_, index) => index + 1), completion_photos:[], completion_review:{state:null},
  } : {
    profile:{expert_id:current.account, business_name:`Synthetic ${current.account}`, description:'Repair specialist', services:['repair'], postcodes:['5000'], insurance_valid_until:'2030-12-31'},
    job:{id, kind:'guest', vehicle:'Synthetic car', service:'repair', description:'Private damage', postcode:'5000', state:'in_progress', access:'selected', created_at:'2026-11-01T00:00:00Z', appointment:{starts_at:'2026-11-01T01:00:00Z', ends_at:'2026-11-01T02:00:00Z'}, contact:{name:'Private customer', phone:'0400000000', address:'1 Test Street'}, photos:[]},
    own_quotes:[], completion_photos:Array.from({length:current.uploaded}, (_, index) => index + 1),
  };
  const path = role === 'customer' ? `/api/v1/care/journey/${id}` : `/api/v1/technician/jobs/${id}`;
  await page.route(`**${path}**`, async route => {
    if (route.request().method() === 'POST') {
      const request = route.request();
      const form = await new Response(request.postDataBuffer(), {headers:{'Content-Type':request.headers()['content-type']}}).formData();
      const photos = form.getAll('photos');
      current.posts.push(photos);
      current.uploaded = photos.length;
      return route.fulfill({json:{data:Object.hasOwn(current, 'postData') ? current.postData : {stored:photos.length}}, headers:{'X-Skycar-Account':current.account}});
    }
    if (route.request().url() !== origin + path) return route.fulfill({status:404, body:''});
    current.reads++;
    if (current.hold) await current.hold;
    if (current.status === 0) return route.abort('failed');
    return route.fulfill({status:current.status, json:current.status === 200 ? {data:current.malformed ? {} : snapshot()} : {error:{message:'Read access unavailable', retryable:current.status >= 500}}, headers:{'X-Skycar-Account':current.account}});
  });
  await page.goto(`${origin}/${role === 'customer' ? 'care/journey' : 'technician/jobs'}/${id}`);
  await page.getByRole('heading', {name:`Synthetic ${accountA}`, exact:true}).waitFor();
  const photo = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
    const context = canvas.getContext('2d'); context.fillStyle = '#2a8270'; context.fillRect(0, 0, 96, 64);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const choose = () => page.getByLabel(role === 'customer' ? 'Add damage photos' : 'Add completion photos').setInputFiles({name:'camera.png', mimeType:'image/png', buffer:photo});
  const save = page.getByRole('button', {name:role === 'customer' ? 'Save photos with request' : 'Save completion photos', exact:true});
  const refreshButton = page.getByRole('button', {name:role === 'customer' ? 'Refresh' : 'Refresh jobs', exact:true});
  async function refresh(event = 'focus') {
    const before = current.reads;
    await page.evaluate(event => {
      if (event === 'visibilitychange') document.dispatchEvent(new Event(event));
      else window.dispatchEvent(new Event(event));
    }, event);
    await waitFor(() => current.reads > before);
    await page.waitForFunction(name => [...document.querySelectorAll('button')].some(button => button.textContent === name && !button.disabled), role === 'customer' ? 'Refresh' : 'Refresh jobs');
  }
  async function deferPhoto() {
    await page.evaluate(() => {
      const original = window.createImageBitmap.bind(window);
      window.createImageBitmap = (...args) => new Promise((resolve, reject) => {
        window.releasePhoto = () => { window.createImageBitmap = original; return original(...args).then(resolve, reject); };
      });
    });
    await choose();
    await page.getByText('Preparing photos…', {exact:true}).waitFor();
  }
  return {page, current, errors, choose, save, refresh, refreshButton, deferPhoto};
}
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(predicate(), 'fixture reached expected state');
}

for (const role of ['customer', 'technician']) {
  test(`${role}: returning from the photo picker preserves pending and prepared photos`, async () => {
    const f = await fixture(role);
    const {page, current, save} = f;
    try {
      await f.choose();
      await page.getByRole('button', {name:'Remove photo 1'}).waitFor();
      await f.deferPhoto();
      for (const event of ['focus', 'pageshow', 'visibilitychange']) {
        await f.refresh(event);
        assert.equal(await save.isDisabled(), true, 'refresh must not enable uploading a partially prepared set');
      }
      await page.evaluate(() => window.releasePhoto());
      await page.getByRole('button', {name:'Remove photo 2'}).waitFor();
      assert.equal(await save.isDisabled(), false, 'decoding completes after lifecycle refresh');
      for (const event of ['focus', 'pageshow', 'visibilitychange']) {
        await f.refresh(event);
        assert.equal(await page.getByRole('button', {name:'Remove photo 1'}).count(), 1, `${event} preserves prepared photo`);
      }
      await save.click();
      await waitFor(() => current.posts.length === 1);
      assert.equal(current.posts[0].length, 2);
      assert.equal(current.posts[0][0].type, 'image/jpeg');
      assert.ok(current.posts[0][0].size >= 128 && current.posts[0][0].size <= 900000);
      assert.deepEqual(f.errors, []);
    } finally { await page.close(); }
  });

  test(`${role}: revalidation hides private drafts, recovers temporary failures and clears identity boundaries`, async () => {
    const f = await fixture(role);
    const {page, current, save} = f;
    try {
      await f.deferPhoto();
      let release;
      current.hold = new Promise(resolve => { release = resolve; });
      const before = current.reads;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await waitFor(() => current.reads > before);
      assert.equal(await page.getByText('Private damage', {exact:true}).isVisible(), false, 'private content hidden before identity is verified');
      // Decode may finish while the account read is pending, but cannot upload.
      await page.evaluate(() => window.releasePhoto());
      assert.equal(await save.isVisible(), false);
      assert.equal(current.posts.length, 0);
      current.status = 503; current.hold = null; release();
      await page.getByRole('alert').waitFor();
      assert.equal(await save.isVisible(), false, 'failed verification cannot reveal or submit retained drafts');
      current.status = 200;
      await f.refresh();
      await page.getByRole('button', {name:'Remove photo 1'}).waitFor();
      current.account = accountB;
      await f.refresh();
      assert.equal(await page.getByRole('button', {name:'Remove photo 1'}).count(), 0);
      assert.equal(await save.isDisabled(), true);
      await f.deferPhoto();
      current.account = accountA;
      await f.refresh();
      await page.evaluate(() => window.releasePhoto());
      await page.waitForTimeout(150);
      assert.equal(await page.getByRole('button', {name:'Remove photo 1'}).count(), 0, 'late decoding must not cross accounts');
      for (const status of [401, 403, 404]) {
        await f.choose(); await page.getByRole('button', {name:'Remove photo 1'}).waitFor();
        current.status = status; await f.refresh();
        assert.equal(await page.getByText('Private damage', {exact:true}).count(), 0, `${status} removes private content`);
        current.status = 200; await f.refresh();
        assert.equal(await page.getByRole('button', {name:'Remove photo 1'}).count(), 0, 'denied drafts cannot reappear for the same account');
      }
      assert.deepEqual(f.errors, []);
    } finally { await page.close(); }
  });

  test(`${role}: picker change after focus waits for verification without losing the selected file`, async () => {
    const f = await fixture(role);
    const {page, current, save} = f;
    try {
      let release;
      current.hold = new Promise(resolve => { release = resolve; });
      const before = current.reads;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await waitFor(() => current.reads > before);
      await f.choose();
      assert.equal(await save.isVisible(), false);
      assert.equal(current.posts.length, 0);
      current.hold = null; release();
      await page.getByRole('button', {name:'Remove photo 1'}).waitFor();
      await page.getByText('Preparing photos…', {exact:true}).waitFor({state:'hidden'});
      assert.equal(await save.isDisabled(), false, 'picker change survives focus-before-change ordering');
      assert.deepEqual(f.errors, []);
    } finally { await page.close(); }
  });
}

test('customer: unsaved service details survive lifecycle refresh and unrelated status revisions', async () => {
  const f = await fixture('customer');
  try {
    const name = f.page.getByLabel('Contact name');
    await name.fill('Private unsaved name');
    for (const event of ['focus', 'pageshow', 'visibilitychange']) {
      f.current.revision++;
      await f.refresh(event);
      assert.equal(await name.inputValue(), 'Private unsaved name', `${event} preserves the service draft`);
    }
    f.current.account = accountB; await f.refresh();
    assert.equal(await name.inputValue(), accountB, 'replacement account gets its own details');
    for (const width of [320, 390, 1440]) {
      await f.page.setViewportSize({width, height:900});
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('customer: an invalid upload receipt retains exact photos and request identity for retry', async () => {
  const f = await fixture('customer');
  try {
    await f.choose(); await f.page.getByRole('button', {name:'Remove photo 1'}).waitFor();
    await f.choose(); await f.page.getByRole('button', {name:'Remove photo 2'}).waitFor();
    f.current.postData = {stored:1};
    await f.save.click();
    await f.page.getByRole('button', {name:'Check same action'}).waitFor();
    assert.equal(f.current.posts.length, 1);
    await f.refresh();
    delete f.current.postData;
    await f.page.getByRole('button', {name:'Check same action'}).click();
    await f.page.getByRole('button', {name:'Check same action'}).waitFor({state:'hidden'});
    assert.equal(f.current.posts.length, 2);
    const bytes = files => Promise.all(files.map(file => file.arrayBuffer()));
    assert.deepEqual(await bytes(f.current.posts[1]), await bytes(f.current.posts[0]));
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});

test('customer: a reloaded partial set exposes original-file recovery without allowing replacement', async () => {
  const f = await fixture('customer');
  try {
    f.current.uploaded = 2;
    await f.page.reload();
    await f.page.getByRole('button', {name:'Retry an interrupted photo upload'}).click();
    await f.choose(); await f.page.getByRole('button', {name:'Remove photo 1'}).waitFor();
    await f.deferPhoto(); await f.refresh(); await f.page.evaluate(() => window.releasePhoto());
    await f.page.getByRole('button', {name:'Remove photo 2'}).waitFor();
    await f.page.getByRole('button', {name:'Retry original photo upload', exact:true}).click();
    await f.page.getByRole('button', {name:'Retry an interrupted photo upload'}).waitFor();
    assert.equal(f.current.posts.length, 1);
    assert.equal(f.current.posts[0].length, 2);
    assert.equal(await f.page.getByLabel('Add damage photos').count(), 0);
    assert.match(await f.page.locator('main').innerText(), /same browser and device/);
    assert.deepEqual(f.errors, []);
  } finally { await f.page.close(); }
});
