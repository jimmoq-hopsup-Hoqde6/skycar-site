import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetCheckedPostcode, readCheckedPostcode, rememberCheckedPostcode } from '../../src/features/care/checked-postcode.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function withStorage(storage, run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { sessionStorage: storage }, configurable: true });
  try { run(); } finally { saved ? Object.defineProperty(globalThis, 'window', saved) : delete globalThis.window; }
}
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: k => void map.delete(k), map }; };

test('a checked postcode is carried per request id and dropped when forgotten', () => {
  const store = memory();
  withStorage(store, () => {
    rememberCheckedPostcode(ID, ' 5000 ');
    assert.equal(readCheckedPostcode(ID), '5000');
    assert.equal(readCheckedPostcode(OTHER), '', 'another request never sees it');
    assert.equal(readCheckedPostcode(ID.toUpperCase()), '5000', 'ids compare case-insensitively');
    forgetCheckedPostcode(ID);
    assert.equal(readCheckedPostcode(ID), '');
    assert.equal(store.map.size, 0);
  });
});

test('only a 4-digit postcode for a real request id is stored or read back', () => {
  const store = memory();
  withStorage(store, () => {
    for (const bad of ['', '50', '50000', 'abcd', '5 000', '5000; drop']) rememberCheckedPostcode(ID, bad);
    rememberCheckedPostcode('not-an-id', '5000');
    assert.equal(store.map.size, 0);
    store.setItem(`skycar:checked-postcode:${ID}`, '<script>');
    assert.equal(readCheckedPostcode(ID), '', 'a tampered stored value is ignored');
    assert.equal(readCheckedPostcode('not-an-id'), '');
  });
});

test('unavailable or throwing storage never throws and yields an empty suggestion', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  withStorage(broken, () => {
    assert.doesNotThrow(() => rememberCheckedPostcode(ID, '5000'));
    assert.equal(readCheckedPostcode(ID), '');
    assert.doesNotThrow(() => forgetCheckedPostcode(ID));
  });
  assert.equal(readCheckedPostcode(ID), '', 'no window at all (server render)');
  assert.doesNotThrow(() => rememberCheckedPostcode(ID, '5000'));
});
