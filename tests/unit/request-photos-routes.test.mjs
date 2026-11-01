import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { journeyBoundary, journeyJson, boundedBody, JourneyError } from '../../src/server/care/journey/http.ts';
import {
  PHOTO_UPLOAD_LIMIT, PHOTO_UPLOAD_WINDOW_SECONDS,
  PhotoError, handlePhotoUpload, healPhotoMarker, recordedPhotoSet, recordRequestPhotos, releasePhotoSlot, reservePhotoSlot, saveGuestIntakePhotos, savePhotoSet,
} from '../../src/server/care/journey/photo-service.mjs';
import { manifestDigest, readGuestPhotos, storeCarePhotos, verifyStoredCarePhotos } from '../../src/server/care/guest-photos.mjs';
import { isTrustedWriteOrigin } from '../../src/server/http/request-origin.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = '11111111-1111-4111-8111-111111111111';
const SECRET = 'sb_secret_UNIT_TEST_SERVICE_KEY';
const WINDOW = '2026-11-01T00:00:00+00:00';
const jpeg = size => { const bytes = new Uint8Array(size).fill(7); bytes.set([0xff, 0xd8, 0xff]); return bytes; };
const photo = (size = 300, type = 'image/jpeg', bytes = jpeg(size)) => new File([bytes], 'p', { type });
const upload = (count = 1, headers = {}, url = `https://skycar.test/api/v1/care/journey/${id}/photos`, base = 300) => {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append('photos', photo(base + i));
  return new Request(url, { method: 'POST', body: form, headers: { origin: 'https://skycar.test', ...headers } });
};
const accountAccess = (actor = owner, requestId = id) => ({ id: requestId, kind: 'account', account: actor, admin: false, db: {} });
const guestAccess = requestId => ({ id: requestId, kind: 'guest', account: `guest:${requestId}`, admin: false, db: {} });
const uuid = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const urlFor = requestId => `https://skycar.test/api/v1/care/journey/${requestId}/photos`;
const prefixOf = access => `${access.kind === 'guest' ? 'guest-requests' : 'care-requests'}/${access.id}`;

// Stateful fake of the database and Storage. reserve is one atomic step per call like the
// SQL upsert; release floors at zero; the marker is write-once per request and conflicts on a
// different hash; every Storage call is counted so tests can assert zero I/O.
function world({ limit = PHOTO_UPLOAD_LIMIT, failReserve = false } = {}) {
  const counts = new Map(); const markers = new Map(); const objects = new Map();
  const calls = { reserve: 0, release: 0, record: 0, lookup: 0, heal: 0 };
  const io = { upload: 0, download: 0 };
  const flags = { storageFail: 0, markerFail: 0, healFail: 0, noMetadata: false, beforeRecord: null, journeyOpen: true };
  const db = {
    async rpc(name, args) {
      await Promise.resolve();
      if (name === 'care_reserve_photo_upload_slot') {
        calls.reserve += 1;
        if (failReserve) return { data: null, error: { code: 'XX000', message: `boom ${SECRET}` } };
        const used = counts.get(args.p_subject) ?? 0;
        if (used >= args.p_limit) return { data: { allowed: false, used, remaining: 0, window_start: WINDOW, retry_after_seconds: 1234 }, error: null };
        counts.set(args.p_subject, used + 1);
        return { data: { allowed: true, used: used + 1, remaining: args.p_limit - used - 1, window_start: WINDOW, retry_after_seconds: 0 }, error: null };
      }
      if (name === 'care_release_photo_upload_slot') {
        calls.release += 1;
        const used = counts.get(args.p_subject) ?? 0;
        if (used > 0) counts.set(args.p_subject, used - 1);
        return { data: { released: used > 0 }, error: null };
      }
      if (name === 'care_record_request_photos') {
        calls.record += 1;
        if (flags.beforeRecord) { const hook = flags.beforeRecord; flags.beforeRecord = null; await hook(); }
        if (flags.markerFail > 0) { flags.markerFail -= 1; return { data: null, error: { code: '57014', message: SECRET } }; }
        const current = markers.get(args.p_request_id);
        if (current && current.request_kind !== args.p_kind) return { data: null, error: { code: 'P0001', message: 'IDEMPOTENCY_CONFLICT' } };
        if (current?.marker_state === 'legacy_unknown') {
          markers.set(args.p_request_id, { ...current, marker_state: 'recorded', manifest_sha256: args.p_manifest_sha256, photo_count: args.p_count });
          return { data: { request_id: args.p_request_id, photo_count: args.p_count, replayed: false }, error: null };
        }
        if (current && (current.manifest_sha256 !== args.p_manifest_sha256 || current.photo_count !== args.p_count)) return { data: null, error: { code: 'P0001', message: 'IDEMPOTENCY_CONFLICT' } };
        if (!current) markers.set(args.p_request_id, { manifest_sha256: args.p_manifest_sha256, photo_count: args.p_count, request_kind: args.p_kind, marker_state: 'recorded' });
        return { data: { request_id: args.p_request_id, photo_count: args.p_count, replayed: Boolean(current) }, error: null };
      }
      if (name === 'care_heal_request_photo_marker') {
        calls.heal += 1;
        if (flags.healFail > 0) { flags.healFail -= 1; return { data: null, error: { code: '57014', message: SECRET } }; }
        let current = markers.get(args.p_request_id);
        // Mirrors the SQL: Storage METADATA only (names), manifest + consecutive photo-1..N, never a hash.
        const folder = args.p_kind === 'guest' ? 'guest-requests' : 'care-requests';
        const names = [...objects.keys()].filter(name => name.startsWith(`${folder}/${args.p_request_id}/`)).map(name => name.split('/')[2]);
        const slots = names.filter(name => /^photo-\d+$/.test(name)).sort();
        const complete = names.includes('manifest.json') && slots.length >= 1 && slots.length <= 3 && slots.every((name, index) => name === `photo-${index + 1}`);
        let healed = false;
        if (!current && complete && !flags.noMetadata) { current = { manifest_sha256: null, photo_count: slots.length, request_kind: args.p_kind, marker_state: 'legacy_unknown' }; markers.set(args.p_request_id, current); healed = true; }
        if (!current) return { data: { state: 'none', healed: false }, error: null };
        return { data: { request_id: args.p_request_id, photo_count: current.photo_count, state: current.marker_state, manifest_sha256: current.manifest_sha256, healed }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) {
      assert.equal(table, 'care_request_photo_sets');
      return { select: () => ({ eq: (_c1, requestId) => ({ eq: (_c2, kind) => ({ async maybeSingle() {
        calls.lookup += 1; const row = markers.get(requestId);
        return { data: row && row.request_kind === kind ? { manifest_sha256: row.manifest_sha256, photo_count: row.photo_count, marker_state: row.marker_state } : null, error: null };
      } }) }) }) };
    },
  };
  const bucket = {
    async upload(path, bytes) {
      io.upload += 1;
      if (flags.storageFail > 0) { flags.storageFail -= 1; return { error: { message: `storage down ${SECRET}` } }; }
      if (objects.has(path)) return { error: { message: 'exists' } };
      objects.set(path, Buffer.from(bytes)); return { error: null };
    },
    async download(path) { io.download += 1; return objects.has(path) ? { data: new Blob([objects.get(path)]), error: null } : { data: null, error: { message: 'missing' } }; },
  };
  return { db, bucket, counts, markers, objects, calls, io, flags, limit, used: (actor = owner) => counts.get(`journey-photos:${actor}`) ?? 0, storageCalls: () => io.upload + io.download };
}

// save() mirrors repository.ts saveJourneyPhotos by calling the real savePhotoSet.
function harness({ access = async (_request, requestId) => accountAccess(owner, requestId), state = world(), storageFailures = 0, markerFailures = 0 } = {}) {
  const events = []; const saves = [];
  state.flags.storageFail += storageFailures; state.flags.markerFail += markerFailures;
  const deps = {
    access: async (...args) => { events.push('access'); return access(...args); },
    isTrustedWrite: request => { events.push('csrf'); return isTrustedWriteOrigin(request); },
    recordedSet: async value => { events.push('lookup'); return recordedPhotoSet(state.db, value.id, value.kind); },
    healMarker: async value => { events.push('heal'); return healPhotoMarker(state.db, value.id, value.kind); },
    reserveQuota: async value => { events.push('reserve'); return reservePhotoSlot(state.db, value); },
    releaseQuota: async (_value, reservation) => { events.push('release'); return releasePhotoSlot(state.db, reservation); },
    readBody: async (...args) => { events.push('body'); return boundedBody(...args); },
    readPhotos: readGuestPhotos,
    save: async (value, photos, completion) => {
      events.push('save'); saves.push({ value, photos, completion });
      return savePhotoSet({ db: state.db, bucket: state.bucket, prefix: completion ? `care-completion/${value.id}` : prefixOf(value), photos, requestId: value.id, kind: value.kind, completion, stateOpen: state.flags.journeyOpen });
    },
  };
  const post = (request, requestId = id) => journeyBoundary(async () => { const r = await handlePhotoUpload(request, requestId, deps); return journeyJson(r.data, r.status, r.account); });
  return { post, saves, events, state };
}
const post = (h, n, count = 1, base = 300) => h.post(upload(count, {}, urlFor(uuid(n)), base), uuid(n));

test('upload checks ownership, CSRF and the recorded set, reserves, and only then reads the body; success keeps exactly one slot', async () => {
  const h = harness();
  const response = await h.post(upload(2));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { stored: 2 } });
  assert.equal(response.headers.get('x-skycar-account'), owner);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(h.events, ['access', 'csrf', 'lookup', 'heal', 'reserve', 'body', 'save']);
  assert.equal(h.saves[0].photos.length, 2);
  assert.equal(h.state.used(), 1);
  assert.equal(h.state.calls.release, 0);
  assert.equal(h.state.markers.size, 1);
  assert.equal(h.state.markers.get(id).manifest_sha256, manifestDigest(h.saves[0].photos).manifestSha256, 'the marker holds the manifest hash');
  assert.equal(PHOTO_UPLOAD_LIMIT, 10); assert.equal(PHOTO_UPLOAD_WINDOW_SECONDS, 3600);
});

test('ownership denial never looks up, reserves, reads the body or touches Storage', async () => {
  for (const [code, status] of [['NOT_FOUND', 404], ['UNAUTHENTICATED', 401], ['UNAVAILABLE', 503]]) {
    const h = harness({ access: async () => { throw new JourneyError(code); } });
    assert.equal((await h.post(upload())).status, status);
    assert.deepEqual(h.events, ['access']);
    assert.equal(h.state.calls.reserve + h.state.calls.release + h.state.calls.lookup + h.state.storageCalls(), 0);
    assert.equal(h.saves.length, 0);
  }
});

test('guest uploads take no quota but are recorded, and guest replays then cost zero Storage I/O', async () => {
  const state = world();
  const h = harness({ state, access: async (_r, requestId) => guestAccess(requestId) });
  assert.equal((await post(h, 1)).status, 201);
  assert.equal(state.calls.reserve, 0);
  assert.deepEqual([...state.markers.values()].map(row => row.request_kind), ['guest']);
  state.io.upload = 0; state.io.download = 0;
  const replays = await Promise.all(Array.from({ length: 40 }, () => post(h, 1)));
  assert.deepEqual(replays.map(response => response.status), Array(40).fill(201));
  assert.equal(state.storageCalls(), 0, 'guest replays do no Storage I/O');
  assert.equal((await post(h, 1, 1, 777)).status, 409, 'a different set is the existing conflict');
  assert.equal(state.storageCalls(), 0);
  assert.equal(state.calls.reserve, 0);
});

test('admin completion evidence takes no quota and never uses the marker', async () => {
  const h = harness();
  const form = new FormData(); form.append('photos', photo());
  const completion = new Request('https://skycar.test/x?kind=completion', { method: 'POST', body: form, headers: { origin: 'https://skycar.test' } });
  assert.equal((await h.post(completion)).status, 201);
  assert.equal(h.state.calls.reserve + h.state.calls.lookup + h.state.calls.record, 0);
  assert.equal(h.saves.at(-1).completion, true);
  assert.equal(h.state.markers.size, 0);
});

test('wrong content type and failed CSRF are rejected before any lookup, quota or Storage call', async () => {
  const h = harness();
  const json = new Request('https://skycar.test/x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://skycar.test' } });
  assert.equal((await h.post(json)).status, 400);
  assert.equal((await h.post(upload(1, { origin: 'https://evil.test' }))).status, 403);
  assert.equal(h.state.calls.reserve + h.state.calls.lookup + h.state.storageCalls(), 0);
  assert.equal(h.state.used(), 0);
});

test('invalid and rejected bodies never burn quota or touch Storage, even far past the limit', async () => {
  const h = harness();
  const bad = [
    () => { const f = new FormData(); f.append('photos', photo(300)); f.append('extra', 'x'); return f; },
    () => { const f = new FormData(); f.append('photos', photo(300, 'image/jpeg', new Uint8Array(300).fill(1))); return f; },
    () => { const f = new FormData(); f.append('photos', photo(50)); return f; },
    () => new FormData(),
    () => { const f = new FormData(); for (let i = 0; i < 4; i++) f.append('photos', photo(300 + i)); return f; },
    () => { const f = new FormData(); f.append('photos', new File([new Uint8Array(900_001).fill(7).fill(0xff, 0, 3)], 'big', { type: 'image/jpeg' })); return f; },
  ];
  let attempts = 0;
  for (let round = 0; round < 3; round++) for (const make of bad) {
    attempts += 1;
    const response = await h.post(new Request(urlFor(id), { method: 'POST', body: make(), headers: { origin: 'https://skycar.test' } }));
    assert.ok([400, 413].includes(response.status), `status ${response.status}`);
  }
  assert.ok(attempts > PHOTO_UPLOAD_LIMIT);
  assert.equal(h.state.used(), 0, 'no slot is retained');
  assert.equal(h.state.calls.reserve, attempts);
  assert.equal(h.state.calls.release, attempts, 'every reserved slot was released');
  assert.equal(h.state.storageCalls(), 0);
  const huge = new Request(urlFor(id), { method: 'POST', body: new Blob([new Uint8Array(2_900_000)]), headers: { origin: 'https://skycar.test', 'content-type': 'multipart/form-data; boundary=x' } });
  assert.equal((await h.post(huge)).status, 413);
  assert.equal(h.state.used(), 0);
  assert.equal((await h.post(upload())).status, 201);
  assert.equal(h.state.used(), 1);
});

test('invalid bodies against an already recorded request are rejected before the hash compare and cost no Storage I/O', async () => {
  const h = harness();
  assert.equal((await h.post(upload(2))).status, 201);
  const before = h.state.storageCalls();
  const bad = new Request(urlFor(id), { method: 'POST', body: new FormData(), headers: { origin: 'https://skycar.test' } });
  assert.equal((await h.post(bad)).status, 400);
  assert.equal(h.state.storageCalls(), before);
  assert.equal(h.state.used(), 1);
});

test('a 503 (storage or marker failure) releases the slot and the identical retry is charged exactly once', async () => {
  const h = harness({ storageFailures: 1, markerFailures: 1 });
  assert.equal((await h.post(upload(2))).status, 503, 'storage failure');
  assert.equal(h.state.used(), 0);
  assert.equal((await h.post(upload(2))).status, 503, 'marker failure after the objects were written');
  assert.equal(h.state.used(), 0);
  assert.equal(h.state.markers.size, 0);
  assert.equal((await h.post(upload(2))).status, 201);
  // The marker-503 call stored the whole set, so the retry heals it from Storage metadata for
  // free (quota-free heal) and then records the real hash: that set is never charged.
  assert.equal(h.state.used(), 0, 'a set whose marker write failed is healed free');
  assert.equal(h.state.calls.reserve, 2); assert.equal(h.state.calls.release, 2);
  assert.equal(h.state.markers.size, 1);
  assert.equal(h.state.markers.get(id).marker_state, 'recorded');
  assert.equal(h.state.markers.get(id).manifest_sha256.length, 64);
});

test('503-then-retry for ten different requests never reaches the limit', async () => {
  const h = harness();
  for (let n = 1; n <= 10; n++) {
    h.state.flags.storageFail += 1;
    assert.equal((await post(h, n)).status, 503);
    assert.equal((await post(h, n)).status, 201);
  }
  assert.equal(h.state.used(), 10);
  assert.equal((await post(h, 11)).status, 429);
});

test('replay of a recorded set is free at the limit and does zero Storage I/O; a different set is the existing conflict, also free', async () => {
  const h = harness();
  for (let n = 1; n <= 10; n++) assert.equal((await post(h, n)).status, 201);
  assert.equal(h.state.used(), 10);
  const reserves = h.state.calls.reserve; const saves = h.saves.length;
  h.state.io.upload = 0; h.state.io.download = 0;
  for (let i = 0; i < 5; i++) assert.equal((await post(h, 1)).status, 201, 'identical replay at the limit');
  assert.equal(h.state.storageCalls(), 0, 'no Storage call for a replay');
  const conflict = await post(h, 1, 2);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.state.storageCalls(), 0, 'no Storage call for a conflicting set');
  assert.equal(h.state.used(), 10);
  assert.equal(h.state.calls.reserve, reserves, 'replays never reserve');
  assert.equal(h.saves.length, saves, 'save is never reached');
  assert.equal((await post(h, 11)).status, 429, 'a brand new request is still limited');
});

test('40 concurrent replays and 40 concurrent conflicting sets cause zero Storage calls (account)', async () => {
  const h = harness();
  assert.equal((await h.post(upload(2))).status, 201);
  h.state.io.upload = 0; h.state.io.download = 0;
  const lookups = h.state.calls.lookup; const reserves = h.state.calls.reserve; const records = h.state.calls.record;
  const replays = await Promise.all(Array.from({ length: 40 }, () => h.post(upload(2))));
  assert.deepEqual(replays.map(response => response.status), Array(40).fill(201));
  assert.deepEqual([h.state.io.upload, h.state.io.download], [0, 0], '40 replays: 0 uploads and 0 downloads');
  const conflicts = await Promise.all(Array.from({ length: 40 }, () => h.post(upload(3))));
  assert.deepEqual(conflicts.map(response => response.status), Array(40).fill(409));
  assert.deepEqual([h.state.io.upload, h.state.io.download], [0, 0], '40 conflicts: 0 uploads and 0 downloads');
  assert.equal(h.state.calls.lookup - lookups, 80, 'one primary-key read each');
  assert.equal(h.state.calls.reserve, reserves); assert.equal(h.state.calls.record, records, 'no writes at all');
  assert.equal(h.state.used(), 1);
});

test('legacy sets (objects stored, no marker) heal quota-free from metadata, upgrade to the real hash, then replays are free', async () => {
  const h = harness();
  const first = await readGuestPhotos([photo(300), photo(301)]);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess()), first);
  assert.equal(h.state.markers.size, 0);
  assert.equal((await h.post(upload(2))).status, 201);
  assert.deepEqual(h.events, ['access', 'csrf', 'lookup', 'heal', 'body', 'save'], 'no quota step for a legacy request');
  assert.equal(h.state.markers.size, 1);
  assert.equal(h.state.markers.get(id).marker_state, 'recorded');
  assert.equal(h.state.markers.get(id).manifest_sha256, manifestDigest(first).manifestSha256, 'the hash comes from the body, verified against Storage');
  assert.equal(h.state.calls.reserve, 0); assert.equal(h.state.used(), 0, 'legacy healing never consumes quota');
  h.state.io.upload = 0; h.state.io.download = 0;
  assert.equal((await h.post(upload(2))).status, 201);
  assert.equal(h.state.storageCalls(), 0);
  assert.equal(h.state.used(), 0);
});

test('legacy heal works at the upload limit: no reserve, no 429, no new objects, real hash recorded', async () => {
  const h = harness();
  for (let n = 1; n <= PHOTO_UPLOAD_LIMIT; n++) assert.equal((await post(h, n)).status, 201);
  assert.equal(h.state.used(), PHOTO_UPLOAD_LIMIT);
  assert.equal((await post(h, 99, 1, 700)).status, 429, 'the account is at its limit');
  const legacyId = uuid(50);
  const stored = await readGuestPhotos([photo(400), photo(401)]);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess(owner, legacyId)), stored);
  const objectsBefore = h.state.objects.size; const reserves = h.state.calls.reserve;
  assert.equal((await h.post(upload(2, {}, urlFor(legacyId), 400), legacyId)).status, 201, 'identical re-send heals at the limit');
  assert.equal(h.state.calls.reserve, reserves, 'not even a reservation attempt');
  assert.equal(h.state.used(), PHOTO_UPLOAD_LIMIT);
  assert.equal(h.state.objects.size, objectsBefore, 'nothing new in Storage');
  assert.equal(h.state.markers.get(legacyId).manifest_sha256, manifestDigest(stored).manifestSha256);
  // A different body for the same legacy request is the write-once conflict, still free.
  const other = uuid(51);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess(owner, other)), stored);
  const conflict = await h.post(upload(2, {}, urlFor(other), 500), other);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.state.markers.get(other).marker_state, 'legacy_unknown', 'the marker stays legacy, never a fabricated hash');
  assert.equal(h.state.markers.get(other).manifest_sha256, null);
  assert.equal(h.state.used(), PHOTO_UPLOAD_LIMIT);
});

test('a legacy_unknown marker skips the heal and the quota; the identical re-send upgrades it', async () => {
  const h = harness();
  const stored = await readGuestPhotos([photo(300), photo(301)]);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess()), stored);
  h.state.markers.set(id, { manifest_sha256: null, photo_count: 2, request_kind: 'account', marker_state: 'legacy_unknown' });
  assert.equal((await h.post(upload(2))).status, 201);
  assert.deepEqual(h.events, ['access', 'csrf', 'lookup', 'body', 'save']);
  assert.equal(h.state.calls.heal, 0); assert.equal(h.state.calls.reserve, 0);
  assert.equal(h.state.markers.get(id).marker_state, 'recorded');
  assert.equal(h.state.markers.get(id).manifest_sha256, manifestDigest(stored).manifestSha256);
  // A different body against a legacy marker is the Storage-level conflict and leaves it legacy.
  const other = uuid(60);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess(owner, other)), stored);
  h.state.markers.set(other, { manifest_sha256: null, photo_count: 2, request_kind: 'account', marker_state: 'legacy_unknown' });
  assert.equal((await h.post(upload(2, {}, urlFor(other), 900), other)).status, 409);
  assert.equal(h.state.markers.get(other).marker_state, 'legacy_unknown');
  assert.equal(h.state.used(), 0);
});

test('a partial legacy set is completed by the identical re-send without quota; a set with a gap is not healed', async () => {
  const h = harness();
  const photos = await readGuestPhotos([photo(300), photo(301)]);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess()), photos);
  h.state.objects.delete(`${prefixOf(accountAccess())}/photo-2`);
  assert.equal((await h.post(upload(2))).status, 201);
  assert.equal(h.state.used(), 0);
  assert.equal(h.state.markers.get(id).photo_count, 2);
  assert.notEqual(await verifyStoredCarePhotos(h.state.bucket, prefixOf(accountAccess()), photos), null, 'the missing slot was written');
  const gap = harness();
  await storeCarePhotos(gap.state.bucket, prefixOf(accountAccess()), photos);
  gap.state.objects.delete(`${prefixOf(accountAccess())}/photo-1`);
  assert.equal(await healPhotoMarker(gap.state.db, id, 'account'), null, 'photo-2 without photo-1 is not a set');
  assert.equal(gap.state.markers.size, 0);
  assert.equal((await gap.post(upload(2))).status, 201, 'the normal charged path still works');
  assert.equal(gap.state.used(), 1);
});

test('a failing or metadata-blind heal falls back to the charged path and never breaks the upload', async () => {
  for (const mode of ['healFail', 'noMetadata']) {
    const h = harness();
    const photos = await readGuestPhotos([photo(300), photo(301)]);
    await storeCarePhotos(h.state.bucket, prefixOf(accountAccess()), photos);
    if (mode === 'healFail') h.state.flags.healFail = 1; else h.state.flags.noMetadata = true;
    assert.equal((await h.post(upload(2))).status, 201, mode);
    assert.equal(h.state.calls.reserve, 1, `${mode}: the old path reserves`);
    assert.equal(h.state.used(), 1, `${mode}: charged once, by the call that recorded the set`);
    assert.equal(h.state.markers.get(id).marker_state, 'recorded');
    assert.equal((await h.post(upload(2))).status, 201);
    assert.equal(h.state.used(), 1, 'replay is free');
  }
});

test('invalid bodies never cause Storage I/O or a heal write; heal precedes only quota and body', async () => {
  const h = harness();
  const photos = await readGuestPhotos([photo(300)]);
  await storeCarePhotos(h.state.bucket, prefixOf(accountAccess()), photos);
  h.state.io.upload = 0; h.state.io.download = 0;
  const bad = new Request(urlFor(id), { method: 'POST', body: new FormData(), headers: { origin: 'https://skycar.test' } });
  assert.equal((await h.post(bad)).status, 400);
  assert.equal(h.state.storageCalls(), 0, 'no Storage API call for an invalid body');
  assert.equal(h.state.used(), 0);
});

test('race: a heal landing between the upload reserving a slot and recording keeps that slot (the upgrade counts as creation)', async () => {
  const h = harness();
  h.state.flags.beforeRecord = () => healPhotoMarker(h.state.db, id, 'account');
  assert.equal((await h.post(upload(2))).status, 201);
  assert.equal(h.state.markers.get(id).marker_state, 'recorded');
  assert.equal(h.state.used(), 1, 'the set was created by this call: the slot is kept, so the limit cannot be bypassed');
  assert.equal(h.state.calls.release, 0);
});

test('marker 503 then a journey transition: the identical retry heals the marker without writing to Storage', async () => {
  const h = harness({ markerFailures: 1 });
  assert.equal((await h.post(upload(2))).status, 503);
  assert.equal(h.state.markers.size, 0, 'has_photos would be false while photos exist');
  assert.equal(h.state.used(), 0);
  h.state.flags.journeyOpen = false; // the journey moved on (e.g. quote selected)
  h.state.io.upload = 0; h.state.io.download = 0;
  const healed = await h.post(upload(2));
  assert.equal(healed.status, 201);
  assert.equal(h.state.markers.get(id).marker_state, 'recorded');
  assert.equal(h.state.markers.size, 1, 'marker healed');
  assert.equal(h.state.io.upload, 0, 'healing writes nothing to Storage');
  assert.equal(h.state.used(), 0, 'healing a legacy set is quota-free');
  h.state.io.download = 0;
  assert.equal((await h.post(upload(2))).status, 201);
  assert.equal(h.state.storageCalls(), 0, 'then replays are free');
});

test('after a transition only an identical complete stored set may heal; anything else stays INVALID_TRANSITION', async () => {
  const h = harness({ markerFailures: 1 });
  assert.equal((await h.post(upload(2))).status, 503);
  h.state.flags.journeyOpen = false;
  const uploadsBefore = h.state.io.upload;
  const different = await h.post(upload(2, {}, urlFor(id), 500));
  assert.equal(different.status, 409);
  assert.equal((await different.json()).error.code, 'INVALID_TRANSITION');
  assert.equal(h.state.markers.get(id).marker_state, 'legacy_unknown', 'the stored set is real, so it reports photos, with no hash');
  assert.equal(h.state.markers.get(id).manifest_sha256, null);
  assert.equal(h.state.io.upload, uploadsBefore, 'nothing new is written after the transition');
  assert.equal(h.state.used(), 0, 'no quota involved');
  // A partial stored set (a missing slot) is not healed.
  const partial = harness();
  const photos = await readGuestPhotos([photo(300), photo(301)]);
  await storeCarePhotos(partial.state.bucket, prefixOf(accountAccess()), photos);
  partial.state.objects.delete(`${prefixOf(accountAccess())}/photo-2`);
  partial.state.flags.journeyOpen = false;
  const response = await partial.post(upload(2));
  assert.equal(response.status, 409);
  assert.equal(partial.state.markers.get(id).marker_state, 'legacy_unknown', 'a manifest plus photo-1 is observed, never upgraded to recorded');
  assert.equal(partial.state.used(), 0, 'legacy request: no quota involved');
  // Nothing stored at all: nothing is written once the journey moved on.
  const empty = harness(); empty.state.flags.journeyOpen = false;
  assert.equal((await empty.post(upload(1))).status, 409);
  assert.equal(empty.state.io.upload, 0);
  assert.equal(await verifyStoredCarePhotos(partial.state.bucket, prefixOf(accountAccess()), photos), null);
});

test('a concurrent race that records the same new set twice keeps one slot', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({ length: 6 }, () => h.post(upload())));
  assert.deepEqual(responses.map(response => response.status), Array(6).fill(201));
  assert.equal(h.state.markers.size, 1);
  assert.equal(h.state.used(), 1, 'only the call that created the marker keeps its slot');
  assert.equal(h.state.calls.release, 5);
});

test('rate limit boundary: the 10th new set succeeds, the 11th is 429 with Retry-After and stores nothing', async () => {
  const h = harness();
  for (let n = 1; n <= 10; n++) assert.equal((await post(h, n)).status, 201, `upload ${n}`);
  const stored = h.state.objects.size;
  const limited = await post(h, 11);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1234');
  assert.equal(limited.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await limited.json(), { error: { code: 'RATE_LIMITED', message: 'Too many photo uploads. Wait a little, then retry the same photos.', retryable: true } });
  assert.equal(h.state.objects.size, stored);
  assert.equal(h.state.calls.release, 0, 'a denied reservation holds nothing to release');
  const other = harness({ state: h.state, access: async (_r, requestId) => accountAccess('22222222-2222-4222-8222-222222222222', requestId) });
  assert.equal((await post(other, 30)).status, 201);
});

test('failure releases the slot; a failed release never masks the original error', async () => {
  const h = harness({ storageFailures: 1 });
  assert.equal((await h.post(upload())).status, 503);
  assert.equal(h.state.calls.release, 1);
  assert.equal(h.state.used(), 0);
  const broken = world();
  const original = broken.db.rpc.bind(broken.db);
  broken.db.rpc = async (name, args) => { if (name === 'care_release_photo_upload_slot') throw new Error(`down ${SECRET}`); return original(name, args); };
  const g = harness({ state: broken, storageFailures: 1 });
  const response = await g.post(upload());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(SECRET), false);
  assert.equal(broken.used(), 1, 'a failed release is conservative: the slot stays held until the window ends');
});

test('rate limiting fails closed: an unreadable counter stores nothing and leaks no detail', async () => {
  const h = harness({ state: world({ failReserve: true }) });
  const response = await h.post(upload());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(SECRET), false);
  assert.equal(h.state.storageCalls(), 0);
});

test('Retry-After is bounded by the window even if the database reports a larger value', async () => {
  const db = { async rpc() { return { data: { allowed: false, retry_after_seconds: 999999 }, error: null }; } };
  await assert.rejects(reservePhotoSlot(db, accountAccess()), error => error.code === 'RATE_LIMITED' && error.retryAfter === 3600);
  await assert.rejects(reservePhotoSlot({ async rpc() { return { data: { allowed: false, retry_after_seconds: 0 }, error: null }; } }, accountAccess(), { windowSeconds: 600 }), error => error.retryAfter === 600);
});

test('30 concurrent uploads of new sets from one account keep the limit exact; each loser stores nothing', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({ length: 30 }, (_, n) => post(h, n + 1)));
  const statuses = responses.map(response => response.status);
  assert.equal(statuses.filter(status => status === 201).length, 10);
  assert.equal(statuses.filter(status => status === 429).length, 20);
  assert.equal(h.saves.length, 10);
  assert.equal(h.state.used(), 10);
  assert.equal(h.state.markers.size, 10);
});

test('concurrent valid and invalid uploads settle with the count equal to the stored sets', async () => {
  const h = harness();
  const invalid = () => new Request(urlFor(id), { method: 'POST', body: new FormData(), headers: { origin: 'https://skycar.test' } });
  const calls = Array.from({ length: 30 }, (_, n) => n % 2 ? h.post(invalid(), uuid(n + 1)) : post(h, n + 1));
  const statuses = (await Promise.all(calls)).map(response => response.status);
  const created = statuses.filter(status => status === 201).length;
  assert.ok(created <= PHOTO_UPLOAD_LIMIT);
  assert.equal(h.state.used(), created, 'slots held after settling are exactly the sets stored');
  assert.equal(h.state.markers.size, created);
  assert.ok(statuses.every(status => [201, 400, 429].includes(status)));
});

test('storeCarePhotos returns the SHA-256 of the manifest it wrote and is null for no photos', async () => {
  const objects = new Map();
  const bucket = { async upload(path, bytes) { if (objects.has(path)) return { error: { message: 'exists' } }; objects.set(path, Buffer.from(bytes)); return { error: null }; }, async download(path) { return objects.has(path) ? { data: new Blob([objects.get(path)]), error: null } : { error: { message: 'missing' } }; } };
  const photos = await readGuestPhotos([photo(300), photo(400)]);
  const stored = await storeCarePhotos(bucket, `care-requests/${id}`, photos);
  assert.deepEqual(stored, { count: 2, manifestSha256: createHash('sha256').update(objects.get(`care-requests/${id}/manifest.json`)).digest('hex') });
  assert.deepEqual(await storeCarePhotos(bucket, `care-requests/${id}`, photos), stored, 'identical retry returns the same marker input');
  assert.equal(await storeCarePhotos(bucket, 'x', []), null);
});

test('marker recording passes only counts and hashes, maps a conflict and fails retryably', async () => {
  const calls = [];
  const ok = { async rpc(name, args) { calls.push([name, args]); return { data: { request_id: id, photo_count: 2, replayed: false }, error: null }; } };
  await recordRequestPhotos(ok, id, { count: 2, manifestSha256: 'a'.repeat(64) }, 'guest');
  assert.deepEqual(calls, [['care_record_request_photos', { p_request_id: id, p_count: 2, p_manifest_sha256: 'a'.repeat(64), p_kind: 'guest' }]]);
  await assert.rejects(recordRequestPhotos({ async rpc() { return { data: null, error: { code: 'P0001', message: 'IDEMPOTENCY_CONFLICT' } }; } }, id, { count: 1, manifestSha256: 'a'.repeat(64) }), error => error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(recordRequestPhotos({ async rpc() { return { data: null, error: { code: '57014', message: SECRET } }; } }, id, { count: 1, manifestSha256: 'a'.repeat(64) }), error => error.code === 'UNAVAILABLE' && !error.message.includes(SECRET));
});

test('the recorded-set lookup filters by kind, maps both states and treats errors or corrupt rows as not recorded', async () => {
  const seen = [];
  const lookup = row => ({ from: () => ({ select: cols => ({ eq: (c1, v1) => ({ eq: (c2, v2) => ({ maybeSingle: async () => { seen.push([cols, c1, v1, c2, v2]); return { data: row, error: null }; } }) }) }) }) });
  const hash = 'd'.repeat(64);
  assert.deepEqual(await recordedPhotoSet(lookup({ manifest_sha256: hash, photo_count: 2, marker_state: 'recorded' }), id, 'guest'), { state: 'recorded', manifestSha256: hash, count: 2 });
  assert.deepEqual(seen, [['manifest_sha256,photo_count,marker_state', 'request_id', id, 'request_kind', 'guest']]);
  assert.deepEqual(await recordedPhotoSet(lookup({ manifest_sha256: null, photo_count: 2, marker_state: 'legacy_unknown' }), id), { state: 'legacy_unknown', manifestSha256: null, count: 2 });
  for (const bad of [{ manifest_sha256: null, photo_count: 2, marker_state: 'recorded' }, { manifest_sha256: hash, photo_count: 2, marker_state: 'legacy_unknown' }, { manifest_sha256: hash, photo_count: 4, marker_state: 'recorded' }, { manifest_sha256: hash, photo_count: 2, marker_state: 'x' }, null]) {
    assert.equal(await recordedPhotoSet(lookup(bad), id), null, JSON.stringify(bad));
  }
  assert.equal(await recordedPhotoSet({ from() { throw new Error(SECRET); } }, id), null);
  const errored = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { manifest_sha256: hash, photo_count: 2, marker_state: 'recorded' }, error: { message: 'x' } }) }) }) }) }) };
  assert.equal(await recordedPhotoSet(errored, id), null);
});

test('healPhotoMarker maps the RPC states, passes id and kind, and fails closed without leaking detail', async () => {
  const seen = []; const reply = data => ({ rpc: async (name, args) => { seen.push([name, args]); return { data, error: null }; } });
  const hash = 'e'.repeat(64);
  assert.equal(await healPhotoMarker(reply({ state: 'none', healed: false }), id, 'account'), null);
  assert.deepEqual(await healPhotoMarker(reply({ state: 'legacy_unknown', photo_count: 3, manifest_sha256: null }), id, 'guest'), { state: 'legacy_unknown', manifestSha256: null, count: 3 });
  assert.deepEqual(await healPhotoMarker(reply({ state: 'recorded', photo_count: 1, manifest_sha256: hash }), id), { state: 'recorded', manifestSha256: hash, count: 1 });
  assert.deepEqual(seen[0], ['care_heal_request_photo_marker', { p_request_id: id, p_kind: 'account' }]);
  assert.equal(seen[1][1].p_kind, 'guest');
  for (const broken of [{ data: null, error: { message: SECRET } }, { data: null, error: null }, { data: { state: 5 }, error: null }]) {
    await assert.rejects(healPhotoMarker({ rpc: async () => broken }, id), error => error instanceof PhotoError && error.code === 'UNAVAILABLE' && !String(error.message).includes(SECRET));
  }
});

test('guest intake records the marker after storing, compares replays with the marker before any Storage call, and upgrades legacy guests', async () => {
  const guestId = uuid(70); const dir = `guest-requests/${guestId}`;
  const files = (base = 300, n = 2) => Promise.all(Array.from({ length: n }, (_, i) => photo(base + i))).then(readGuestPhotos);
  const run = (state, photos, requestId = guestId) => saveGuestIntakePhotos({ db: state.db, bucket: state.bucket, requestId, photos });
  // No photos: nothing happens.
  const none = world();
  assert.equal(await run(none, []), null);
  assert.deepEqual([none.storageCalls(), none.calls.record], [0, 0]);
  // First intake stores, then records the guest marker with the manifest hash; the guest kind is used.
  const state = world(); const photos = await files();
  const first = await run(state, photos);
  assert.equal(first.replayed, false);
  assert.equal(state.markers.get(guestId).request_kind, 'guest');
  assert.equal(state.markers.get(guestId).manifest_sha256, manifestDigest(photos).manifestSha256);
  assert.equal(state.markers.get(guestId).photo_count, 2);
  assert.ok(state.objects.has(`${dir}/manifest.json`) && state.objects.has(`${dir}/photo-2`));
  assert.equal(state.used(), 0, 'guest intake takes no account quota');
  // An identical replay is decided from the marker: zero Storage I/O, no second record.
  state.io.upload = 0; state.io.download = 0; const records = state.calls.record; const lookups = state.calls.lookup;
  assert.equal((await run(state, await files())).replayed, true);
  assert.equal(state.storageCalls(), 0, 'no Storage call before the marker comparison');
  assert.equal(state.calls.record, records); assert.equal(state.calls.lookup, lookups + 1);
  // A different body is a conflict decided from the marker, again without Storage I/O.
  await assert.rejects(run(state, await files(500)), error => error.constructor.name === 'GuestError' && error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(run(state, await files(300, 3)), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(state.storageCalls(), 0);
  // Marker failure after Storage succeeded: UNAVAILABLE, then the identical retry records it.
  const failing = world(); failing.flags.markerFail = 1;
  await assert.rejects(run(failing, photos), error => error.code === 'UNAVAILABLE');
  assert.equal(failing.markers.size, 0);
  assert.equal((await run(failing, photos)).replayed, false);
  assert.equal(failing.markers.get(guestId).marker_state, 'recorded');
  // Storage failure leaves no marker.
  const broken = world(); broken.flags.storageFail = 1;
  await assert.rejects(run(broken, photos), error => error.code === 'UNAVAILABLE');
  assert.equal(broken.markers.size, 0);
  // Legacy guest (marker legacy_unknown, set already stored): the identical body upgrades it; a
  // different body is the write-once conflict and the marker stays legacy.
  const legacy = world();
  await storeCarePhotos(legacy.bucket, dir, photos);
  legacy.markers.set(guestId, { manifest_sha256: null, photo_count: 2, request_kind: 'guest', marker_state: 'legacy_unknown' });
  await assert.rejects(run(legacy, await files(800)), error => error.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(legacy.markers.get(guestId).marker_state, 'legacy_unknown');
  await run(legacy, photos);
  assert.equal(legacy.markers.get(guestId).marker_state, 'recorded');
  assert.equal(legacy.markers.get(guestId).manifest_sha256, manifestDigest(photos).manifestSha256);
});

test('the guest intake route records the marker through saveGuestIntakePhotos instead of storing blindly', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/app/api/v1/care/guest-requests/route.ts', 'utf8');
  assert.match(source, /saveGuestIntakePhotos\(/);
  assert.equal(/storeGuestPhotos\(/.test(source), false);
});

test('route sources never reference service keys and the signed-URL route is gone', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  for (const file of ['src/server/care/journey/photo-service.mjs', 'src/app/api/v1/care/journey/[id]/photos/route.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/secretKey|SECRET|service_role|console\.|createSignedUrl|signedUrl/i.test(source), false, file);
  }
  assert.equal(existsSync('src/app/api/v1/care/journey/[id]/photos/[slot]/url'), false);
  assert.equal(existsSync('src/app/api/v1/care/journey/[id]/photos/[slot]/route.ts'), true, 'the proxy route stays');
});

test('PhotoError carries only a code and retry hint', () => {
  const error = new PhotoError('RATE_LIMITED', 5);
  assert.deepEqual([error.name, error.code, error.retryAfter, error.message], ['PhotoError', 'RATE_LIMITED', 5, 'RATE_LIMITED']);
});
