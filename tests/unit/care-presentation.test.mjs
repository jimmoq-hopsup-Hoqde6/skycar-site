import test from 'node:test';
import assert from 'node:assert/strict';
import { readReceipt, statusSummary } from '../../src/domain/care/presentation.ts';

const receipt = { id: 'test', customer_stage: 'request_received', service: 'repair', description: 'Synthetic repair request', preferred_window: 'flexible', quote_state: 'in_review', assignment_state: 'none', fulfilment_state: null, money_state: null, next_action: 'review_request', responsible_role: 'operations', created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', next_update_at: '2026-09-21T12:00:00Z', events: [] };
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
test('connected progress overrides stale legacy status without confusing requested and confirmed', () => {
  const stale = { ...receipt, customer_stage: 'no_match', next_update_at: null };
  assert.equal(statusSummary({ ...stale, quote_state: 'issued' }, Date.now()).title, 'Your quote is ready');
  const requested = statusSummary({ ...stale, quote_state: 'accepted', assignment_state: 'reserved' }, Date.now());
  assert.equal(requested.title, 'Your appointment is requested');
  assert.match(requested.detail, /not confirmed/);
  assert.equal(statusSummary({ ...stale, quote_state: 'accepted', assignment_state: 'accepted', fulfilment_state: 'scheduled' }, Date.now()).title, 'Your appointment is confirmed');
  assert.equal(statusSummary({ ...stale, quote_state: 'accepted', assignment_state: 'accepted', fulfilment_state: 'completed' }, Date.now()).title, 'Your service is complete');
});
test('unsupported status, wrong request and malformed events fail closed', () => {
  assert.equal(readReceipt(receipt, 'test'), receipt);
  for (const changed of [{ id: 'other' }, { customer_stage: 'completed' }, { quote_state: 'future' }, { assignment_state: 'future' }, { fulfilment_state: 'future' }, { money_state: 'paid' }, { next_update_at: 'bad' }, { events: [null] }, { events: [{ id: 'event', sequence: 1, type: 'unknown', occurred_at: receipt.created_at }] }]) {
    assert.throws(() => readReceipt({ ...receipt, ...changed }, 'test'));
  }
});
