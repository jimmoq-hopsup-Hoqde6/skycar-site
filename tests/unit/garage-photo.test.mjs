import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GarageError } from '../../src/domain/garage/vehicles.mjs';
import { readVehiclePhoto } from '../../src/domain/garage/photo.mjs';
import { createGaragePhotoHandler } from '../../src/server/garage/photo-http.mjs';

const vehicleId = randomUUID();
const key = randomUUID();
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 7)]);
const saved = {
  id: randomUUID(), vehicle_id: vehicleId, purpose: 'vehicle_original', mime_type: 'image/jpeg',
  size_bytes: jpeg.length, processing_state: 'stored', created_at: '2026-09-21T00:00:00Z',
  original_status: 'stored', display_status: 'unavailable', replayed: false,
};

function request(body = jpeg, headers = {}) {
  return new Request(`https://skycar.test/api/v1/garage/vehicles/${vehicleId}/photo`, {
    method: 'POST',
    headers: { Origin: 'https://skycar.test', 'Content-Type': 'image/jpeg', 'Idempotency-Key': key, ...headers },
    body,
  });
}

test('bounded photo reader validates origin, type, size and image signature', async () => {
  const read = await readVehiclePhoto(request());
  assert.equal(read.key, key);
  assert.equal(read.mimeType, 'image/jpeg');
  assert.equal(read.extension, 'jpg');
  assert.equal(read.sizeBytes, jpeg.length);
  assert.match(read.sha256, /^[0-9a-f]{64}$/);

  await assert.rejects(() => readVehiclePhoto(request(jpeg, { Origin: 'https://attacker.test' })), error => error.code === 'ORIGIN_REJECTED');
  await assert.rejects(() => readVehiclePhoto(request(jpeg, { 'Content-Type': 'application/octet-stream' })), error => error.code === 'UNSUPPORTED_MEDIA_TYPE');
  await assert.rejects(() => readVehiclePhoto(request(jpeg, { 'Idempotency-Key': 'bad' })), error => error.code === 'VALIDATION_FAILED');
  await assert.rejects(() => readVehiclePhoto(request(Buffer.alloc(256), { 'Content-Type': 'image/jpeg' })), error => error.code === 'INVALID_IMAGE');
  await assert.rejects(() => readVehiclePhoto(request(Buffer.alloc(16), { 'Content-Type': 'image/png' })), error => error.code === 'INVALID_IMAGE');
  await assert.rejects(() => readVehiclePhoto(request(jpeg, { 'Content-Length': '10000001' })), error => error.code === 'PAYLOAD_TOO_LARGE');
});

test('photo handler authenticates before body work and returns private no-store metadata', async () => {
  let captured;
  const handle = createGaragePhotoHandler(async () => ({ repository: { save: async (...args) => { captured = args; return saved; } } }));
  const response = await handle(request(), vehicleId);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(captured[0], vehicleId);
  assert.equal(captured[1].key, key);
  assert.equal(captured[1].sha256.length, 64);
  assert.ok(captured[2]);
  assert.equal(body.data.display_status, 'unavailable');
  assert.equal(body.data.object_path, undefined);
  assert.equal(body.data.content_sha256, undefined);

  let repositoryCalls = 0;
  const unauthenticated = createGaragePhotoHandler(async () => {
    repositoryCalls++;
    throw new GarageError('UNAUTHENTICATED', 401, 'Sign in.');
  });
  assert.equal((await unauthenticated(request(), vehicleId)).status, 401);
  assert.equal(repositoryCalls, 1);
});

test('exact replay is 200 and stable Garage errors stay actionable without disclosure', async () => {
  const replay = createGaragePhotoHandler(async () => ({ repository: { save: async () => ({ ...saved, replayed: true }) } }));
  assert.equal((await replay(request(), vehicleId)).status, 200);

  for (const [code, status] of [['NOT_FOUND', 404], ['VEHICLE_ARCHIVED', 409], ['IDEMPOTENCY_CONFLICT', 409], ['TEMPORARILY_UNAVAILABLE', 503]]) {
    const handle = createGaragePhotoHandler(async () => ({ repository: { save: async () => { throw new GarageError(code, status, 'Safe message.'); } } }));
    const response = await handle(request(), vehicleId);
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryable, status >= 500);
  }

  const broken = createGaragePhotoHandler(async () => ({ repository: { save: async () => { throw new Error('storage-secret'); } } }));
  const response = await broken(request(), vehicleId);
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(body).includes('storage-secret'));
});
