import test from 'node:test';
import assert from 'node:assert/strict';
import { readReceipt, statusSummary } from '../../src/domain/care/presentation.ts';

const receipt = { id: 'test', customer_stage: 'request_received', service: 'repair', description: 'Synthetic repair request', preferred_window: 'flexible', responsible_role: 'operations', created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', next_update_at: '2026-09-21T12:00:00Z', events: [] };
test('overdue projection does not wait for the escalation worker', () => {
  assert.equal(statusSummary(receipt, Date.parse(receipt.next_update_at)).overdue, true);
  assert.equal(statusSummary(receipt, Date.parse(receipt.next_update_at) - 1).overdue, false);
  assert.equal(receipt.customer_stage, 'request_received');
});
test('no-match does not invent a new deadline or confirmed booking', () => {
  const result = statusSummary({ ...receipt, customer_stage: 'no_match', next_update_at: null }, Date.now());
  assert.equal(result.overdue, false);
  assert.match(result.detail, /does not confirm/);
});
test('unsupported status, wrong request and malformed events fail closed', () => {
  assert.equal(readReceipt(receipt, 'test'), receipt);
  for (const changed of [{ id: 'other' }, { customer_stage: 'completed' }, { next_update_at: 'bad' }, { events: [null] }, { events: [{ id: 'event', sequence: 1, type: 'unknown', occurred_at: receipt.created_at }] }]) {
    assert.throws(() => readReceipt({ ...receipt, ...changed }, 'test'));
  }
});
