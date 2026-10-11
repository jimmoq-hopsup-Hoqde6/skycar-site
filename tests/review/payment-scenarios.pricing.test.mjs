import test from 'node:test';
import assert from 'node:assert/strict';
import {pricingSnapshot, PRICING_VERSION} from './payment-scenarios.pricing.mjs';

// Synthetic tax decisions demonstrate arithmetic, not a real GST policy.
const quote = overrides => ({quote_id: 'quote-1', quote_revision: 1,
  technician_base_cents: 50_000, technician_gst_cents: 0,
  service_fee_gst_cents: 0, tax_policy_version: 'synthetic-zero', ...overrides});

test('approved $500 job preserves technician amount and adds $75 to customer subtotal', () => {
  const snapshot = pricingSnapshot(quote());
  assert.equal(snapshot.technician_agreed_cents, 50_000);
  assert.equal(snapshot.service_fee_cents, 7_500);
  assert.equal(snapshot.customer_total_cents, 57_500);
  assert.equal(snapshot.currency, 'AUD');
  assert.equal(snapshot.pricing_policy_version, PRICING_VERSION);
});

test('explicit separate taxes compose the customer total and technician agreed amount', () => {
  const snapshot = pricingSnapshot(quote({technician_gst_cents: 5_000,
    service_fee_gst_cents: 750, tax_policy_version: 'synthetic-both-taxable'}));
  assert.equal(snapshot.technician_agreed_cents, 55_000);
  assert.equal(snapshot.customer_total_cents, 63_250);
  const feeOnly = pricingSnapshot(quote({service_fee_gst_cents: 750}));
  assert.equal(feeOnly.technician_agreed_cents, 50_000);
  assert.equal(feeOnly.customer_total_cents, 58_250);
});

test('proposed cent rounding handles below-half, half and above-half boundaries', () => {
  for (const [base, expectedFee] of [[1, 0], [3, 0], [10, 2], [17, 3],
    [50_003, 7_500], [50_010, 7_502], [50_017, 7_503]]) {
    assert.equal(pricingSnapshot(quote({technician_base_cents: base})).service_fee_cents, expectedFee);
  }
});

test('fee stays within half a cent and never reduces technician price across 10000 bases', () => {
  for (let base = 1; base <= 10_000; base++) {
    const snapshot = pricingSnapshot(quote({technician_base_cents: base}));
    assert.ok(Math.abs(snapshot.service_fee_cents * 100 - base * 15) <= 50);
    assert.equal(snapshot.technician_agreed_cents, base);
    assert.equal(snapshot.customer_total_cents, base + snapshot.service_fee_cents);
  }
});

test('customer amount, fee, tax and currency overrides fail before quote calculation', () => {
  for (const body of [{amount_cents: 1}, {service_fee_cents: 0},
    {technician_base_cents: 1}, {service_fee_gst_cents: 0}, {currency: 'USD'}, null, []]) {
    assert.throws(() => pricingSnapshot(quote(), body), /CLIENT_AMOUNT_OVERRIDE/);
  }
});

test('unknown tax fails rather than defaulting to zero', () => {
  for (const overrides of [{technician_gst_cents: null}, {service_fee_gst_cents: undefined},
    {tax_policy_version: ''}, {technician_gst_cents: -1}, {service_fee_gst_cents: 0.5}]) {
    assert.throws(() => pricingSnapshot(quote(overrides)), /TAX_POLICY_UNAVAILABLE/);
  }
});

test('invalid amounts, identity and unexpected quote fields are rejected', () => {
  for (const overrides of [{technician_base_cents: 0}, {technician_base_cents: 1.5},
    {technician_base_cents: NaN}, {technician_base_cents: '50000'},
    {technician_base_cents: Number.MAX_SAFE_INTEGER + 1}, {quote_revision: 0},
    {quote_id: ''}, {currency: 'USD'}]) {
    assert.throws(() => pricingSnapshot(quote(overrides)), /QUOTE_INVALID/);
  }
});

test('safe input can still overflow total; bigint intermediates retain exact supported result', () => {
  assert.throws(() => pricingSnapshot(quote({technician_base_cents: Number.MAX_SAFE_INTEGER})), /AMOUNT_OUT_OF_RANGE/);
  assert.throws(() => pricingSnapshot(quote({service_fee_gst_cents: Number.MAX_SAFE_INTEGER})), /AMOUNT_OUT_OF_RANGE/);
  const snapshot = pricingSnapshot(quote({technician_base_cents: 1_000_000_000_000_000}));
  assert.equal(snapshot.customer_total_cents, 1_150_000_000_000_000);
});

test('snapshot stays locked when source quote changes; new revision records changed price', () => {
  const source = quote();
  const locked = pricingSnapshot(source);
  source.technician_base_cents = 60_000;
  source.quote_revision = 2;
  assert.equal(locked.customer_total_cents, 57_500);
  assert.throws(() => { locked.customer_total_cents = 1; }, TypeError);
  const replacement = pricingSnapshot(source);
  assert.equal(replacement.quote_revision, 2);
  assert.equal(replacement.customer_total_cents, 69_000);
  assert.equal(locked.quote_revision, 1);
  assert.equal('status' in locked, false, 'arithmetic does not create a payment or payout state');
});
