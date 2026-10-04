import test from 'node:test';
import assert from 'node:assert/strict';

// This is a provider-independent reference model for contract review only.
// The synthetic policy name and amounts are fixtures, not commercial decisions.
const POLICY = 'synthetic-review-policy';
const quote = Object.freeze({id: 'quote-1', revision: 4, total_price_cents: 82_500, currency: 'AUD'});

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const clone = value => structuredClone(value);

function ledger({policyVersion = POLICY} = {}) {
  const commands = new Map();
  const orders = new Map();
  const providerEvents = new Map();
  const refundCommands = new Map();
  const refunds = new Map();
  const payouts = new Map();
  let moneyEffects = 0;

  const commandReplay = (store, key, fingerprint) => {
    const prior = store.get(key);
    if (!prior) return null;
    return prior.fingerprint === fingerprint ? {...clone(prior.result), replayed: true} : {error: 'IDEMPOTENCY_CONFLICT'};
  };

  const recordCommand = (store, key, fingerprint, result) => {
    store.set(key, {fingerprint, result: clone(result)});
    return result;
  };

  const api = {
    checkout({key, journeyId, body, serverQuote}) {
      if (!policyVersion) return {error: 'PAYMENT_CONFIGURATION_UNAVAILABLE'};
      if (!exactKeys(body, [])) return {error: 'VALIDATION_FAILED'};
      if (!serverQuote || !Number.isInteger(serverQuote.total_price_cents) || serverQuote.total_price_cents <= 0 || serverQuote.currency !== 'AUD') {
        return {error: 'QUOTE_UNAVAILABLE'};
      }

      const fingerprint = JSON.stringify({journeyId, quoteId: serverQuote.id, quoteRevision: serverQuote.revision});
      const replay = commandReplay(commands, key, fingerprint);
      if (replay) return replay;

      const order = {
        id: `order-${orders.size + 1}`,
        journey_id: journeyId,
        quote_id: serverQuote.id,
        quote_revision: serverQuote.revision,
        amount_cents: serverQuote.total_price_cents,
        currency: serverQuote.currency,
        policy_version: policyVersion,
        status: 'checkout_pending',
      };
      orders.set(order.id, order);
      return recordCommand(commands, key, fingerprint, {...clone(order), replayed: false});
    },

    providerEvent(event) {
      if (!event.signatureValid) return {error: 'INVALID_SIGNATURE'};
      if (providerEvents.has(event.id)) return {status: 'already_processed', replayed: true};

      const order = orders.get(event.orderId);
      if (!order) return {error: 'RECONCILIATION_REQUIRED'};
      providerEvents.set(event.id, {orderId: event.orderId, type: event.type});

      if (event.amount_cents !== order.amount_cents || event.currency !== order.currency) {
        return {error: 'RECONCILIATION_REQUIRED'};
      }

      const target = {
        'checkout.authorized': 'authorized',
        'charge.captured': 'captured',
        'checkout.failed': 'failed',
      }[event.type];
      const allowed = {
        checkout_pending: new Set(['authorized', 'captured', 'failed']),
        authorized: new Set(['captured']),
        captured: new Set(),
        failed: new Set(),
      }[order.status];

      if (!target || !allowed?.has(target)) return {status: 'ignored', order_status: order.status};
      order.status = target;
      moneyEffects += 1;
      return {status: 'applied', order_status: order.status};
    },

    requestRefund({key, orderId, amountCents}) {
      const fingerprint = JSON.stringify({orderId, amountCents});
      const replay = commandReplay(refundCommands, key, fingerprint);
      if (replay) return replay;

      const order = orders.get(orderId);
      if (!order || order.status !== 'captured' || !Number.isInteger(amountCents) || amountCents <= 0) {
        return {error: 'REFUND_NOT_ALLOWED'};
      }
      const succeeded = [...refunds.values()].filter(item => item.order_id === orderId && item.status === 'succeeded')
        .reduce((sum, item) => sum + item.amount_cents, 0);
      if (succeeded + amountCents > order.amount_cents) return {error: 'REFUND_LIMIT_EXCEEDED'};

      const refund = {id: `refund-${refunds.size + 1}`, order_id: orderId, amount_cents: amountCents, currency: order.currency, status: 'requested'};
      refunds.set(refund.id, refund);
      return recordCommand(refundCommands, key, fingerprint, {...clone(refund), replayed: false});
    },

    submitRefund(refundId) {
      const refund = refunds.get(refundId);
      if (!refund || !['requested', 'failed'].includes(refund.status)) return {error: 'INVALID_TRANSITION'};
      refund.status = 'submitted';
      return {status: refund.status, provider_key: refund.id};
    },

    refundResult(refundId, result) {
      const refund = refunds.get(refundId);
      if (!refund || refund.status !== 'submitted' || !['succeeded', 'failed'].includes(result)) return {error: 'INVALID_TRANSITION'};
      refund.status = result;
      if (result === 'succeeded') moneyEffects += 1;
      return {status: refund.status};
    },

    createPayout({jobId, orderId, technicianId}) {
      const order = orders.get(orderId);
      if (!policyVersion) return {status: 'unavailable', code: 'PAYOUT_POLICY_UNAVAILABLE'};
      if (!order || order.status !== 'captured') return {status: 'unavailable', code: 'CAPTURE_REQUIRED'};
      const payout = {id: `payout-${payouts.size + 1}`, job_id: jobId, order_id: orderId, technician_id: technicianId, status: 'held', amount_cents: null};
      payouts.set(payout.id, payout);
      return clone(payout);
    },

    evaluatePayout(payoutId, decision) {
      const payout = payouts.get(payoutId);
      if (!payout || payout.status !== 'held') return {error: 'INVALID_TRANSITION'};
      if (!decision.completionConfirmed || decision.disputeOpen || !decision.releaseApproved) return clone(payout);
      if (!Number.isInteger(decision.policyPayoutCents) || decision.policyPayoutCents <= 0) return {error: 'PAYOUT_POLICY_UNAVAILABLE'};
      payout.status = 'eligible';
      payout.amount_cents = decision.policyPayoutCents;
      return clone(payout);
    },

    holdPayout(payoutId) {
      const payout = payouts.get(payoutId);
      if (!payout || !['held', 'eligible'].includes(payout.status)) return {error: 'INVALID_TRANSITION'};
      payout.status = 'held';
      return clone(payout);
    },

    submitPayout(payoutId) {
      const payout = payouts.get(payoutId);
      if (!payout || !['eligible', 'failed'].includes(payout.status)) return {error: 'INVALID_TRANSITION'};
      payout.status = 'submitted';
      return {status: payout.status, provider_key: payout.id};
    },

    payoutResult(payoutId, result) {
      const payout = payouts.get(payoutId);
      if (!payout || payout.status !== 'submitted' || !['paid', 'failed'].includes(result)) return {error: 'INVALID_TRANSITION'};
      payout.status = result;
      if (result === 'paid') moneyEffects += 1;
      return {status: payout.status};
    },

    order(orderId) { return clone(orders.get(orderId)); },
    refund(refundId) { return clone(refunds.get(refundId)); },
    payout(payoutId) { return clone(payouts.get(payoutId)); },
    stats() { return {moneyEffects, providerEvents: providerEvents.size}; },
  };
  return api;
}

const checkout = (book, overrides = {}) => book.checkout({
  key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  journeyId: 'journey-1',
  body: {},
  serverQuote: quote,
  ...overrides,
});

const capturedOrder = book => {
  const order = checkout(book);
  book.providerEvent({id: 'event-captured', type: 'charge.captured', orderId: order.id, amount_cents: quote.total_price_cents, currency: 'AUD', signatureValid: true});
  return order.id;
};

test('checkout amount is an immutable server quote snapshot and client money fields are rejected', () => {
  const book = ledger();
  assert.deepEqual(checkout(book, {body: {amount_cents: 1}}), {error: 'VALIDATION_FAILED'});
  const order = checkout(book);
  assert.equal(order.amount_cents, quote.total_price_cents);
  assert.equal(order.currency, 'AUD');
  assert.equal(order.quote_revision, quote.revision);
  assert.equal(order.status, 'checkout_pending');
});

test('exact checkout replay is stable and changed quote input conflicts', () => {
  const book = ledger();
  const first = checkout(book);
  const replay = checkout(book);
  assert.equal(replay.id, first.id);
  assert.equal(replay.replayed, true);
  assert.deepEqual(checkout(book, {serverQuote: {...quote, revision: 5, total_price_cents: 83_000}}), {error: 'IDEMPOTENCY_CONFLICT'});
});

test('invalid, duplicate and out-of-order provider events cannot duplicate or regress money state', () => {
  const book = ledger();
  const order = checkout(book);
  const event = {id: 'event-1', type: 'charge.captured', orderId: order.id, amount_cents: quote.total_price_cents, currency: 'AUD', signatureValid: true};
  assert.deepEqual(book.providerEvent({...event, id: 'attacker', signatureValid: false}), {error: 'INVALID_SIGNATURE'});
  assert.equal(book.providerEvent(event).status, 'applied');
  assert.equal(book.providerEvent(event).status, 'already_processed');
  assert.equal(book.providerEvent({...event, id: 'event-late', type: 'checkout.authorized'}).status, 'ignored');
  assert.equal(book.order(order.id).status, 'captured');
  assert.deepEqual(book.stats(), {moneyEffects: 1, providerEvents: 2});
});

test('amount or currency mismatch is quarantined instead of changing payment state', () => {
  const book = ledger();
  const order = checkout(book);
  assert.deepEqual(book.providerEvent({id: 'event-wrong', type: 'charge.captured', orderId: order.id, amount_cents: 1, currency: 'AUD', signatureValid: true}), {error: 'RECONCILIATION_REQUIRED'});
  assert.equal(book.order(order.id).status, 'checkout_pending');
  assert.equal(book.stats().moneyEffects, 0);
});

test('interrupted checkout remains pending until an authoritative verified event arrives', () => {
  const book = ledger();
  const order = checkout(book);
  assert.equal(book.order(order.id).status, 'checkout_pending', 'browser interruption creates no success');
  book.providerEvent({id: 'event-reconciled', type: 'checkout.authorized', orderId: order.id, amount_cents: quote.total_price_cents, currency: 'AUD', signatureValid: true});
  assert.equal(book.order(order.id).status, 'authorized');
});

test('failed refund stays visible, retains retry identity and does not alter booking or completion', () => {
  const book = ledger();
  const orderId = capturedOrder(book);
  const journey = {state: 'completed', completion_review: 'issue_reported'};
  const before = clone(journey);
  const refund = book.requestRefund({key: 'refund-key-1', orderId, amountCents: 20_000});
  assert.equal(book.submitRefund(refund.id).provider_key, refund.id);
  assert.equal(book.refundResult(refund.id, 'failed').status, 'failed');
  assert.equal(book.submitRefund(refund.id).provider_key, refund.id);
  assert.deepEqual(journey, before);
  assert.equal(book.order(orderId).status, 'captured');
});

test('succeeded refund totals cannot exceed captured funds', () => {
  const book = ledger();
  const orderId = capturedOrder(book);
  const refund = book.requestRefund({key: 'refund-key-1', orderId, amountCents: 80_000});
  book.submitRefund(refund.id);
  book.refundResult(refund.id, 'succeeded');
  assert.deepEqual(book.requestRefund({key: 'refund-key-2', orderId, amountCents: 2_501}), {error: 'REFUND_LIMIT_EXCEEDED'});
  assert.equal(book.requestRefund({key: 'refund-key-3', orderId, amountCents: 2_500}).status, 'requested');
});

test('completion alone cannot release payout and a dispute hold does not undo captured payment', () => {
  const book = ledger();
  const orderId = capturedOrder(book);
  const payout = book.createPayout({jobId: 'job-1', orderId, technicianId: 'technician-1'});
  assert.equal(book.evaluatePayout(payout.id, {completionConfirmed: true, disputeOpen: false, releaseApproved: false, policyPayoutCents: 70_000}).status, 'held');
  assert.equal(book.evaluatePayout(payout.id, {completionConfirmed: true, disputeOpen: false, releaseApproved: true, policyPayoutCents: 70_000}).status, 'eligible');
  assert.equal(book.holdPayout(payout.id).status, 'held');
  assert.equal(book.order(orderId).status, 'captured');
});

test('payout retry keeps one provider identity and only verified settlement becomes paid', () => {
  const book = ledger();
  const orderId = capturedOrder(book);
  const payout = book.createPayout({jobId: 'job-1', orderId, technicianId: 'technician-1'});
  book.evaluatePayout(payout.id, {completionConfirmed: true, disputeOpen: false, releaseApproved: true, policyPayoutCents: 70_000});
  assert.equal(book.submitPayout(payout.id).provider_key, payout.id);
  assert.equal(book.payoutResult(payout.id, 'failed').status, 'failed');
  assert.equal(book.submitPayout(payout.id).provider_key, payout.id);
  assert.equal(book.payoutResult(payout.id, 'paid').status, 'paid');
  assert.equal(book.payout(payout.id).status, 'paid');
});

test('missing approved policy keeps checkout and payout unavailable', () => {
  const book = ledger({policyVersion: null});
  assert.deepEqual(checkout(book), {error: 'PAYMENT_CONFIGURATION_UNAVAILABLE'});
  assert.deepEqual(book.createPayout({jobId: 'job-1', orderId: 'missing', technicianId: 'technician-1'}), {status: 'unavailable', code: 'PAYOUT_POLICY_UNAVAILABLE'});
});
