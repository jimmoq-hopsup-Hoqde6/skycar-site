import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationAdapter, NotificationJobError} from '../../src/server/notifications/adapter.mjs';
import {createNotificationTestSink} from '../../src/server/notifications/test-sink.mjs';

const NOW = '2026-10-05T00:00:00.000Z';
const DESTINATION = 'private@example.test';
const job = Object.freeze({
  delivery_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  recipient_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  channel: 'email',
  template: 'care_update_available',
  locale: 'en-AU',
  attempt: 0,
  available_at: NOW,
});

function adapter(provider, overrides = {}) {
  return createNotificationAdapter({
    authorize: async () => ({allowed: true, destination: DESTINATION}),
    provider,
    now: () => new Date(NOW),
    ...overrides,
  });
}

test('repeated delivery reauthorizes, keeps one provider key and creates one sink message', async () => {
  const sink = createNotificationTestSink();
  let authorizations = 0;
  const delivery = adapter(sink, {authorize: async () => {
    authorizations += 1;
    return {allowed: true, destination: DESTINATION};
  }});

  const first = await delivery.deliver(job);
  const replay = await delivery.deliver(job);

  assert.deepEqual(replay, first);
  assert.equal(authorizations, 2);
  assert.equal(sink.calls.length, 2);
  assert.equal(sink.calls[0].idempotency_key, job.delivery_id);
  assert.equal(sink.calls[1].idempotency_key, job.delivery_id);
  assert.equal(sink.messages.length, 1);
});

test('changed provider input on the same delivery id conflicts without a second message', async () => {
  const sink = createNotificationTestSink();
  const delivery = adapter(sink, {authorize: async current => ({
    allowed: true,
    destination: current.recipient_id === job.recipient_id ? DESTINATION : 'changed@example.test',
  })});

  assert.equal((await delivery.deliver(job)).status, 'delivered');
  const changed = await delivery.deliver({...job, recipient_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});

  assert.deepEqual(changed, {delivery_id: job.delivery_id, status: 'failed', code: 'IDEMPOTENCY_CONFLICT'});
  assert.equal(sink.messages.length, 1);
});

test('temporary provider failure schedules a deterministic retry that can later succeed', async () => {
  const sink = createNotificationTestSink({outcomes: [
    {status: 'retry', code: 'PROVIDER_TEMPORARY'},
    {status: 'accepted', provider_message_id: 'accepted-after-retry'},
  ]});
  const delivery = adapter(sink);

  assert.deepEqual(await delivery.deliver(job), {
    delivery_id: job.delivery_id,
    status: 'retry',
    code: 'PROVIDER_TEMPORARY',
    available_at: '2026-10-05T00:01:00.000Z',
  });
  assert.deepEqual(await delivery.deliver({...job, attempt: 1}), {
    delivery_id: job.delivery_id,
    status: 'delivered',
    code: 'DELIVERED',
    provider_message_id: 'accepted-after-retry',
  });
  assert.equal(sink.messages.length, 1);
});

test('provider rejection is terminal', async () => {
  const sink = createNotificationTestSink({outcomes: [{status: 'failed', code: 'PROVIDER_REJECTED'}]});
  assert.deepEqual(await adapter(sink).deliver(job), {
    delivery_id: job.delivery_id,
    status: 'failed',
    code: 'PROVIDER_REJECTED',
  });
});

test('wrong or withdrawn recipient never reaches the provider', async () => {
  const sink = createNotificationTestSink();
  const result = await adapter(sink, {authorize: async () => ({allowed: false})}).deliver(job);
  assert.deepEqual(result, {delivery_id: job.delivery_id, status: 'failed', code: 'RECIPIENT_NOT_AUTHORIZED'});
  assert.equal(sink.calls.length, 0);
});

test('authorization outage is retryable without contacting the provider', async () => {
  const sink = createNotificationTestSink();
  const result = await adapter(sink, {authorize: async () => { throw new Error('private resolver failure'); }}).deliver(job);
  assert.deepEqual(result, {
    delivery_id: job.delivery_id,
    status: 'retry',
    code: 'AUTHORIZATION_UNAVAILABLE',
    available_at: '2026-10-05T00:01:00.000Z',
  });
  assert.equal(sink.calls.length, 0);
});

test('not-due and exhausted jobs call neither authorization nor provider', async () => {
  const sink = createNotificationTestSink();
  let authorizations = 0;
  const delivery = adapter(sink, {authorize: async () => {
    authorizations += 1;
    return {allowed: true, destination: DESTINATION};
  }});

  assert.deepEqual(await delivery.deliver({...job, available_at: '2026-10-05T00:00:01Z'}), {
    delivery_id: job.delivery_id,
    status: 'not_due',
    code: 'NOT_DUE',
    available_at: '2026-10-05T00:00:01Z',
  });
  assert.deepEqual(await delivery.deliver({...job, attempt: 9}), {
    delivery_id: job.delivery_id,
    status: 'failed',
    code: 'ATTEMPTS_EXHAUSTED',
  });
  assert.equal(authorizations, 0);
  assert.equal(sink.calls.length, 0);
});

test('malformed jobs fail before dependencies', async () => {
  const sink = createNotificationTestSink();
  let authorizations = 0;
  const delivery = adapter(sink, {authorize: async () => { authorizations += 1; return {allowed: false}; }});
  const invalid = [
    {...job, extra: true},
    {...job, delivery_id: 'not-a-uuid'},
    {...job, channel: 'sms'},
    {...job, attempt: 10},
    {...job, available_at: '2026-10-05T00:00:00'},
  ];

  for (const value of invalid) await assert.rejects(delivery.deliver(value), NotificationJobError);
  assert.equal(authorizations, 0);
  assert.equal(sink.calls.length, 0);
});

test('results and allow-listed logs omit destinations, message copy and raw provider errors', async () => {
  const secret = 'super-secret-provider-detail';
  const logs = [];
  const provider = {send: async () => { throw new Error(secret); }};
  const result = await adapter(provider, {log: entry => logs.push(entry)}).deliver(job);
  const visible = JSON.stringify({result, logs});

  assert.equal(result.code, 'PROVIDER_TEMPORARY');
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['attempt', 'channel', 'deliveryId', 'event', 'eventId', 'outcome', 'template']);
  for (const forbidden of [DESTINATION, secret, 'There is an update', job.recipient_id]) {
    assert.equal(visible.includes(forbidden), false);
  }
});

test('logging failure cannot change a successful delivery result', async () => {
  const sink = createNotificationTestSink();
  const result = await adapter(sink, {log: () => { throw new Error('logging unavailable'); }}).deliver(job);
  assert.equal(result.status, 'delivered');
  assert.equal(sink.messages.length, 1);
});
