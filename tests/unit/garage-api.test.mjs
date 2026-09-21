import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GarageError, validateVehicleInput, parseVehicleQuery } from '../../src/domain/garage/vehicles.mjs';
import { createGarageHandler } from '../../src/server/garage/http.mjs';

const input = { make: ' Toyota ', model: 'Corolla', year: 2020, registration: 'abc123', registration_state: 'SA' };
const owner = randomUUID();
const vehicle = { id: randomUUID(), owner_id: owner, ...validateVehicleInput(input, 'create'), revision: 1, archived_at: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z' };
function request(body = input, headers = {}, path = '') {
  return new Request(`https://skycar.test/api/v1/garage/vehicles${path}`, { method: 'POST', headers: { Origin: 'https://skycar.test', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers }, body: JSON.stringify(body) });
}
const resultBody = async response => ({ status: response.status, body: await response.json() });

test('vehicle input normalizes display fields and rejects authoritative/unknown fields', () => {
  assert.equal(validateVehicleInput(input, 'create').registration, 'ABC123');
  for (const property of ['owner_id', 'role', 'id', 'revision', 'archived_at']) {
    assert.throws(() => validateVehicleInput({ ...input, [property]: owner }, 'create'), error => error.code === 'VALIDATION_FAILED' && property in error.fieldErrors);
  }
  for (const bad of [{ ...input, year: 2020.5 }, { ...input, year: '2020' }, { ...input, make: ' ' }, { ...input, variant: 5 }, { ...input, registration_state: 'ZZ' }, null, []]) {
    assert.throws(() => validateVehicleInput(bad, 'create'), GarageError);
  }
  assert.throws(() => validateVehicleInput({ ...input }, 'update'), GarageError);
  assert.throws(() => validateVehicleInput({ expected_revision: 1, make: 'Toyota' }, 'archive'), GarageError);
});

test('queries are bounded and history cursor rejects filter injection', () => {
  assert.equal(parseVehicleQuery('https://skycar.test?limit=50&archived=true').limit, 50);
  for (const query of ['limit=51', 'limit=0', 'limit=1.5', 'limit=10&limit=20', 'owner_id=other', 'archived=yes', 'after=bad']) {
    assert.throws(() => parseVehicleQuery(`https://skycar.test?${query}`), GarageError);
  }
  const cursor = `2026-09-20T00:00:00.123456+00:00|${randomUUID()}`;
  assert.equal(parseVehicleQuery(`https://skycar.test?after=${encodeURIComponent(cursor)}`, true).after, cursor);
  assert.throws(() => parseVehicleQuery(`https://skycar.test?after=${encodeURIComponent('2026-09-20T00:00:00Z),owner_id.neq.other|' + randomUUID())}`, true), GarageError);
});

test('session failure rejects requests before repository access and never caches private data', async () => {
  const handle = createGarageHandler(async () => { throw new GarageError('UNAUTHENTICATED', 401, 'Sign in.'); });
  const response = await handle(request(), 'create');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
});

test('cross-origin, missing origin and malformed writes never reach mutation', async () => {
  let calls = 0;
  const handle = createGarageHandler(async () => ({ repository: { mutate: async () => { calls++; return vehicle; } } }));
  for (const headers of [{ Origin: 'https://attacker.test' }, { Origin: '' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await handle(request(input, headers), 'create')).status, 403);
  }
  assert.equal((await handle(request(input, { 'Content-Type': 'text/plain' }), 'create')).status, 415);
  assert.equal((await handle(request(input, { 'Idempotency-Key': 'bad' }), 'create')).status, 400);
  assert.equal((await handle(request({ ...input, make: 'x'.repeat(9000) }), 'create')).status, 413);
  const invalid = request();
  const malformed = new Request(invalid.url, { method: 'POST', headers: invalid.headers, body: '{' });
  assert.equal((await handle(malformed, 'create')).status, 400);
  assert.equal(calls, 0);
});

test('create passes normalized data and retry key to persistence, strips owner from response', async () => {
  const key = randomUUID(); let captured;
  const handle = createGarageHandler(async () => ({ repository: { mutate: async (...args) => { captured = args; return vehicle; } } }));
  const { status, body } = await resultBody(await handle(request(input, { 'Idempotency-Key': key }), 'create'));
  assert.equal(status, 201); assert.equal(captured[0], 'create'); assert.equal(captured[1], null);
  assert.equal(captured[2].make, 'Toyota'); assert.equal(captured[3], key);
  assert.ok(captured[4]); assert.equal(body.data.owner_id, undefined); assert.equal(body.data.id, vehicle.id);
});

test('get/update/archive/history consistently propagate not found without owner disclosure', async () => {
  const missing = () => { throw new GarageError('NOT_FOUND', 404, 'Vehicle not found.'); };
  const handle = createGarageHandler(async () => ({ repository: { get: missing, mutate: missing, history: missing } }));
  for (const operation of ['get', 'history', 'update', 'archive']) {
    const req = operation === 'archive' ? request({ expected_revision: 1 }) : request({ ...input, expected_revision: 1 });
    const { status, body } = await resultBody(await handle(req, operation, randomUUID()));
    assert.equal(status, 404); assert.equal(body.error.code, 'NOT_FOUND');
  }
});

test('mutation conflicts stay 409 and unexpected errors do not disclose database details', async () => {
  for (const code of ['REVISION_CONFLICT', 'VEHICLE_ARCHIVED', 'IDEMPOTENCY_CONFLICT']) {
    const handle = createGarageHandler(async () => ({ repository: { mutate: () => { throw new GarageError(code, 409, 'Conflict.'); } } }));
    const { status, body } = await resultBody(await handle(request(), 'create'));
    assert.equal(status, 409); assert.equal(body.error.code, code); assert.equal(body.error.retryable, false);
  }
  const handle = createGarageHandler(async () => { throw new Error('password=private-database-secret'); });
  const { status, body } = await resultBody(await handle(request(), 'create'));
  assert.equal(status, 500); assert.equal(body.error.code, 'INTERNAL_ERROR'); assert.ok(!JSON.stringify(body).includes('private-database-secret'));
});
