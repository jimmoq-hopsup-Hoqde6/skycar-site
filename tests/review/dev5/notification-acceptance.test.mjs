import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationAdapter, NotificationJobError } from '../../../src/server/notifications/adapter.mjs';

const now = () => new Date('2026-10-19T00:00:00Z');
const job = {
  delivery_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  recipient_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  channel: 'email', template: 'care_update_available', locale: 'en-AU',
  attempt: 0, available_at: '2026-10-18T00:00:00Z',
};

function harness(authorize, send) {
  const calls = { authorization: 0, provider: 0 };
  const adapter = createNotificationAdapter({ now,
    authorize: async value => { calls.authorization++; return authorize(value); },
    provider: { send: async value => { calls.provider++; return send(value); } },
  });
  return { adapter, calls };
}
const allowed = () => ({ allowed: true, destination: 'synthetic@example.test' });
const accepted = () => ({ status: 'accepted', provider_message_id: 'synthetic-receipt' });

test('QA-N01: impossible calendar date is rejected before any dependency', async () => {
  const { adapter, calls } = harness(allowed, accepted);
  // February 30 is not an instant; Date.parse silently normalizes it to March 2.
  let error;
  try { await adapter.deliver({ ...job, available_at: '2026-02-30T00:00:00Z' }); }
  catch (caught) { error = caught; }
  assert.deepEqual({ rejected: error instanceof NotificationJobError, ...calls },
    { rejected: true, authorization: 0, provider: 0 });
});

test('QA-N02: consent withdrawn between attempts prevents a repeat send', async () => {
  let authorized = true;
  const { adapter, calls } = harness(() => authorized ? allowed() : { allowed: false }, accepted);
  assert.equal((await adapter.deliver(job)).status, 'delivered');
  authorized = false;
  assert.equal((await adapter.deliver({ ...job, attempt: 1 })).code, 'RECIPIENT_NOT_AUTHORIZED');
  assert.deepEqual(calls, { authorization: 2, provider: 1 });
});

test('QA-N03: malformed authority results cannot reach provider', async () => {
  for (const value of [null, { allowed: 'true', destination: 'synthetic@example.test' },
    { allowed: true, destination: 'invalid' }, { allowed: true, destination: 'synthetic@example.test', extra: true }]) {
    const { adapter, calls } = harness(() => value, accepted);
    assert.equal((await adapter.deliver(job)).code, 'AUTHORIZATION_UNAVAILABLE');
    assert.equal(calls.provider, 0);
  }
});

test('QA-N04: malformed provider receipts never establish delivery', async () => {
  for (const value of [null, { status: 'accepted' }, { status: 'accepted', provider_message_id: '' },
    { status: 'accepted', provider_message_id: 'receipt\nprivate' }]) {
    const { adapter } = harness(allowed, () => value);
    assert.equal((await adapter.deliver(job)).status, 'retry');
  }
});

test('QA-N05: exhausted retry cannot send after previous temporary failure', async () => {
  const { adapter, calls } = harness(allowed, () => ({ status: 'retry', code: 'PROVIDER_TEMPORARY' }));
  const retry = await adapter.deliver({ ...job, attempt: 8 });
  assert.equal(retry.status, 'retry');
  assert.equal((await adapter.deliver({ ...job, attempt: 9 })).code, 'ATTEMPTS_EXHAUSTED');
  assert.equal(calls.provider, 1);
});
