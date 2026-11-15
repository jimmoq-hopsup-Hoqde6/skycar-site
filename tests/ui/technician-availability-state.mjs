// Socket-free mounted React regression. Run with HAPPY_DOM_MODULE pointing to a
// locally installed happy-dom package (verified with 20.8.4); the separate Playwright test covers browsers.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as availabilityDomain from '../../src/domain/technician/availability.mjs';

const {Window} = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
const window = new Window({url: 'http://localhost/technician/availability'});
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'Node']) {
  Object.defineProperty(globalThis, name, {configurable: true, value: name === 'window' ? window : window[name]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const {createRoot} = require('react-dom/client');
const {act} = React;
function compile(source, imports = {}) {
  const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true}});
  const compiled = {exports: {}};
  vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`)(name => name in imports ? imports[name] : name.endsWith('.css') ? {} : require(name), compiled, compiled.exports);
  return compiled.exports;
}
const journey = compile(await readFile(new URL('../../src/features/care/journey/types.ts', import.meta.url), 'utf8'));
const componentFile = process.env.AVAILABILITY_COMPONENT || new URL('../../src/features/technician/availability.tsx', import.meta.url);
const {TechnicianAvailability} = compile(await readFile(componentFile, 'utf8'), {'next/link': 'a', '@/features/care/journey/types': journey, '@/domain/technician/availability.mjs': availabilityDomain});
const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fresh = (revision = 3, starts_at = '09:00') => ({revision, timezone: 'Australia/Adelaide', weekly_windows: [{weekday: 1, starts_at, ends_at: '17:00'}], exceptions: [], evaluated_at: new Date().toISOString()});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
let account = accountA, schedule = fresh(), readStatus = 0, writeMode = 'success', nextReadGate, nextWriteGate, reads = 0;
const writes = [], errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, '/api/v1/technician/availability');
  if (!options.method) {
    reads += 1;
    if (readStatus === 'network') throw new Error('Synthetic network failure');
    if (readStatus === 'malformed-json') return new Response('invalid-json', {headers: {'X-Skycar-Account': account}});
    const result = new Response(JSON.stringify(readStatus ? {error: {message: 'Technician access unavailable', retryable: false}} : {data: structuredClone(schedule)}), {status: readStatus || 200, headers: {'X-Skycar-Account': account}});
    const gate = nextReadGate; nextReadGate = undefined;
    if (gate) { gate.started.resolve(); await gate.release.promise; }
    return result;
  }
  assert.equal(options.method, 'PUT');
  const body = JSON.parse(options.body), mode = writeMode, originalAccount = account;
  writes.push({body, key: options.headers['Idempotency-Key'], account: options.headers['X-Skycar-Account']});
  const gate = nextWriteGate; nextWriteGate = undefined;
  if (gate) { gate.started.resolve(); await gate.release.promise; }
  if (typeof mode === 'number') return new Response(JSON.stringify({error: {message: 'Technician access unavailable', retryable: false}}), {status: mode});
  if (mode === 'conflict') {
    schedule = fresh(schedule.revision + 1, '08:30');
    return new Response(JSON.stringify({error: {message: 'Refresh the saved hours before replacing them.', retryable: false}}), {status: 409});
  }
  const revision = body.expected_revision + 1;
  if (account === originalAccount && mode !== 'replay') schedule = {...body, revision, evaluated_at: new Date().toISOString()};
  delete schedule.expected_revision;
  if (mode === 'lost') throw new Error('Synthetic response loss');
  return new Response(JSON.stringify({data: {revision, replayed: mode === 'replay'}}), {headers: {'X-Skycar-Account': mode === 'changed' ? accountB : originalAccount}});
};
const host = document.createElement('div'); document.body.append(host);
let root;
const text = () => host.textContent;
const button = name => [...host.querySelectorAll('button')].find(node => node.textContent === name);
const monday = () => [...host.querySelectorAll('.availability-day')].find(node => node.querySelector('h3')?.textContent === 'Monday');
const starts = () => monday()?.querySelector('input[type=time]');
const flush = async action => act(async () => { await action?.(); await Promise.resolve(); });
const click = async name => { const node = button(name); assert.ok(node, `button ${name} exists`); assert.equal(node.disabled, false, `${name} is usable`); await flush(() => node.click()); };
const fill = async (node, value) => {
  assert.ok(node, 'editor exists');
  await flush(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
};
const trigger = async (event = 'focus') => flush(() => {
  if (event === 'visibilitychange') {
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    document.dispatchEvent(new window.Event(event));
  } else window.dispatchEvent(new window.Event(event));
});
const mount = async () => {
  if (root) await flush(() => root.unmount());
  account = accountA; schedule = fresh(); readStatus = 0; writeMode = 'success';
  root = createRoot(host);
  await flush(() => root.render(React.createElement(TechnicianAvailability)));
  assert.equal(starts()?.value, '09:00', 'initial schedule is mounted');
};
const refresh = async (accept = true) => { window.confirm = () => accept; await click('Refresh'); };
try {
  await mount();
  await fill(starts(), '10:15');
  await click('Add a date');
  const date = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
  await fill(host.querySelector('input[type=date]'), date);
  const originalNode = starts();
  for (const event of ['focus', 'pageshow', 'visibilitychange']) {
    await trigger(event);
    assert.equal(starts().value, '10:15', `${event} must preserve unsaved weekly hours`);
    assert.equal(host.querySelector('input[type=date]')?.value, date, `${event} preserves unsaved dated exceptions`);
    assert.equal(starts(), originalNode, 'background verification keeps the editor mounted');
  }
  const beforeCancel = reads;
  await refresh(false);
  assert.equal(reads, beforeCancel);
  assert.equal(starts().value, '10:15');
  await refresh();
  assert.equal(starts().value, '09:00');
  assert.equal(host.querySelector('input[type=date]'), null);

  // Preserve incomplete exceptions, every exception field, and add/remove edits.
  await click('Add a date'); await trigger();
  assert.equal(host.querySelector('input[type=date]').value, '');
  await fill(host.querySelector('input[type=date]'), date);
  await flush(() => host.querySelector('input[type=checkbox]').click());
  const exception = host.querySelector('input[type=date]').closest('.availability-day');
  const exceptionTimes = exception.querySelectorAll('input[type=time]');
  await fill(exceptionTimes[0], '11:30'); await fill(exceptionTimes[1], '15:45');
  for (const select of exception.querySelectorAll('select')) await flush(() => {
    select.value = '+09:30'; select.dispatchEvent(new window.Event('change', {bubbles: true}));
  });
  await trigger();
  assert.equal(exceptionTimes[0].value, '11:30'); assert.equal(exceptionTimes[1].value, '15:45');
  assert.equal(exception.querySelector('input[type=checkbox]').checked, false);
  assert.deepEqual([...exception.querySelectorAll('select')].map(node => node.value), ['+09:30', '+09:30']);
  await click('Remove date'); await click('Remove'); await trigger();
  assert.equal(starts(), null); assert.equal(host.querySelector('input[type=date]'), null);
  await click('Add hours'); await trigger(); assert.equal(starts().value, '09:00');
  await refresh();

  // Duplicate focus events must not cancel a confirmed explicit replacement.
  await fill(starts(), '10:30');
  const replacement = {started: deferred(), release: deferred()}; nextReadGate = replacement;
  await refresh(); await replacement.started.promise;
  assert.equal(host.querySelector('form').hidden, true, 'private editor is hidden during revalidation');
  await trigger();
  assert.equal(starts().value, '09:00', 'superseding focus read keeps confirmed discard intent');
  await flush(() => replacement.release.resolve());

  for (const failure of [503, 'network']) {
    await fill(starts(), '10:30'); readStatus = failure; await trigger();
    assert.equal(starts().value, '10:30', 'transient read failures retain current-account edits privately');
    assert.equal(host.querySelector('form').hidden, true, `${failure} keeps the draft hidden until verified`);
    assert.equal(host.querySelector('fieldset').disabled, true, `${failure} keeps editing disabled`);
    assert.equal(button('Save hours').disabled, true, `${failure} cannot authorize saving`);
    const beforeSubmit = writes.length;
    await flush(() => host.querySelector('form').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})));
    assert.equal(writes.length, beforeSubmit, 'programmatic submit cannot bypass failed revalidation');
    readStatus = 0; await refresh();
    assert.equal(host.querySelector('form').hidden, false);
    assert.equal(starts().value, '10:30', 'retrying access verification retains the unsaved draft');
    await refresh();
    assert.equal(starts().value, '09:00', 'a later explicit refresh still confirms discard');
  }

  schedule = fresh(4, '08:00'); await trigger();
  assert.equal(starts().value, '08:00', 'clean editor receives fresh server hours');
  await fill(starts(), '10:00');
  schedule = fresh(5, '07:00'); await trigger();
  assert.equal(starts().value, '10:00');
  assert.match(text(), /Your edits are kept with revision 4/);
  assert.equal(button('Save hours').disabled, true);
  assert.equal(writes.length, 0);
  await refresh();
  await fill(starts(), '10:00'); writeMode = 'conflict';
  await click('Save hours');
  assert.equal(writes.at(-1).body.expected_revision, 5);
  assert.equal(starts().value, '10:00', '409 keeps the rejected draft');
  assert.equal(button('Save hours').disabled, true);
  await trigger(); assert.equal(starts().value, '10:00');
  await refresh(); assert.equal(starts().value, '08:30');

  await fill(starts(), '11:00'); writeMode = 'lost';
  await click('Save hours');
  assert.match(text(), /last save has not been confirmed/);
  assert.equal(host.querySelector('fieldset').disabled, true);
  const lost = writes.at(-1);
  await trigger(); assert.equal(starts().value, '11:00');
  readStatus = 503; await trigger();
  assert.equal(host.querySelector('form').hidden, true);
  assert.equal(button('Retry the same hours').disabled, true, 'uncertain retries require verified access too');
  const beforeRetry = writes.length;
  await flush(() => host.querySelector('form').dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true})));
  assert.equal(writes.length, beforeRetry);
  readStatus = 0; await trigger();
  writeMode = 'replay'; await click('Retry the same hours');
  assert.deepEqual(writes.at(-1), lost, 'retry preserves exact key, body and account');
  assert.match(text(), /same hours were already saved/);
  assert.equal(host.querySelector('fieldset').disabled, false);

  await mount(); await fill(starts(), '12:00');
  const saving = {started: deferred(), release: deferred()}; nextWriteGate = saving;
  await click('Save hours'); await saving.started.promise;
  await trigger();
  await flush(() => saving.release.resolve());
  assert.match(text(), /Hours saved. Confirmed jobs are unchanged/);
  assert.equal(starts().value, '12:00', 'focus read does not invalidate a save in flight');

  await fill(starts(), '13:15');
  const oldWrite = {started: deferred(), release: deferred()}; nextWriteGate = oldWrite;
  await click('Save hours'); await oldWrite.started.promise;
  account = accountB; schedule = fresh(20, '06:00'); await trigger();
  assert.equal(starts().value, '06:00', 'changed account never inherits the old draft');
  await flush(() => oldWrite.release.resolve());
  assert.equal(starts().value, '06:00', 'old write completion cannot modify new account');
  assert.doesNotMatch(text(), /Hours saved. Confirmed jobs are unchanged/);

  for (const denial of [401, 403, 404]) {
    await mount(); await fill(starts(), '13:15'); await click('Add a date');
    readStatus = denial; await trigger();
    assert.equal(host.querySelector('form'), null, `${denial} revalidation erases private editor`);
    assert.doesNotMatch(text(), /last save has not been confirmed|unsaved hours/);
  }
  for (const denial of [401, 403, 404, 'changed']) {
    await mount(); await fill(starts(), '13:15'); writeMode = denial;
    await click('Save hours');
    assert.equal(host.querySelector('form'), null, `${denial} write erases private editor`);
  }
  await mount(); await fill(starts(), '13:15'); writeMode = 'lost'; await click('Save hours');
  account = accountB; schedule = fresh(20, '06:00'); await trigger();
  assert.equal(starts().value, '06:00');
  assert.equal(button('Retry the same hours'), undefined, 'new account cannot retry an old account command');
  assert.equal(host.querySelector('fieldset').disabled, false);

  for (const malformed of ['schedule', 'malformed-json']) {
    await mount(); await fill(starts(), '13:15');
    if (malformed === 'schedule') schedule = {}; else readStatus = malformed;
    await trigger();
    assert.equal(host.querySelector('form'), null, `${malformed} success response fails closed and clears private state`);
    readStatus = 0; schedule = fresh(); await trigger();
    assert.equal(starts().value, '09:00', 'malformed response cannot resurrect the old draft');
  }
  await mount(); await fill(starts(), '13:15'); account = 'unverified'; await trigger();
  assert.equal(host.querySelector('form'), null, 'unverified account header erases private editor');
  await mount(); await fill(starts(), '13:15'); account = accountB; schedule = {}; await trigger();
  assert.equal(host.querySelector('form'), null, 'account switch clears old draft even if new schedule is malformed');

  // A mistaken fall-back offset is a correctable edit, never an uncertain write.
  await mount(); await click('Add a date');
  let fallBackDate;
  for (let day = 1; day <= 540; day++) {
    const candidate = availabilityDomain.adelaideToday(new Date(Date.now() + day * 86400000));
    if (availabilityDomain.adelaideBoundaryOk(candidate, '02:30', '+09:30')
      && availabilityDomain.adelaideBoundaryOk(candidate, '02:30', '+10:30')) { fallBackDate = candidate; break; }
  }
  assert.ok(fallBackDate, 'a repeated Adelaide hour exists inside the editing horizon');
  await fill(host.querySelector('input[type=date]'), fallBackDate);
  await flush(() => host.querySelector('input[type=checkbox]').click());
  const datedRow = host.querySelector('input[type=date]').closest('.availability-day');
  const datedTimes = datedRow.querySelectorAll('input[type=time]');
  await fill(datedTimes[0], '02:30'); await fill(datedTimes[1], '02:45');
  const offsets = datedRow.querySelectorAll('select');
  const offset = async (select, value) => flush(() => {
    select.value = value; select.dispatchEvent(new window.Event('change', {bubbles: true}));
  });
  await offset(offsets[0], '+09:30'); await offset(offsets[1], '+10:30');
  const beforeInvalidDst = writes.length;
  await click('Save hours');
  assert.equal(writes.length, beforeInvalidDst, 'inverted DST window is rejected before PUT');
  assert.match(host.querySelector('[role=alert]').textContent, /end must be after the start/);
  assert.equal(host.querySelector('fieldset').disabled, false, 'invalid hours remain editable');
  assert.equal(button('Retry the same hours'), undefined, 'invalid hours do not freeze an exact retry');
  await offset(offsets[1], '+09:30');
  await click('Save hours');
  assert.equal(writes.length, beforeInvalidDst + 1, 'correcting the offset can save normally');
  assert.equal(writes.at(-1).body.exceptions[0].windows[0].ends_at_offset, '+09:30');
  assert.match(text(), /Hours saved. Confirmed jobs are unchanged/);

  await mount(); await fill(starts(), '13:15'); writeMode = 403;
  const denied = {started: deferred(), release: deferred()}; nextWriteGate = denied;
  await click('Save hours'); await denied.started.promise;
  const oldRead = {started: deferred(), release: deferred()}; nextReadGate = oldRead;
  await trigger(); await oldRead.started.promise;
  await flush(() => denied.release.resolve());
  assert.equal(host.querySelector('form'), null);
  await flush(() => oldRead.release.resolve());
  assert.equal(host.querySelector('form'), null, 'late GET cannot resurrect a draft after access denial');
  assert.deepEqual(errors, [], 'no React or DOM errors');
  console.log('PASS: mounted availability focus/pageshow/visibility edits, explicit refresh, revisions/409, exact retry, concurrent reads/writes, changed-account and denied-access privacy.');
} finally {
  await flush(() => root?.unmount());
  console.error = originalError;
  await window.happyDOM.close();
}
