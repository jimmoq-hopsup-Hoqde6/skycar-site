// Review-only contracts. No SDK, network, persistence or production imports.
export function checkoutInterface({ mode = 'disabled', authorized = false, body = {} } = {}) {
  if (!authorized) return { status: 404, code: 'NOT_FOUND' };
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) {
    return { status: 400, code: 'INVALID_COMMAND' };
  }
  // Even sandbox/live inputs cannot enable this preparation-only interface.
  return { status: 503, code: 'PAYMENT_CONFIGURATION_UNAVAILABLE', mode: mode === 'mock' ? 'mock' : 'disabled' };
}

const labels = Object.freeze({
  not_created: 'No payment has been taken', checkout_pending: 'Payment confirmation pending',
  authorized: 'Payment authorised; not yet captured', captured: 'Payment received',
  failed: 'Payment failed', expired: 'Payment attempt expired', voided: 'Payment authorisation cancelled',
});
export function customerMoneyView(record) {
  const state = record?.state ?? 'not_created';
  if (!Object.hasOwn(labels, state)) throw new Error('INVALID_PAYMENT_STATE');
  // Explicit projection prevents provider payloads and payout data leaking to customers.
  return Object.freeze({ state, label: labels[state], canPay: false });
}

/** Synthetic normalized event boundary; verify is a TEST DOUBLE, not signature security. */
export async function webhookInterface(raw, { verify, commit, maxBytes = 65536 }) {
  if (!(raw instanceof Uint8Array) || raw.byteLength > maxBytes) return { status: 413, code: 'BODY_REJECTED' };
  let event;
  try { event = await verify(raw); } catch { return { status: 400, code: 'INVALID_SIGNATURE' }; }
  if (!event || event.livemode !== false || event.account !== 'fixture-account' ||
      event.version !== 'skycar-mock-v1' || typeof event.id !== 'string' || !event.id) {
    return { status: 400, code: 'INVALID_EVENT_CONTEXT' };
  }
  if (!['capture.succeeded', 'refund.succeeded', 'payout.paid'].includes(event.type)) {
    return { status: 200, code: 'IGNORED' };
  }
  if (typeof event.objectId !== 'string' || !event.objectId || event.currency !== 'AUD' ||
      !Number.isSafeInteger(event.amountCents) || event.amountCents <= 0) {
    return { status: 400, code: 'INVALID_EVENT' };
  }
  try {
    const result = await commit(Object.freeze({ id: event.id, type: event.type,
      objectId: event.objectId, amountCents: event.amountCents, currency: event.currency }));
    if (!['committed', 'duplicate', 'reconciliation_recorded'].includes(result)) throw new Error('UNCOMMITTED');
    return { status: 200, code: result.toUpperCase() };
  } catch { return { status: 503, code: 'RETRY_LATER' }; }
}
