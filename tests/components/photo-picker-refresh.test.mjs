// Mounted production React components with a DOM simulator and controlled browser primitives.
// This proves lifecycle/state behavior, not browser image codecs or native camera integration.
// Run with HAPPY_DOM_MODULE pointing to a test-only happy-dom@20.8.4 installation.
// PHOTO_TEST_BASELINE=fa3859b exercises the same regression against the original source.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {storeCarePhotos} from '../../src/server/care/guest-photos.mjs';
import {resolve, dirname, extname} from 'node:path';
import React, {act} from 'react';
import ts from 'typescript';
const {Window} = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
const window = new Window({url:'http://localhost/'});
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'Node']) {
  globalThis[name] = name === 'window' ? window : window[name];
}
Object.defineProperty(globalThis, 'navigator', {configurable:true, value:window.navigator});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createRoot} = await import('react-dom/client');
const require = createRequire(import.meta.url);
const rootDirectory = process.cwd();
const modules = new Map();
function componentModule(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const source = process.env.PHOTO_TEST_BASELINE
    ? execFileSync('git', ['show', `${process.env.PHOTO_TEST_BASELINE}:${filename.slice(rootDirectory.length + 1)}`], {encoding:'utf8'})
    : readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {compilerOptions:{jsx:ts.JsxEmit.ReactJSX, module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true}}).outputText;
  const compiled = {exports:{}};
  modules.set(filename, compiled);
  const localRequire = specifier => {
    if (specifier.endsWith('.css')) return {};
    if (specifier === 'next/link') return function TestLink({children, ...props}) { return React.createElement('a', props, children); };
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
    const path = specifier.startsWith('@/') ? resolve(rootDirectory, 'src', specifier.slice(2)) : resolve(dirname(filename), specifier);
    if (path.endsWith('.mjs')) return require(path);
    if (extname(path)) return componentModule(path);
    for (const extension of ['.tsx', '.ts']) {
      try { readFileSync(path + extension); return componentModule(path + extension); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw new Error(`Unresolved component import: ${specifier}`);
  };
  new Function('require', 'module', 'exports', output)(localRequire, compiled, compiled.exports);
  return compiled.exports;
}
const {CustomerJourney} = componentModule(resolve('src/features/care/journey/customer.tsx'));
const {TechnicianInbox} = componentModule(resolve('src/features/technician/inbox.tsx'));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const accountB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; document.body.replaceChildren(); });
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const buttons = () => [...document.querySelectorAll('button')];
const button = name => buttons().find(element => element.textContent === name);
const privateArea = () => document.querySelector('.journey-description, .technician-description');
const concealed = element => !element || !!element.closest('[hidden]');
async function mount(role, initial = {}) {
  const current = {account:accountA, expert:accountA, id, status:200, revision:0, hold:null, nextRead:null, readCalls:0, postHold:null, postStatus:200, postAccount:null, description:'Private damage', requestPhotos:[], completionPhotos:[], photoStatus:200, photoFetches:[], malformed:false, missingAccount:false, posts:[], state:role === 'customer' ? 'review' : 'in_progress', ...initial};
  const snapshot = () => role === 'customer' ? {
    id:current.id, kind:'account', state:current.state, revision:current.revision,
    request:{vehicle:`Synthetic ${current.account}`, service:'repair', description:current.description, created_at:'2026-11-01T00:00:00Z'},
    details:{name:current.account, phone:'0400000000', suburb:'Adelaide', postcode:'5000'},
    quotes:[], selected_quote_id:null, appointment:null, events:[], photos:current.requestPhotos, completion_photos:current.completionPhotos, completion_review:{state:current.state === 'completed' ? 'awaiting_review' : null},
  } : {
    profile:{expert_id:current.expert, business_name:`Synthetic ${current.account}`, description:'Repair specialist', services:['repair'], postcodes:['5000'], insurance_valid_until:'2030-12-31'},
    job:{id:current.id, kind:'guest', vehicle:'Synthetic car', service:'repair', description:current.description, postcode:'5000', state:current.state, access:current.state === 'review' ? 'invited' : 'selected', created_at:'2026-11-01T00:00:00Z', appointment:current.state === 'review' ? null : {starts_at:'2026-11-01T01:00:00Z', ends_at:'2026-11-01T02:00:00Z'}, contact:current.state === 'review' ? null : {name:'Private customer', phone:'0400000000', address:'1 Test Street'}, photos:current.requestPhotos},
    own_quotes:[], completion_photos:current.completionPhotos,
  };
  globalThis.fetch = async (url, options) => {
    if (/\/(?:completion-)?photos\/\d/.test(url)) { current.photoFetches.push(url); return new Response(new Uint8Array(256), {status:current.photoStatus, headers:{'Content-Type':'image/jpeg', 'X-Skycar-Account':current.account}}); }
    if (options?.method === 'POST') {
      const writeAccount = current.account;
      current.posts.push({url, options});
      if (current.postHold) await current.postHold;
      if (current.postStatus === 0) throw new Error('Lost save response');
      if (current.onPost) await current.onPost(options);
      const receipt = Object.hasOwn(current, 'postData') ? current.postData : typeof options.body === 'string' ? (role === 'customer' ? {ok:true} : {id:current.id, action:JSON.parse(options.body).action, state:current.state, quote_id:null, replayed:false}) : {stored:options.body.getAll('photos').length};
      return new Response(JSON.stringify(current.postStatus === 200 ? {data:receipt} : {error:{message:'Save access denied', retryable:false}}), {status:current.postStatus, headers:{'X-Skycar-Account':current.postAccount || writeAccount}});
    }
    current.readCalls++;
    if (current.nextRead) { const held = current.nextRead; current.nextRead = null; held.signal = options.signal; return held.response; }
    if (current.hold) await current.hold;
    if (current.status === 0) throw new Error('Temporary network failure');
    return new Response(JSON.stringify(current.status === 200 ? {data:current.malformed ? {} : snapshot()} : {error:{message:'Read access unavailable', retryable:current.status >= 500}}), {status:current.status, headers:current.missingAccount ? {} : {'X-Skycar-Account':current.account}});
  };
  // Only decoding/canvas primitives are stubbed; DamagePhotos and its cleanup run unchanged.
  globalThis.createImageBitmap = async () => ({width:96, height:64, close(){}});
  window.HTMLCanvasElement.prototype.getContext = () => ({fillRect(){}, drawImage(){}, fillStyle:''});
  let preparedSequence = 0;
  window.HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new Blob([new Uint8Array(256).fill(++preparedSequence)], {type:'image/jpeg'})); };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const Component = role === 'customer' ? CustomerJourney : TechnicianInbox;
  await act(async () => root.render(React.createElement(Component, {id:current.id})));
  await flush();
  assert.ok(privateArea(), 'fixture rendered a verified private view');
  async function refresh(event = 'focus') {
    await act(async () => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)));
    await flush();
  }
  async function choose(defer = false) {
    let release;
    if (defer) globalThis.createImageBitmap = () => new Promise(resolve => { release = () => resolve({width:96, height:64, close(){}}); });
    const input = document.querySelector('input[type=file]');
    assert.ok(input && !input.disabled, 'picker is enabled');
    Object.defineProperty(input, 'files', {configurable:true, value:[new File([new Uint8Array(256)], 'camera.png', {type:'image/png'})]});
    await act(async () => input.dispatchEvent(new Event('change', {bubbles:true})));
    await flush();
    return async () => { await act(async () => release?.()); await flush(); };
  }
  function deferPost() { let release; current.postHold = new Promise(resolve => { release = resolve; }); return async () => { current.postHold = null; await act(async () => release()); await flush(); }; }
  function deferRead() { let release; const response = new Response(JSON.stringify({data:snapshot()}), {headers:{'X-Skycar-Account':current.account}}); const held = {response:new Promise(resolve => { release = () => resolve(response); }), signal:null}; current.nextRead = held; return {get aborted(){ return held.signal?.aborted; }, release:async () => { await act(async () => release()); await flush(); }}; }
  return {current, refresh, choose, deferPost, deferRead, save:() => role === 'customer' ? button('Save photos with request') || button('Retry original photo upload') : button('Save completion photos'), rerender:async newId => { current.id = newId; await act(async () => root.render(React.createElement(Component, {id:newId}))); await flush(); }};
}

for (const role of ['customer', 'technician']) {
  for (const denial of [401, 403, 404, 'changed-account']) {
    test(`${role}: a ${denial} POST during focus refresh overrides an older successful GET`, async () => {
      const f = await mount(role);
      await f.choose();
      const releasePost = f.deferPost();
      await act(async () => f.save().click()); await flush();
      assert.equal(f.current.posts.length, 1);
      const oldRead = f.deferRead(); await f.refresh();
      if (denial === 'changed-account') f.current.postAccount = accountB;
      else f.current.postStatus = denial;
      await releasePost();
      assert.ok(!privateArea(), 'definitive write denial removes the private view even during refresh');
      assert.equal(button(role === 'customer' ? 'Check same action' : 'Retry same action'), undefined, 'denied writes cannot leave retryable attempts');
      assert.equal(oldRead.aborted, true, 'denial cancels the pending read');
      await oldRead.release();
      assert.ok(!privateArea(), 'a late successful GET cannot restore access after denied POST');
      assert.equal(button(role === 'customer' ? 'Refresh' : 'Refresh jobs').disabled, false, 'denial must not leave loading stuck');
      await f.refresh();
      assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, 'a new verified read must not recover denied files');
      assert.equal(f.current.posts.length, 1, 'there is no automatic write retry');
    });
  }

  test(`${role}: same-scope POST success survives focus and replaces an older GET with a fresh read`, async () => {
    const f = await mount(role);
    await f.choose();
    const releasePost = f.deferPost();
    await act(async () => f.save().click()); await flush();
    const oldRead = f.deferRead(); await f.refresh();
    f.current.description = 'Latest saved request';
    const reads = f.current.readCalls;
    await releasePost();
    assert.ok(f.current.readCalls > reads, 'confirmed save requests a new authoritative snapshot');
    assert.equal(privateArea().textContent, 'Latest saved request');
    assert.equal(button(role === 'customer' ? 'Check same action' : 'Retry same action'), undefined);
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0);
    assert.equal(oldRead.aborted, true);
    await oldRead.release();
    assert.equal(privateArea().textContent, 'Latest saved request', 'stale read must not roll back saved state');
    assert.equal(f.current.posts.length, 1);
  });

  for (const scope of ['account', 'request', 'account-roundtrip', ...(role === 'technician' ? ['expert'] : [])]) {
    for (const outcome of [200, 403]) {
      test(`${role}: an old ${outcome} POST cannot affect a replacement ${scope} scope`, async () => {
        const f = await mount(role);
        await f.choose();
        const releasePost = f.deferPost();
        await act(async () => f.save().click()); await flush();
        f.current.description = 'Replacement scope request';
        if (scope === 'request') await f.rerender('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
        else if (scope === 'expert') { f.current.expert = accountB; await f.refresh(); }
        else { f.current.account = accountB; await f.refresh(); if (scope === 'account-roundtrip') { f.current.account = accountA; await f.refresh(); } }
        const reads = f.current.readCalls;
        f.current.postStatus = outcome;
        await releasePost();
        assert.equal(privateArea()?.textContent, 'Replacement scope request');
        assert.equal(concealed(privateArea()), false);
        assert.equal(document.querySelector('[role=alert]'), null, 'stale save must not expose an error on the replacement scope');
        assert.equal(button(role === 'customer' ? 'Check same action' : 'Retry same action'), undefined);
        assert.equal(f.current.readCalls, reads, 'old write cannot trigger a read for its former request');
      });
    }
  }

  test(`${role}: an access-denied GET takes precedence over an earlier successful POST`, async () => {
    const f = await mount(role);
    await f.choose();
    const releasePost = f.deferPost();
    await act(async () => f.save().click()); await flush();
    f.current.status = 403; await f.refresh();
    assert.ok(!privateArea());
    const reads = f.current.readCalls;
    await releasePost();
    assert.ok(!privateArea(), 'an old successful write cannot restore a revoked scope');
    assert.equal(f.current.readCalls, reads);
    assert.equal(button(role === 'customer' ? 'Check same action' : 'Retry same action'), undefined);
  });

  test(`${role}: a lost POST response after focus retains the original upload for exact retry`, async () => {
    const f = await mount(role);
    await f.choose(); await f.choose();
    const releasePost = f.deferPost();
    await act(async () => f.save().click()); await flush();
    await f.refresh();
    f.current.postStatus = 0; await releasePost();
    const retry = button(role === 'customer' ? 'Check same action' : 'Retry same action');
    assert.ok(retry && !retry.disabled);
    f.current.postStatus = 200;
    await act(async () => retry.click()); await flush();
    assert.equal(f.current.posts.length, 2);
    const [first, second] = f.current.posts.map(post => post.options);
    assert.deepEqual(first.headers, second.headers);
    const photos = options => options.body.getAll('photos');
    assert.equal(photos(first).length, 2);
    assert.deepEqual(photos(first).map(file => file.name), photos(second).map(file => file.name));
    assert.deepEqual(await Promise.all(photos(first).map(file => file.arrayBuffer())), await Promise.all(photos(second).map(file => file.arrayBuffer())));
    if (role === 'customer') assert.ok(first.headers['Idempotency-Key']);
    else assert.equal(first.headers['Idempotency-Key'], undefined);
    assert.equal(button(role === 'customer' ? 'Check same action' : 'Retry same action'), undefined);
  });

  test(`${role}: refreshing retries failed saved request and completion image reads`, async () => {
    const f = await mount(role);
    f.current.requestPhotos = [1]; f.current.completionPhotos = [1];
    if (role === 'customer') f.current.state = 'completed';
    f.current.photoStatus = 503; await f.refresh();
    assert.equal(document.querySelectorAll('figcaption').length, 2);
    assert.equal(f.current.photoFetches.length, 2);
    f.current.photoStatus = 200; await f.refresh();
    assert.equal(f.current.photoFetches.length, 4, 'Refresh to retry must fetch both saved photos again');
    assert.equal(document.querySelectorAll('figcaption').length, 0);
    assert.equal(document.querySelectorAll('img[src^="blob:"]').length, 2);
  });

  test(`${role}: picker return cannot cancel decoding or discard prepared photos`, async () => {
    const f = await mount(role);
    await f.choose();
    const release = await f.choose(true);
    for (const event of ['focus', 'pageshow', 'visibilitychange']) {
      await f.refresh(event);
      assert.equal(f.save().disabled, true, 'refresh must not enable uploading an incomplete photo set');
    }
    await release();
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 2"]').length, 1, 'pending image decoding must survive same-scope refresh');
    assert.equal(f.save().disabled, false);
    for (const event of ['focus', 'pageshow', 'visibilitychange']) {
      await f.refresh(event);
      assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 1, 'prepared photos must survive lifecycle refresh');
    }
    await act(async () => f.save().click()); await flush();
    assert.equal(f.current.posts.length, 1);
    const prepared = f.current.posts[0].options.body.getAll('photos');
    assert.equal(prepared.length, 2); assert.equal(prepared[0].type, 'image/jpeg');
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, 'confirmed upload resets the draft');
  });

  test(`${role}: pending verification blocks uploads, temporary failure hides drafts until verified recovery`, async () => {
    const f = await mount(role);
    const decoded = await f.choose(true);
    let releaseRead;
    f.current.hold = new Promise(resolve => { releaseRead = resolve; });
    await f.refresh();
    assert.equal(concealed(privateArea()), true);
    await decoded();
    await act(async () => f.save()?.click());
    assert.equal(f.current.posts.length, 0, 'even a scripted click cannot submit while access is unverified');
    f.current.status = 503; f.current.hold = null;
    await act(async () => releaseRead()); await flush();
    assert.equal(concealed(privateArea()), true);
    await act(async () => f.save()?.click());
    assert.equal(f.current.posts.length, 0, 'failed verification cannot send a retained draft');
    f.current.status = 200; await f.refresh();
    assert.equal(concealed(privateArea()), false);
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 1, 'same verified identity recovers prepared draft');
    assert.equal(f.save().disabled, false);
  });

  test(`${role}: a native picker change arriving after focus is retained while revalidation is pending`, async () => {
    const f = await mount(role);
    const originalPicker = document.querySelector('input[type=file]');
    let releaseRead;
    f.current.hold = new Promise(resolve => { releaseRead = resolve; });
    await f.refresh();
    assert.ok(document.querySelector('input[type=file]') === originalPicker, 'the open native picker must retain its input element');
    await f.choose();
    assert.equal(concealed(privateArea()), true);
    await act(async () => f.save()?.click());
    assert.equal(f.current.posts.length, 0);
    f.current.hold = null;
    await act(async () => releaseRead()); await flush();
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 1, 'focus-before-change must not drop the selected file');
    assert.equal(f.save().disabled, false);
  });

  test(`${role}: account/request changes and denied or invalid reads discard old drafts and late decoding`, async () => {
    const f = await mount(role);
    const decoded = await f.choose(true);
    f.current.account = accountB;
    await f.refresh(); await decoded();
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, 'late decode cannot enter a replacement account');
    assert.equal(f.save().disabled, true);
    globalThis.createImageBitmap = async () => ({width:96, height:64, close(){}});
    for (const status of [401, 403, 404, 'malformed', 'missing-account']) {
      await f.choose();
      if (typeof status === 'number') f.current.status = status;
      else f.current[status === 'malformed' ? 'malformed' : 'missingAccount'] = true;
      await f.refresh();
      assert.equal(privateArea(), null, `${status}: private data removed, not just hidden`);
      f.current.status = 200; f.current.malformed = false; f.current.missingAccount = false;
      await f.refresh();
      assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, `${status}: discarded files cannot reappear`);
    }
    const oldRequestDecode = await f.choose(true);
    await f.rerender('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    await oldRequestDecode();
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, 'late decode cannot enter another request');
    if (role === 'technician') {
      globalThis.createImageBitmap = async () => ({width:96, height:64, close(){}});
      await f.choose(); f.current.expert = accountB; await f.refresh();
      assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 0, 'new expert binding must not inherit files');
    }
  });
}

test('technician: a confirmed decline cancels focus reads so the declined job cannot reappear', async () => {
  const f = await mount('technician');
  f.current.state = 'review'; await f.refresh();
  const releasePost = f.deferPost();
  const decline = button('Decline request');
  await act(async () => decline.closest('form').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true})));
  await flush();
  assert.equal(f.current.posts.length, 1);
  const oldRead = f.deferRead(); await f.refresh();
  await releasePost();
  assert.ok(!privateArea());
  assert.equal(oldRead.aborted, true);
  const notice = [...document.querySelectorAll('[role=status]')].find(element => element.textContent.includes('You declined this request.'));
  assert.ok(notice && !concealed(notice), 'the confirmed decline remains visible');
  await oldRead.release();
  assert.ok(!privateArea(), 'a stale focus read cannot restore the declined job');
});

for (const receipt of [null, {}, {ok:true}, {stored:0}, {stored:1}, {stored:'2'}, {stored:2, unexpected:true}, [2]]) {
  test(`customer: malformed upload receipt ${JSON.stringify(receipt)} retains both files for exact retry`, async () => {
    const f = await mount('customer');
    await f.choose(); await f.choose();
    f.current.postData = receipt;
    await act(async () => f.save().click()); await flush();
    const retry = () => button('Check same action');
    assert.ok(retry(), 'an unsupported success body must not discard the only prepared copy');
    assert.equal(document.querySelectorAll('button[aria-label^="Remove photo"]').length, 2);
    f.current.requestPhotos = [1, 2]; f.current.photoStatus = 503;
    await f.refresh();
    assert.equal(document.querySelectorAll('input[type=file]').length, 0, 'manifest slots can replace the picker while the exact attempt remains recoverable');
    assert.ok(retry());
    f.current.postData = {stored:2};
    await act(async () => retry().click()); await flush();
    assert.equal(f.current.posts.length, 2);
    const [first, second] = f.current.posts;
    assert.equal(first.url, `/api/v1/care/journey/${id}/photos`);
    assert.equal(second.url, first.url, 'retry cannot create a new service request');
    assert.deepEqual(second.options.headers, first.options.headers);
    const bytes = post => Promise.all(post.options.body.getAll('photos').map(file => file.arrayBuffer()));
    assert.deepEqual(await bytes(second), await bytes(first));
    assert.equal(retry(), undefined);
  });
}

test('customer: partial immutable photo upload can be recovered after a reload without replacing the set or request', async () => {
  const objects = new Map(); let failSecond = true;
  const bucket = {
    async upload(path, bytes) {
      if (objects.has(path)) return {error:{message:'Already exists'}};
      if (path.endsWith('photo-2') && failSecond) return {error:{message:'Interrupted upload'}};
      objects.set(path, Buffer.from(bytes)); return {error:null};
    },
    async download(path) { return objects.has(path) ? {data:new Blob([objects.get(path)]), error:null} : {error:{message:'Object not found'}}; },
  };
  const prefix = `care-requests/${id}`;
  const photo = bytes => ({bytes:Buffer.from(bytes), mimeType:'image/jpeg', hash:createHash('sha256').update(Buffer.from(bytes)).digest('hex')});
  const originals = [photo(new Uint8Array(256).fill(1)), photo(new Uint8Array(256).fill(2))];
  await assert.rejects(storeCarePhotos(bucket, prefix, originals), error => error.code === 'UNAVAILABLE');
  const slots = JSON.parse(objects.get(`${prefix}/manifest.json`).toString()).map(entry => entry.slot);
  assert.deepEqual(slots, [1, 2], 'the actual immutable store writes the manifest before all images');
  assert.equal(objects.size, 2, 'only the manifest and first image survived');
  // A fresh mount has no previous in-memory files/attempt, only the server manifest slots.
  const f = await mount('customer', {requestPhotos:slots, photoStatus:503});
  const recover = button('Retry an interrupted photo upload');
  assert.ok(recover, 'manifest slots alone must not remove the only route to repair a partial upload');
  await act(async () => recover.click()); await flush();
  await f.choose();
  const release = await f.choose(true);
  await f.refresh(); await release();
  assert.equal(document.querySelectorAll('button[aria-label^="Remove photo"]').length, 2, 'recovery files survive focus too');
  failSecond = false;
  f.current.onPost = async options => {
    const photos = await Promise.all(options.body.getAll('photos').map(async file => photo(await file.arrayBuffer())));
    await storeCarePhotos(bucket, prefix, photos);
  };
  await act(async () => { f.save().click(); f.save().click(); }); await flush();
  assert.equal(f.current.posts.length, 1, 'repeated clicks send only one upload');
  assert.equal(f.current.posts[0].url, `/api/v1/care/journey/${id}/photos`);
  assert.equal(objects.size, 3, 'retry completes the original set without duplicating it');
  assert.deepEqual(objects.get(`${prefix}/photo-1`), originals[0].bytes);
  assert.deepEqual(objects.get(`${prefix}/photo-2`), originals[1].bytes);
  assert.equal(document.querySelectorAll('input[type=file]').length, 0, 'verified recovery closes the recovery picker');
  await assert.rejects(storeCarePhotos(bucket, prefix, [photo(new Uint8Array(256).fill(3))]), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(objects.size, 3, 'different bytes cannot replace the saved set');
});

test('customer: recovery drafts are cleared on an account change', async () => {
  const f = await mount('customer', {requestPhotos:[1]});
  assert.ok(button('Retry an interrupted photo upload'));
  await act(async () => button('Retry an interrupted photo upload').click()); await flush();
  const release = await f.choose(true);
  f.current.account = accountB; await f.refresh(); await release();
  assert.equal(document.querySelectorAll('input[type=file]').length, 0, 'a new account must explicitly enter its own recovery flow');
  await act(async () => button('Retry an interrupted photo upload').click()); await flush();
  assert.equal(document.querySelectorAll('button[aria-label^="Remove photo"]').length, 0);
  assert.equal(f.current.posts.length, 0);
});

for (const boundary of ['cancel', 'request', 'state']) {
  test(`customer: ${boundary} ends photo recovery without reviving a late decoder`, async () => {
    const f = await mount('customer', {requestPhotos:[1]});
    await act(async () => button('Retry an interrupted photo upload').click()); await flush();
    const release = await f.choose(true);
    if (boundary === 'cancel') { await act(async () => button('Cancel photo retry').click()); await flush(); }
    else if (boundary === 'request') await f.rerender('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    else { f.current.state = 'scheduled'; await f.refresh(); }
    await release();
    assert.equal(document.querySelectorAll('input[type=file]').length, 0);
    assert.equal(document.querySelectorAll('button[aria-label^="Remove photo"]').length, 0);
    if (boundary === 'state') assert.equal(button('Retry an interrupted photo upload'), undefined, 'closed journeys cannot offer unsupported partial repair');
    else {
      await act(async () => button('Retry an interrupted photo upload').click()); await flush();
      assert.equal(document.querySelector('input[type=file]').disabled, false);
      assert.equal(document.querySelectorAll('button[aria-label^="Remove photo"]').length, 0, 'reopening cannot revive the cancelled or previous-request decoder');
    }
    assert.equal(f.current.posts.length, 0);
  });
}

test('customer: saving service details does not discard selected request photos', async () => {
  const f = await mount('customer');
  await f.choose();
  const nativeFormData = globalThis.FormData;
  // Node FormData does not accept an HTML form; supply the browser constructor behavior.
  globalThis.FormData = class extends nativeFormData {
    constructor(form) { super(); if (form) for (const element of form.elements) if (element.name) this.append(element.name, element.value); }
  };
  try {
    const form = document.querySelector('input[name=name]').closest('form');
    await act(async () => form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))); await flush();
    assert.equal(f.current.posts.length, 1);
    assert.equal(JSON.parse(f.current.posts[0].options.body).action, 'update_details');
    assert.equal(document.querySelectorAll('button[aria-label="Remove photo 1"]').length, 1);
    assert.equal(f.save().disabled, false);
  } finally { globalThis.FormData = nativeFormData; }
});

test('customer: a closed-state photo rejection does not trigger or offer an uncertain retry loop', async () => {
  const f = await mount('customer', {requestPhotos:[1]});
  await act(async () => button('Retry an interrupted photo upload').click()); await flush();
  await f.choose();
  f.current.postStatus = 409;
  await act(async () => f.save().click()); await flush();
  assert.ok(document.querySelector('[role=alert]'));
  assert.equal(button('Check same action'), undefined);
  assert.equal(f.current.posts.length, 1);
  f.current.state = 'scheduled'; await f.refresh();
  assert.equal(button('Retry an interrupted photo upload'), undefined);
  assert.equal(document.querySelectorAll('input[type=file]').length, 0);
  assert.equal(f.current.posts.length, 1);
});

test('HEIC is rejected before decoding and is not advertised as supported', async () => {
  const f = await mount('customer');
  let decoded = false;
  globalThis.createImageBitmap = async () => { decoded = true; throw new Error('Should not decode an unsupported type'); };
  const input = document.querySelector('input[type=file]');
  assert.equal(input.accept, 'image/jpeg,image/png,image/webp');
  Object.defineProperty(input, 'files', {configurable:true, value:[new File([new Uint8Array(256)], 'camera.heic', {type:'image/heic'})]});
  await act(async () => input.dispatchEvent(new Event('change', {bubbles:true}))); await flush();
  assert.equal(decoded, false);
  assert.match(document.querySelector('[role=alert]').textContent, /Export HEIC photos as JPEG first/);
  assert.equal(f.current.posts.length, 0);
});

test('customer: unsaved service details survive focus and unrelated revision changes, but not another account', async () => {
  const f = await mount('customer');
  const name = () => document.querySelector('input[name=name]');
  name().value = 'Private unsaved name';
  for (const event of ['focus', 'pageshow', 'visibilitychange']) {
    f.current.revision++;
    await f.refresh(event);
    assert.equal(name().value, 'Private unsaved name');
  }
  f.current.account = accountB; await f.refresh();
  assert.equal(name().value, accountB);
});
