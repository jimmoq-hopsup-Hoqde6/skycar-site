import test from 'node:test';
import assert from 'node:assert/strict';
import { garagePhotoReader, createGaragePhotoReadHandler } from '../../src/server/garage/photo-read.mjs';
import { GarageError } from '../../src/domain/garage/vehicles.mjs';

const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicle = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const asset = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function client({ owned = true, saved = true, broken = false } = {}) {
  const calls = [];
  const blob = new Blob([new Uint8Array(256)], { type: 'image/png' });
  return { calls, from(table) {
    const query = {
      select(...args) { calls.push([table, 'select', ...args]); return query; },
      eq(...args) { calls.push([table, 'eq', ...args]); return query; },
      order() { return query; }, limit() { return query; },
      async maybeSingle() { return { data: table === 'vehicles' ? owned ? { id: vehicle } : null : saved ? { id: asset, mime_type: 'image/png', size_bytes: blob.size } : null, error: null }; },
    }; return query;
  }, storage: { from(bucket) { calls.push(['storage', bucket]); return { async download(path) { calls.push(['download', path]); return { data: broken ? null : blob, error: null }; } }; } } };
}
test('photo read verifies owner, selects stored metadata and downloads an exact private path', async () => {
  const db = client(); const photo = await garagePhotoReader(db, user).read(vehicle);
  assert.equal(photo.mimeType, 'image/png');
  assert.ok(db.calls.some(c => c[0] === 'vehicles' && c[2] === 'owner_id' && c[3] === user));
  assert.ok(db.calls.some(c => c[0] === 'media_assets' && c[2] === 'processing_state' && c[3] === 'stored'));
  assert.deepEqual(db.calls.at(-1), ['download', `${user}/vehicles/${vehicle}/${asset}/original.png`]);
});
test('other-account vehicle is indistinguishable from missing and never reads media or storage', async () => {
  const db = client({ owned: false });
  await assert.rejects(garagePhotoReader(db, user).read(vehicle), e => e.code === 'NOT_FOUND');
  assert.ok(db.calls.every(c => c[0] === 'vehicles'));
});
test('no saved photo returns empty and broken storage never reports success', async () => {
  assert.equal(await garagePhotoReader(client({ saved: false }), user).read(vehicle), null);
  await assert.rejects(garagePhotoReader(client({ broken: true }), user).read(vehicle), e => e.status === 503);
});
test('photo HTTP boundary is private, uncached, account-bound and fails closed', async () => {
  const request = new Request('https://skycar.test/photo');
  const handle = createGaragePhotoReadHandler(async () => ({ repository: garagePhotoReader(client(), user), userId: user }));
  const response = await handle(request, vehicle);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('x-skycar-account'), user);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal((await response.arrayBuffer()).byteLength, 256);
  const anonymous = createGaragePhotoReadHandler(async () => { throw new GarageError('UNAUTHENTICATED', 401, 'Sign in.'); });
  assert.equal((await anonymous(request, vehicle)).status, 401);
  assert.equal((await handle(request, 'invalid')).status, 400);
});
