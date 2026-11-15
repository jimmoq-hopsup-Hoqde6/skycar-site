export class GuestError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function guestInput(value) {
  const fields = ['name','email','phone','suburb','postcode','vehicle','service','description','preferred_window','consent'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new GuestError('VALIDATION_FAILED');
  const limits = { name: [2,100], email: [3,254], phone: [8,24], suburb: [2,100], postcode: [4,4], vehicle: [3,160], description: [10,2000] };
  const result = {};
  for (const [key,[min,max]] of Object.entries(limits)) {
    if (typeof value[key] !== 'string') throw new GuestError('VALIDATION_FAILED');
    const text = value[key].trim();
    if ([...text].length < min || [...text].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new GuestError('VALIDATION_FAILED');
    result[key] = text;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) || !/^\+?[\d ()-]+$/.test(result.phone) || !/^\d{4}$/.test(result.postcode)) throw new GuestError('VALIDATION_FAILED');
  if (!['repair','cleaning'].includes(value.service) || !['one_to_two_business_days','seven_to_fourteen_days','flexible'].includes(value.preferred_window) || value.consent !== true) throw new GuestError('VALIDATION_FAILED');
  return { ...result, email: result.email.toLowerCase(), service: value.service, preferred_window: value.preferred_window, consent: true };
}
export function guestKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new GuestError('VALIDATION_FAILED');
  return value.toLowerCase();
}
export function guestReceipt(value) {
  if (!value || typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) || value.stage !== 'request_received' || !Number.isFinite(Date.parse(value.created_at))) throw new GuestError('UNCONFIRMED');
  return { id: value.id, stage: value.stage, created_at: value.created_at };
}
