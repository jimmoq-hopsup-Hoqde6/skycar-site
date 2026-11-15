import test from 'node:test';
import assert from 'node:assert/strict';
import { readReceipt } from '../../src/domain/care/presentation.ts';
import { readCareSubmission } from '../../src/domain/care/submission.ts';
import { SERVICE_POSTCODE_SOURCES, validServicePostcode } from '../../src/domain/care/request.ts';

// 20261115100000: the request snapshot carries service_postcode and service_postcode_source.
const id = '11111111-1111-4111-8111-111111111111';
const now = new Date().toISOString();
const base = { id, customer_stage: 'request_received', service: 'repair', vehicle_id: '22222222-2222-4222-8222-222222222222', description: 'Synthetic repair request', preferred_window: 'flexible', quote_state: 'in_review', assignment_state: 'none', fulfilment_state: null, money_state: null, next_action: 'review_request', responsible_role: 'operations', created_at: now, updated_at: now, next_update_at: now, events: [] };

test('the source list matches the database check constraint', () => {
  assert.deepEqual([...SERVICE_POSTCODE_SOURCES], ['submit', 'update_details', 'backfill', 'unknown']);
});
test('receipts with a valid stored postcode are read and keep both fields', () => {
  for (const source of ['submit', 'update_details', 'backfill']) {
    const receipt = { ...base, service_postcode: '5000', service_postcode_source: source };
    const read = readReceipt(receipt, id);
    assert.equal(read.service_postcode, '5000');
    assert.equal(read.service_postcode_source, source);
  }
  const legacy = readReceipt({ ...base, service_postcode: null, service_postcode_source: 'unknown' }, id);
  assert.equal(legacy.service_postcode, null);
  assert.equal(legacy.service_postcode_source, 'unknown');
});
test('a receipt from a database without 20261115100000 (neither field) is still readable', () => {
  assert.equal(readReceipt(base, id), base);
  assert.equal(validServicePostcode(base), true);
});
test('malformed or half-present service postcode fields fail closed', () => {
  for (const changed of [
    { service_postcode: '5000' },
    { service_postcode_source: 'submit' },
    { service_postcode: null, service_postcode_source: 'submit' },
    { service_postcode: '5000', service_postcode_source: 'unknown' },
    { service_postcode: '500', service_postcode_source: 'submit' },
    { service_postcode: '50000', service_postcode_source: 'backfill' },
    { service_postcode: 5000, service_postcode_source: 'submit' },
    { service_postcode: '5000', service_postcode_source: 'guess' },
    { service_postcode: '5000', service_postcode_source: null },
  ]) {
    assert.throws(() => readReceipt({ ...base, ...changed }, id), /Unsupported response/, JSON.stringify(changed));
    assert.equal(validServicePostcode({ ...base, ...changed }), false, JSON.stringify(changed));
  }
});
test('submission responses validate the stored postcode too', () => {
  const ok = readCareSubmission({ request: { ...base, service_postcode: '5000', service_postcode_source: 'submit' }, replayed: false });
  assert.equal(ok.request.service_postcode_source, 'submit');
  assert.throws(() => readCareSubmission({ request: { ...base, service_postcode: '5000', service_postcode_source: 'unknown' }, replayed: false }));
});
