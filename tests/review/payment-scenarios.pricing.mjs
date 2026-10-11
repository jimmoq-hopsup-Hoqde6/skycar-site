// Executable proposal reference only. Not imported by application routes.
export const PRICING_VERSION = 'technician-markup-15-v1-proposal';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const fields = ['quote_id', 'quote_revision', 'technician_base_cents',
  'technician_gst_cents', 'service_fee_gst_cents', 'tax_policy_version'];
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const identifier = value => typeof value === 'string' &&
  /^[A-Za-z0-9_-]{1,128}$/.test(value);
const cents = (value, positive = false) => Number.isSafeInteger(value) &&
  value >= (positive ? 1 : 0);

export function pricingSnapshot(serverQuote, customerBody = {}) {
  if (!exact(customerBody, [])) throw new Error('CLIENT_AMOUNT_OVERRIDE');
  if (!exact(serverQuote, fields) || !identifier(serverQuote.quote_id) ||
    !cents(serverQuote.quote_revision, true) ||
    !cents(serverQuote.technician_base_cents, true)) {
    throw new Error('QUOTE_INVALID');
  }
  if (!identifier(serverQuote.tax_policy_version) ||
    !cents(serverQuote.technician_gst_cents) ||
    !cents(serverQuote.service_fee_gst_cents)) {
    throw new Error('TAX_POLICY_UNAVAILABLE');
  }
  const base = BigInt(serverQuote.technician_base_cents);
  const technicianTax = BigInt(serverQuote.technician_gst_cents);
  const feeTax = BigInt(serverQuote.service_fee_gst_cents);
  const fee = (base * 15n + 50n) / 100n;
  const agreed = base + technicianTax;
  const total = agreed + fee + feeTax;
  if (agreed > MAX || total > MAX) throw new Error('AMOUNT_OUT_OF_RANGE');
  return Object.freeze({
    quote_id: serverQuote.quote_id,
    quote_revision: serverQuote.quote_revision,
    pricing_policy_version: PRICING_VERSION,
    tax_policy_version: serverQuote.tax_policy_version,
    currency: 'AUD',
    technician_base_cents: Number(base),
    service_fee_cents: Number(fee),
    technician_gst_cents: Number(technicianTax),
    service_fee_gst_cents: Number(feeTax),
    technician_agreed_cents: Number(agreed),
    customer_total_cents: Number(total),
  });
}
