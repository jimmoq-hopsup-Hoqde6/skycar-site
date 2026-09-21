export class GarageError extends Error {
  constructor(code, status, message, fieldErrors = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const vehicleFields = ['make', 'model', 'variant', 'year', 'registration', 'registration_state'];
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

export function requireUuid(value, name = 'id') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new GarageError('VALIDATION_FAILED', 400, 'Check the supplied identifier.', { [name]: 'Use a valid UUID.' });
  }
  return value.toLowerCase();
}

export function validateVehicleInput(input, command) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GarageError('VALIDATION_FAILED', 400, 'Provide a JSON object.');
  }
  const allowed = command === 'archive' ? ['expected_revision'] : [...vehicleFields, ...(command === 'update' ? ['expected_revision'] : [])];
  const errors = {};
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors[key] = 'This field is not accepted.';
  }
  const output = {};
  if (command !== 'create') {
    if (!Number.isInteger(input.expected_revision) || input.expected_revision < 1 || input.expected_revision > 2147483646) {
      errors.expected_revision = 'Reload the current vehicle before editing.';
    } else output.expected_revision = input.expected_revision;
  }
  if (command !== 'archive') {
    for (const key of ['make', 'model']) {
      const value = input[key];
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f]/.test(value)) errors[key] = 'Enter 1–80 characters.';
      else output[key] = value.trim();
    }
    const variant = input.variant ?? null;
    if (variant !== null && (typeof variant !== 'string' || !variant.trim() || variant.trim().length > 120 || /[\x00-\x1f]/.test(variant))) errors.variant = 'Enter up to 120 characters or leave blank.';
    else output.variant = variant === null ? null : variant.trim();
    const year = input.year ?? null;
    if (year !== null && (!Number.isInteger(year) || year < 1886 || year > 2200)) errors.year = 'Enter a year between 1886 and 2200.';
    else output.year = year;
    const registration = input.registration ?? null;
    if (registration !== null && (typeof registration !== 'string' || !/^[a-z0-9][a-z0-9 -]{0,15}$/i.test(registration.trim()))) errors.registration = 'Use up to 16 letters, numbers, spaces or hyphens.';
    else output.registration = registration === null ? null : registration.trim().toUpperCase();
    const state = input.registration_state ?? null;
    if (state !== null && !states.includes(state)) errors.registration_state = 'Select an Australian state or territory.';
    else output.registration_state = state;
  }
  if (Object.keys(errors).length) throw new GarageError('VALIDATION_FAILED', 400, 'Check the highlighted fields.', errors);
  return output;
}

export function parseVehicleQuery(url, history = false) {
  const params = new URL(url).searchParams;
  const allowed = history ? ['after', 'limit'] : ['after', 'limit', 'archived'];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new GarageError('VALIDATION_FAILED', 400, 'Invalid query parameters.');
  }
  const rawLimit = params.get('limit') ?? '20';
  if (!/^\d{1,2}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) throw new GarageError('VALIDATION_FAILED', 400, 'Limit must be between 1 and 50.');
  const archived = params.get('archived') ?? 'false';
  if (!['true', 'false'].includes(archived)) throw new GarageError('VALIDATION_FAILED', 400, 'Invalid archive filter.');
  let after = params.get('after');
  if (after !== null) {
    if (history) {
      const [timestamp, id, extra] = after.split('|');
      if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
        throw new GarageError('VALIDATION_FAILED', 400, 'Invalid history cursor.');
      }
      after = `${timestamp}|${requireUuid(id, 'after')}`;
    } else after = requireUuid(after, 'after');
  }
  return { limit: Number(rawLimit), after, archived: archived === 'true' };
}

export function publicVehicle(row) {
  return Object.fromEntries(['id', ...vehicleFields, 'revision', 'archived_at', 'created_at', 'updated_at'].map(key => [key, row[key]]));
}
