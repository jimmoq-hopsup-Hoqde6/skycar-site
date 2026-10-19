import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutInterface, customerMoneyView, webhookInterface } from './payment-scenarios.interfaces.mjs';
const raw = new TextEncoder().encode('synthetic test bytes');
const event = { id: 'evt_fixture', version: 'skycar-mock-v1', account: 'fixture-account', livemode: false,
  type: 'capture.succeeded', objectId: 'attempt_fixture', amountCents: 63250, currency: 'AUD' };
const invoke = (override = {}, commit = async () => 'committed') => webhookInterface(raw, { verify: async () => ({ ...event, ...override }), commit });
for (const mode of [undefined, 'mock', 'sandbox', 'live']) test(`checkout cannot move money in ${mode}`, () => {
  assert.equal(checkoutInterface({ authorized: true, mode }).code, 'PAYMENT_CONFIGURATION_UNAVAILABLE');
});
test('unauthorized requests reveal no payment state', () => assert.deepEqual(checkoutInterface(), { status: 404, code: 'NOT_FOUND' }));
test('client amount override rejected', () => assert.equal(checkoutInterface({ authorized: true, body: { amountCents: 1 } }).status, 400));
test('interrupted checkout stays pending and cannot create a new payment', () => assert.deepEqual(customerMoneyView({ state: 'checkout_pending' }), { state: 'checkout_pending', label: 'Payment confirmation pending', canPay: false }));
test('customer projection excludes secrets and technician payout', () => assert.deepEqual(Object.keys(customerMoneyView({ state: 'captured', clientSecret: 'fixture', payout: 50000 })), ['state', 'label', 'canPay']));
test('unknown state cannot become success', () => assert.throws(() => customerMoneyView({ state: 'browser_success' })));
test('oversized payload never reaches verification', async () => {
  const r = await webhookInterface(raw, { maxBytes: 1, verify: () => assert.fail('verification called') });
  assert.equal(r.status, 413);
});
test('verification receives original bytes; signature failure never reaches storage', async () => {
  const r = await webhookInterface(raw, { verify: bytes => { assert.equal(bytes, raw); throw Error('secret'); }, commit: () => assert.fail('storage called') });
  assert.deepEqual(r, { status: 400, code: 'INVALID_SIGNATURE' });
});
for (const override of [{ livemode: true }, { account: 'foreign' }, { version: 'unknown' }, { amountCents: 0 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 }, { currency: 'USD' }, { objectId: '' }]) {
  test(`invalid event rejected ${JSON.stringify(override)}`, async () => assert.equal((await invoke(override, () => assert.fail('storage called'))).status, 400));
}
test('unsupported verified event is ignored without storage', async () => assert.equal((await invoke({ type: 'unknown' }, () => assert.fail('storage called'))).code, 'IGNORED'));
for (const outcome of ['committed', 'duplicate', 'reconciliation_recorded']) test(`acknowledges durable outcome ${outcome}`, async () => {
  assert.equal((await invoke({}, async record => { assert.equal(record.amountCents, 63250); assert.ok(Object.isFrozen(record)); return outcome; })).status, 200);
});
test('storage failure returns retry and hides internal detail', async () => assert.deepEqual(await invoke({}, async () => { throw Error('private database error'); }), { status: 503, code: 'RETRY_LATER' }));
test('uncommitted storage outcome is not acknowledged', async () => assert.equal((await invoke({}, async () => 'pending')).status, 503));
