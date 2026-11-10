// Mounted production RequestStatus with controlled fetch responses.
// DOM lifecycle/state coverage, not browser, real account, or device acceptance.
// Run with HAPPY_DOM_MODULE pointing to happy-dom@20.8.4.
// STATUS_TEST_BASELINE=9cd560e reproduces the regressions against the original source.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
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
  const source = process.env.STATUS_TEST_BASELINE
    ? execFileSync('git', ['show', `${process.env.STATUS_TEST_BASELINE}:${filename.slice(rootDirectory.length + 1)}`], {encoding:'utf8'})
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
const {default: RequestStatus} = componentModule(resolve('src/app/care/requests/[id]/request-status.tsx'));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const storedKey = requestId => `skycar:care-retry:v1:${requestId}`;
const receipt = (requestId = id, changes = {}) => ({
  id:requestId, vehicle_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', service:'repair',
  description:`Private request ${requestId}`, preferred_window:'flexible',
  quote_state:'in_review', assignment_state:'none', fulfilment_state:null, money_state:null,
  customer_stage:'no_match', next_action:'choose_recovery', responsible_role:'customer',
  created_at:'2026-11-01T00:00:00Z', updated_at:'2026-11-01T00:00:00Z', next_update_at:null, events:[], ...changes,
});
const reopened = requestId => receipt(requestId, {customer_stage:'request_received', next_action:'review_request', responsible_role:'operations'});
const response = (value, retry = false) => new Response(JSON.stringify({data:retry ? {request:value, replayed:false} : value}));
const denied = status => new Response(JSON.stringify({error:{code:'FORBIDDEN'}}), {status});
const button = name => [...document.querySelectorAll('button')].find(element => element.textContent === name);
const displayed = description => document.body.textContent.includes(description);
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
let root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; document.body.replaceChildren();
  if (storageDescriptor) Object.defineProperty(window, 'sessionStorage', storageDescriptor);
  else delete window.sessionStorage;
  window.sessionStorage.clear();
});
async function mount({initial = receipt(), strict = false, beforeMount} = {}) {
  const reads = [], posts = [], queued = [];
  let current = initial;
  beforeMount?.();
  globalThis.fetch = async (url, options) => {
    const call = {url, options};
    (options.method === 'POST' ? posts : reads).push(call);
    if (queued.length) return queued.shift()(call);
    return response(current, options.method === 'POST');
  };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const render = requestId => {
    const view = React.createElement(RequestStatus, {id:requestId});
    root.render(strict ? React.createElement(React.StrictMode, {}, view) : view);
  };
  await act(async () => render(initial.id)); await flush();
  function hold() {
    let release, fail, call;
    const pending = new Promise((resolve, reject) => { release = resolve; fail = reject; });
    queued.push(c => { call = c; return pending; });
    return {
      get aborted() { return call?.options.signal.aborted; },
      rejectWhenAborted() { call.options.signal.addEventListener('abort', () => fail(new DOMException('Aborted', 'AbortError')), {once:true}); },
      release:async value => { await act(async () => release(value)); await flush(); },
      fail:async () => { await act(async () => fail(new Error('Lost response'))); await flush(); },
    };
  }
  return {
    reads, posts, hold,
    next:value => queued.push(() => typeof value === 'function' ? value() : value),
    set:value => { current = value; },
    click:async name => { const target = button(name); assert.ok(target, `${name} exists`); await act(async () => target.click()); await flush(); },
    refresh:async (event = 'focus') => { await act(async () => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event))); await flush(); },
    rerender:async (requestId, value = receipt(requestId)) => { current = value; await act(async () => render(requestId)); await flush(); },
  };
}

for (const operation of ['Refresh status', 'Ask for another review']) {
  for (const outcome of ['success', 'denial', 'network']) {
    test(`${operation}: late ${outcome} cannot replace another request or alter its recovery`, async () => {
      const f = await mount();
      const old = f.hold(); await f.click(operation);
      await f.rerender(otherId);
      assert.equal(displayed(receipt().description), false, 'old private receipt is removed on request change');
      assert.equal(displayed(receipt(otherId).description), true);
      // A different request must not inherit a former request's lock or retry key.
      f.next(() => Promise.reject(new Error('Replacement response lost')));
      await f.click('Ask for another review');
      const replacementKey = JSON.parse(window.sessionStorage.getItem(storedKey(otherId)) ?? 'null')?.idempotency_key;
      assert.ok(replacementKey, 'the replacement request can start its own recovery immediately');
      if (outcome === 'success') await old.release(response(reopened(id), operation !== 'Refresh status'));
      else if (outcome === 'denial') await old.release(denied(403));
      else await old.fail();
      assert.equal(displayed(receipt().description), false, 'a stale response cannot restore former private details');
      assert.equal(displayed(receipt(otherId).description), true);
      assert.equal(JSON.parse(window.sessionStorage.getItem(storedKey(otherId))).idempotency_key, replacementKey);
      assert.match(document.body.textContent, /Reopening has not been confirmed/);
      assert.equal(button('Refresh status').disabled, false);
    });
  }
}

test('request changes hide old details before the replacement read completes', async () => {
  const f = await mount();
  const next = f.hold(); await f.rerender(otherId);
  assert.equal(displayed(receipt().description), false);
  assert.equal(!!document.querySelector('#current-status'), false);
  await next.release(response(receipt(otherId)));
  assert.equal(displayed(receipt(otherId).description), true);
});

for (const event of ['focus', 'pageshow', 'visibilitychange']) {
  test(`${event}: interrupted retry remains recoverable with its exact key before the old POST settles`, async () => {
    const f = await mount();
    const old = f.hold(); await f.click('Ask for another review');
    const key = f.posts[0].options.headers['Idempotency-Key'];
    await f.refresh(event);
    assert.match(document.body.textContent, /Reopening has not been confirmed/);
    assert.ok(button('Check reopening') && !button('Check reopening').disabled);
    f.next(response(reopened(id), true)); await f.click('Check reopening');
    assert.equal(f.posts.length, 2, 'superseded POST cannot keep the recovery action locked');
    assert.equal(f.posts[1].options.headers['Idempotency-Key'], key);
    assert.equal(f.posts[1].options.body, f.posts[0].options.body);
    assert.equal(window.sessionStorage.getItem(storedKey(id)), null);
    assert.equal(old.aborted, true, 'lifecycle read cancels the superseded transport');
    await old.release(response(receipt(), true));
    assert.equal(document.querySelector('#current-status').textContent, 'We have your request');
    assert.equal(!!button('Check reopening'), false);
  });
}

for (const status of [400, 401, 403, 404]) {
  test(`denied ${status} revalidation clears private data and recovery despite a late POST`, async () => {
    const f = await mount();
    const old = f.hold(); await f.click('Ask for another review');
    f.next(denied(status)); await f.refresh();
    assert.equal(displayed(receipt().description), false);
    assert.equal(window.sessionStorage.getItem(storedKey(id)), null);
    await old.release(response(reopened(id), true));
    assert.equal(displayed(receipt().description), false);
    assert.equal(!!button('Check reopening'), false);
    assert.equal(button('Refresh status').disabled, false);
  });
}

test('newer lifecycle response wins even when an aborted earlier read completes late', async () => {
  const f = await mount();
  const old = f.hold(); await f.refresh();
  f.set(reopened(id)); await f.refresh('pageshow');
  assert.equal(old.aborted, true);
  await old.release(response(receipt()));
  assert.equal(document.querySelector('#current-status').textContent, 'We have your request');
});

test('manual refresh labels network failure stale and clears that warning after verified recovery', async () => {
  const f = await mount();
  f.next(() => Promise.reject(new Error('Offline'))); await f.click('Refresh status');
  assert.equal(displayed(receipt().description), true);
  assert.match(document.querySelector('[role=alert]').textContent, /may have changed/);
  await f.refresh();
  assert.equal(!!document.querySelector('[role=alert]'), false);
});

test('focus failure hides private data but retains an exact pending retry across reload', async () => {
  const f = await mount();
  f.next(() => Promise.reject(new Error('Lost write response'))); await f.click('Ask for another review');
  const key = f.posts[0].options.headers['Idempotency-Key'];
  f.next(denied(503)); await f.refresh();
  assert.equal(displayed(receipt().description), false);
  assert.ok(button('Check reopening'));
  await act(async () => root.unmount()); root = null;
  const reloaded = await mount();
  assert.ok(button('Check reopening'));
  reloaded.next(response(reopened(id), true)); await reloaded.click('Check reopening');
  assert.equal(reloaded.posts[0].options.headers['Idempotency-Key'], key);
  assert.equal(window.sessionStorage.getItem(storedKey(id)), null);
});

test('recovered retry metadata is scoped to the request and never persisted with private details', async () => {
  const f = await mount();
  f.next(() => Promise.reject(new Error('Lost write response'))); await f.click('Ask for another review');
  const saved = JSON.parse(window.sessionStorage.getItem(storedKey(id)));
  assert.deepEqual(Object.keys(saved).sort(), ['idempotency_key', 'request_id', 'started_at', 'v']);
  await f.rerender(otherId);
  assert.equal(!!button('Check reopening'), false);
  assert.doesNotMatch(document.body.textContent, /Reopening has not been confirmed/);
  assert.ok(window.sessionStorage.getItem(storedKey(id)), 'an unresolved attempt remains recoverable when returning to its request');
  await f.rerender(id);
  assert.ok(button('Check reopening'));
});

test('unmounted read completion cannot remove retry metadata needed on return', async () => {
  const f = await mount();
  f.next(() => Promise.reject(new Error('Lost write response'))); await f.click('Ask for another review');
  const saved = window.sessionStorage.getItem(storedKey(id));
  const old = f.hold(); await f.click('Refresh status');
  await act(async () => root.unmount()); root = null;
  await old.release(response(reopened(id)));
  assert.equal(window.sessionStorage.getItem(storedKey(id)), saved);
  assert.equal(old.aborted, true);
});

test('StrictMode cleanup prevents the discarded mount from starting another request', async () => {
  const f = await mount({strict:true});
  assert.equal(f.reads.length, 1);
  assert.equal(button('Refresh status').disabled, false);
});

test('duplicate reopening clicks send one request with a stable recovery key', async () => {
  const f = await mount(); const pending = f.hold();
  const target = button('Ask for another review');
  await act(async () => { target.click(); target.click(); }); await flush();
  assert.equal(f.posts.length, 1);
  await pending.release(response(reopened(id), true));
  assert.equal(!!button('Ask for another review'), false);
});

test('a ready quote assigns its next action to the customer, not stale request ownership', async () => {
  await mount({initial:receipt(id, {quote_state:'issued', responsible_role:'operations', next_action:'review_request'})});
  const owner = [...document.querySelectorAll('dt')].find(element => element.textContent === 'Next action owner');
  assert.equal(owner.nextElementSibling.textContent, 'You');
  assert.equal(document.querySelector('a[href^="/care/journey/"]').textContent, 'Review quotes');
});

for (const [label, changes, owner] of [
  ['appointment request', {quote_state:'accepted', assignment_state:'reserved'}, 'Skycar availability team'],
  ['confirmed appointment', {quote_state:'accepted', assignment_state:'accepted', fulfilment_state:'scheduled'}, null],
  ['work in progress', {quote_state:'accepted', assignment_state:'accepted', fulfilment_state:'in_progress'}, null],
  ['completed service', {quote_state:'accepted', assignment_state:'accepted', fulfilment_state:'completed'}, null],
  ['cancelled journey', {quote_state:'declined', assignment_state:'cancelled'}, null],
]) {
  test(`${label}: current ownership is shown only when known, not inferred from the original request`, async () => {
    await mount({initial:receipt(id, {...changes, responsible_role:'customer'})});
    const term = [...document.querySelectorAll('dt')].find(element => element.textContent === 'Next action owner');
    assert.equal(term?.nextElementSibling.textContent ?? null, owner);
  });
}

test('a confirmed replay now at no_match resolves the old attempt and allows a fresh explicit review', async () => {
  const f = await mount();
  f.next(() => Promise.reject(new Error('Lost write response'))); await f.click('Ask for another review');
  const originalKey = f.posts[0].options.headers['Idempotency-Key'];
  f.next(new Response(JSON.stringify({data:{request:receipt(), replayed:true}}))); await f.click('Check reopening');
  assert.equal(f.posts[1].options.headers['Idempotency-Key'], originalKey);
  assert.equal(window.sessionStorage.getItem(storedKey(id)), null);
  assert.equal(!!button('Check reopening'), false);
  assert.equal(f.posts.length, 2, 'a confirmed replay never starts a new attempt automatically');
  f.next(response(reopened(id), true)); await f.click('Ask for another review');
  assert.notEqual(f.posts[2].options.headers['Idempotency-Key'], originalKey);
});

for (const [label, envelope] of [
  ['missing replay flag', {request:reopened(id)}],
  ['string replay flag', {request:reopened(id), replayed:'true'}],
  ['unexpected envelope field', {request:reopened(id), replayed:true, future:true}],
  ['wrong request', {request:reopened(otherId), replayed:true}],
  ['malformed receipt', {request:{id}, replayed:false}],
]) {
  test(`${label}: an unverified retry response preserves the same attempt for explicit recovery`, async () => {
    const f = await mount();
    f.next(new Response(JSON.stringify({data:envelope}))); await f.click('Ask for another review');
    assert.match(document.body.textContent, /Reopening has not been confirmed/);
    assert.equal(displayed(receipt(otherId).description), false);
    assert.equal(JSON.parse(window.sessionStorage.getItem(storedKey(id))).idempotency_key, f.posts[0].options.headers['Idempotency-Key']);
    f.next(response(reopened(id), true)); await f.click('Check reopening');
    assert.equal(f.posts[1].options.headers['Idempotency-Key'], f.posts[0].options.headers['Idempotency-Key']);
  });
}

for (const failure of ['property access', 'quota']) {
  test(`blocked storage ${failure} still verifies status and preserves in-memory exact retry`, async () => {
    const f = await mount({beforeMount:() => {
      if (failure === 'property access') Object.defineProperty(window, 'sessionStorage', {configurable:true, get(){ throw new Error('Storage access denied'); }});
      else Object.defineProperty(window, 'sessionStorage', {configurable:true, value:{getItem:() => null, setItem(){ throw new Error('Storage quota exhausted'); }, removeItem(){}}});
    }});
    assert.equal(displayed(receipt().description), true);
    f.next(() => Promise.reject(new Error('Lost write response'))); await f.click('Ask for another review');
    assert.match(document.body.textContent, /Keep this page open so the same attempt can be reused/);
    f.next(response(reopened(id), true)); await f.click('Check reopening');
    assert.equal(f.posts[1].options.headers['Idempotency-Key'], f.posts[0].options.headers['Idempotency-Key']);
    assert.equal(!!button('Check reopening'), false);
  });
}

for (const operation of ['Refresh status', 'Ask for another review']) {
  test(`${operation}: old successful response cannot restore its receipt after navigating to another request`, async () => {
    const f = await mount(); const old = f.hold(); await f.click(operation);
    await f.rerender(otherId);
    await old.release(response(reopened(id), operation !== 'Refresh status'));
    assert.equal(displayed(receipt().description), false);
    assert.equal(displayed(receipt(otherId).description), true);
    assert.equal(document.querySelector('#current-status').textContent, 'No match yet');
  });
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`a definitive ${status} retry response resolves the attempt and redacts access loss`, async () => {
    const f = await mount();
    f.next(denied(status)); await f.click('Ask for another review');
    assert.equal(window.sessionStorage.getItem(storedKey(id)), null);
    assert.doesNotMatch(document.body.textContent, /Reopening has not been confirmed/);
    assert.equal(displayed(receipt().description), [409, 422].includes(status));
    if ([409, 422].includes(status)) assert.equal(button('Ask for another review').disabled, true, 'refresh must verify a changed request before another review');
    assert.equal(button('Refresh status').disabled, false);
  });
}

test('transport abort rejection cannot end the newer read or lose its pending retry', async () => {
  const f = await mount(); const old = f.hold(); await f.click('Ask for another review');
  old.rejectWhenAborted(); const read = f.hold(); await f.refresh();
  assert.equal(old.aborted, true);
  assert.equal(button('Refresh status').disabled, true, 'the replacement read is still pending');
  assert.equal(displayed(receipt().description), false);
  await read.release(response(receipt()));
  assert.equal(!!document.querySelector('[role=alert]'), false);
  assert.match(document.body.textContent, /Reopening has not been confirmed/);
  f.next(response(reopened(id), true)); await f.click('Check reopening');
  assert.equal(f.posts[1].options.headers['Idempotency-Key'], f.posts[0].options.headers['Idempotency-Key']);
});
