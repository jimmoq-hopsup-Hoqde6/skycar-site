import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { journeyBoundary, journeyJson, boundedBody, JourneyError } from '../../src/server/care/journey/http.ts';
import {
  PHOTO_UPLOAD_LIMIT, PHOTO_UPLOAD_WINDOW_SECONDS, SIGNED_URL_TTL_SECONDS, MIN_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS,
  PhotoError, clampSignedUrlTtl, handlePhotoUpload, handlePhotoUrl, hasRecordedPhotos, recordRequestPhotos, releasePhotoSlot, reservePhotoSlot, signedPhotoUrl,
} from '../../src/server/care/journey/photo-service.mjs';
import { readGuestPhotos, storeCarePhotos } from '../../src/server/care/guest-photos.mjs';
import { isTrustedWriteOrigin } from '../../src/server/http/request-origin.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = '11111111-1111-4111-8111-111111111111';
const SECRET = 'sb_secret_UNIT_TEST_SERVICE_KEY';
const WINDOW = '2026-11-01T00:00:00+00:00';
const jpeg = size => { const bytes = new Uint8Array(size).fill(7); bytes.set([0xff, 0xd8, 0xff]); return bytes; };
const photo = (size = 300, type = 'image/jpeg', bytes = jpeg(size)) => new File([bytes], 'p', { type });
const upload = (count = 1, headers = {}, url = `https://skycar.test/api/v1/care/journey/${id}/photos`) => {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append('photos', photo(300 + i));
  return new Request(url, { method: 'POST', body: form, headers: { origin: 'https://skycar.test', ...headers } });
};
const accountAccess = (actor = owner, requestId = id) => ({ id: requestId, kind: 'account', account: actor, admin: false, db: {} });

// Stateful fake of the database side. reserve is one atomic step per call like
// the SQL upsert; release floors at zero; markers are write-once per request.
function world({ limit = PHOTO_UPLOAD_LIMIT, failReserve = false } = {}) {
  const counts = new Map(); const markers = new Set(); const calls = { reserve: 0, release: 0, record: 0, check: 0 };
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
        const replayed = markers.has(args.p_request_id); markers.add(args.p_request_id);
        return { data: { request_id: args.p_request_id, photo_count: args.p_count, replayed }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table) { assert.equal(table, 'care_request_photo_sets'); return { select: () => ({ eq: (_c, value) => ({ async maybeSingle() { calls.check += 1; return { data: markers.has(value) ? { request_id: value } : null, error: null }; } }) }) }; },
  };
  return { db, counts, markers, calls, used: (actor = owner) => counts.get(`journey-photos:${actor}`) ?? 0 };
}

// failures: queue of errors for successive save() calls ('storage' fails before the marker; 'marker' fails after storage wrote it).
function harness({ access = async (_request, requestId) => accountAccess(owner, requestId), state = world(), failures = [] } = {}) {
  const saved = []; const events = []; const queue = [...failures];
  const deps = {
    access: async (...args) => { events.push('access'); return access(...args); },
    isTrustedWrite: request => { events.push('csrf'); return isTrustedWriteOrigin(request); },
    hasRecordedPhotos: async value => { events.push('check'); return hasRecordedPhotos(state.db, value.id); },
    reserveQuota: async value => { events.push('reserve'); return reservePhotoSlot(state.db, value); },
    releaseQuota: async (_value, reservation) => { events.push('release'); return releasePhotoSlot(state.db, reservation); },
    readBody: async (...args) => { events.push('body'); return boundedBody(...args); },
    readPhotos: readGuestPhotos,
    save: async (value, photos, completion) => {
      events.push('save');
      const failure = queue.shift();
      if (failure === 'storage') throw new JourneyError('UNAVAILABLE');
      saved.push({ value, photos, completion });
      if (completion || value.kind !== 'account') return null;
      if (failure === 'marker') { state.calls.record += 1; throw new PhotoError('UNAVAILABLE'); }
      return { recorded: await recordRequestPhotos(state.db, value.id, { count: photos.length, manifestSha256: 'c'.repeat(64) }) };
    },
  };
  const post = (request, requestId = id) => journeyBoundary(async () => { const r = await handlePhotoUpload(request, requestId, deps); return journeyJson(r.data, r.status, r.account); });
  return { post, saved, events, state };
}
const uuid = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const urlFor = requestId => `https://skycar.test/api/v1/care/journey/${requestId}/photos`;

test('upload checks ownership, CSRF, then reserves, and only then reads the body; success keeps exactly one slot', async () => {
  const h = harness();
  const response = await h.post(upload(2));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { stored: 2 } });
  assert.equal(response.headers.get('x-skycar-account'), owner);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(h.events, ['access', 'csrf', 'check', 'reserve', 'body', 'save']);
  assert.equal(h.saved[0].photos.length, 2);
  assert.equal(h.state.used(), 1);
  assert.equal(h.state.calls.release, 0);
  assert.equal(PHOTO_UPLOAD_LIMIT, 10); assert.equal(PHOTO_UPLOAD_WINDOW_SECONDS, 3600);
});

test('ownership denial never reserves, reads the body or stores', async () => {
  for (const [code, status] of [['NOT_FOUND', 404], ['UNAUTHENTICATED', 401], ['UNAVAILABLE', 503]]) {
    const h = harness({ access: async () => { throw new JourneyError(code); } });
    assert.equal((await h.post(upload())).status, status);
    assert.deepEqual(h.events, ['access']);
    assert.equal(h.state.calls.reserve + h.state.calls.release, 0);
    assert.equal(h.saved.length, 0);
  }
});

test('guest-cookie and admin completion uploads are not account uploads: no quota is taken', async () => {
  const guest = harness({ access: async () => ({ id, kind: 'guest', account: `guest:${id}`, admin: false, db: {} }) });
  assert.equal((await guest.post(upload())).status, 201);
  assert.equal(guest.state.calls.reserve + guest.state.calls.check, 0);
  const h = harness();
  const completion = new Request(`https://skycar.test/x?kind=completion`, { method: 'POST', body: (() => { const f = new FormData(); f.append('photos', photo()); return f; })(), headers: { origin: 'https://skycar.test' } });
  assert.equal((await h.post(completion)).status, 201);
  assert.equal(h.state.calls.reserve, 0);
  assert.equal(h.saved.at(-1).completion, true);
});

test('wrong content type and failed CSRF are rejected before any quota is reserved', async () => {
  const h = harness();
  const json = new Request(`https://skycar.test/x`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://skycar.test' } });
  assert.equal((await h.post(json)).status, 400);
  assert.equal((await h.post(upload(1, { origin: 'https://evil.test' }))).status, 403);
  assert.equal(h.state.calls.reserve, 0);
  assert.equal(h.state.used(), 0);
});

test('invalid and rejected bodies never burn quota, even far past the limit', async () => {
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
  assert.equal(h.saved.length, 0);
  // Oversized body (PAYLOAD_TOO_LARGE) also releases.
  const huge = new Request(urlFor(id), { method: 'POST', body: new Blob([new Uint8Array(2_900_000)]), headers: { origin: 'https://skycar.test', 'content-type': 'multipart/form-data; boundary=x' } });
  assert.equal((await h.post(huge)).status, 413);
  assert.equal(h.state.used(), 0);
  // A good upload still works afterwards.
  assert.equal((await h.post(upload())).status, 201);
  assert.equal(h.state.used(), 1);
});

test('a 503 (storage or marker failure) releases the slot and the identical retry is charged exactly once', async () => {
  const h = harness({ failures: ['storage', 'marker'] });
  const first = await h.post(upload(2));
  assert.equal(first.status, 503);
  assert.equal(h.state.used(), 0, 'storage failure released');
  const second = await h.post(upload(2));
  assert.equal(second.status, 503);
  assert.equal(h.state.used(), 0, 'marker failure released even though objects were written');
  const third = await h.post(upload(2));
  assert.equal(third.status, 201);
  assert.equal(h.state.used(), 1, 'the set that finally succeeded counts once');
  assert.equal(h.state.calls.reserve, 3); assert.equal(h.state.calls.release, 2);
  assert.equal(h.state.markers.size, 1);
});

test('503-then-retry for ten different requests never reaches the limit', async () => {
  const failures = Array.from({ length: 10 }, () => 'storage');
  const h = harness({ failures: failures.flatMap(failure => [failure, undefined]) });
  for (let n = 1; n <= 10; n++) {
    assert.equal((await h.post(upload(1, {}, urlFor(uuid(n))), uuid(n))).status, 503);
    assert.equal((await h.post(upload(1, {}, urlFor(uuid(n))), uuid(n))).status, 201);
  }
  assert.equal(h.state.used(), 10);
  assert.equal((await h.post(upload(1, {}, urlFor(uuid(11))), uuid(11))).status, 429);
});

test('replay of an already recorded set is free, even when the account is at its limit', async () => {
  const h = harness();
  for (let n = 1; n <= 10; n++) assert.equal((await h.post(upload(1, {}, urlFor(uuid(n))), uuid(n))).status, 201);
  assert.equal(h.state.used(), 10);
  const reservesBefore = h.state.calls.reserve;
  for (let i = 0; i < 5; i++) assert.equal((await h.post(upload(1, {}, urlFor(uuid(1))), uuid(1))).status, 201, 'identical replay at the limit');
  assert.equal(h.state.used(), 10);
  assert.equal(h.state.calls.reserve, reservesBefore, 'replay never reserves');
  // A different set for a recorded request is also free (storage rejects it as IDEMPOTENCY_CONFLICT there).
  assert.equal((await h.post(upload(2, {}, urlFor(uuid(1))), uuid(1))).status, 201);
  assert.equal(h.state.used(), 10);
  // A brand new request is still limited.
  const limited = await h.post(upload(1, {}, urlFor(uuid(11))), uuid(11));
  assert.equal(limited.status, 429);
  assert.equal(h.saved.length, 10 + 5 + 1);
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
  for (let n = 1; n <= 10; n++) assert.equal((await h.post(upload(1, {}, urlFor(uuid(n))), uuid(n))).status, 201, `upload ${n}`);
  const limited = await h.post(upload(1, {}, urlFor(uuid(11))), uuid(11));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1234');
  assert.equal(limited.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await limited.json(), { error: { code: 'RATE_LIMITED', message: 'Too many photo uploads. Wait a little, then retry the same photos.', retryable: true } });
  assert.equal(h.saved.length, 10);
  assert.equal(h.state.calls.release, 0, 'a denied reservation holds nothing to release');
  const other = harness({ state: h.state, access: async (_r, requestId) => accountAccess('22222222-2222-4222-8222-222222222222', requestId) });
  assert.equal((await other.post(upload(1, {}, urlFor(uuid(30))), uuid(30))).status, 201);
});

test('failure releases the slot; a failed release never masks the original error', async () => {
  const h = harness({ failures: ['storage'] });
  assert.equal((await h.post(upload())).status, 503);
  assert.equal(h.state.calls.release, 1);
  assert.equal(h.state.used(), 0);
  const brokenRelease = world();
  const original = brokenRelease.db.rpc.bind(brokenRelease.db);
  brokenRelease.db.rpc = async (name, args) => { if (name === 'care_release_photo_upload_slot') throw new Error(`down ${SECRET}`); return original(name, args); };
  const g = harness({ state: brokenRelease, failures: ['storage'] });
  const response = await g.post(upload());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(SECRET), false);
  assert.equal(brokenRelease.used(), 1, 'a failed release is conservative: the slot stays held until the window ends');
});

test('rate limiting fails closed: an unreadable counter stores nothing and leaks no detail', async () => {
  const h = harness({ state: world({ failReserve: true }) });
  const response = await h.post(upload());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(SECRET), false);
  assert.equal(h.saved.length, 0);
});

test('Retry-After is bounded by the window even if the database reports a larger value', async () => {
  const db = { async rpc() { return { data: { allowed: false, retry_after_seconds: 999999 }, error: null }; } };
  await assert.rejects(reservePhotoSlot(db, accountAccess()), error => error.code === 'RATE_LIMITED' && error.retryAfter === 3600);
  await assert.rejects(reservePhotoSlot({ async rpc() { return { data: { allowed: false, retry_after_seconds: 0 }, error: null }; } }, accountAccess(), { windowSeconds: 600 }), error => error.retryAfter === 600);
});

test('30 concurrent uploads of new sets from one account keep the limit exact; each loser stores nothing', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({ length: 30 }, (_, n) => h.post(upload(1, {}, urlFor(uuid(n + 1))), uuid(n + 1))));
  const statuses = responses.map(response => response.status);
  assert.equal(statuses.filter(status => status === 201).length, 10);
  assert.equal(statuses.filter(status => status === 429).length, 20);
  assert.equal(h.saved.length, 10);
  assert.equal(h.state.used(), 10);
  assert.equal(h.state.markers.size, 10);
});

test('concurrent valid and invalid uploads settle with the count equal to the stored sets', async () => {
  const h = harness();
  const invalid = () => new Request(urlFor(id), { method: 'POST', body: new FormData(), headers: { origin: 'https://skycar.test' } });
  const calls = Array.from({ length: 30 }, (_, n) => n % 2 ? h.post(invalid(), uuid(n + 1)) : h.post(upload(1, {}, urlFor(uuid(n + 1))), uuid(n + 1)));
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
  await recordRequestPhotos(ok, id, { count: 2, manifestSha256: 'a'.repeat(64) });
  assert.deepEqual(calls, [['care_record_request_photos', { p_request_id: id, p_count: 2, p_manifest_sha256: 'a'.repeat(64) }]]);
  await assert.rejects(recordRequestPhotos({ async rpc() { return { data: null, error: { code: 'P0001', message: 'IDEMPOTENCY_CONFLICT' } }; } }, id, { count: 1, manifestSha256: 'a'.repeat(64) }), error => error.code === 'IDEMPOTENCY_CONFLICT');
  await assert.rejects(recordRequestPhotos({ async rpc() { return { data: null, error: { code: '57014', message: SECRET } }; } }, id, { count: 1, manifestSha256: 'a'.repeat(64) }), error => error.code === 'UNAVAILABLE' && !error.message.includes(SECRET));
});

test('the recorded-set check treats errors as not recorded (so quota is still reserved)', async () => {
  const failing = { from() { throw new Error(SECRET); } };
  assert.equal(await hasRecordedPhotos(failing, id), false);
  const errored = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { request_id: id }, error: { message: 'x' } }) }) }) }) };
  assert.equal(await hasRecordedPhotos(errored, id), false);
});

// ---- Signed URL route -------------------------------------------------------
const manifest = [{ slot: 1, mime_type: 'image/jpeg', size_bytes: 300, sha256: 'a'.repeat(64) }, { slot: 2, mime_type: 'image/png', size_bytes: 500, sha256: 'b'.repeat(64) }];
function urlHarness({ access = async () => accountAccess(), storageError = null, now = () => Date.parse('2026-11-01T00:00:00.000Z'), manifestList = manifest, completionVisible = async () => {} } = {}) {
  const events = []; const signs = [];
  const deps = {
    access: async (...args) => { events.push('access'); return access(...args); },
    completionVisible: async value => { events.push('visible'); return completionVisible(value); },
    sign: async (value, slot, completion) => {
      events.push('sign');
      const storage = { async createSignedUrl(path, ttl) { signs.push([path, ttl]); return storageError ? { data: null, error: { message: `${storageError} ${SECRET}` } } : { data: { signedUrl: `https://project.supabase.test/storage/v1/object/sign/private-media/${path}?token=tok.en.sig` }, error: null }; } };
      return signedPhotoUrl({ storage, prefix: `${completion ? 'care-completion' : value.kind === 'guest' ? 'guest-requests' : 'care-requests'}/${value.id}`, manifest: manifestList, slot, now });
    },
  };
  const get = (slot, query = '') => journeyBoundary(async () => { const r = await handlePhotoUrl(new Request(`https://skycar.test/api/v1/care/journey/${id}/photos/${slot}/url${query}`), id, slot, deps); return journeyJson(r.data, r.status, r.account); });
  return { get, events, signs };
}

test('signed URL: owner receives a 120 s URL with the exact response shape and private headers', async () => {
  const h = urlHarness();
  const response = await h.get('2');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-skycar-account'), owner);
  const body = await response.json();
  assert.deepEqual(body, { data: { slot: 2, url: `https://project.supabase.test/storage/v1/object/sign/private-media/care-requests/${id}/photo-2?token=tok.en.sig`, mime_type: 'image/png', size_bytes: 500, expires_in: 120, expires_at: '2026-11-01T00:02:00.000Z' } });
  assert.deepEqual(h.signs, [[`care-requests/${id}/photo-2`, 120]]);
  assert.deepEqual(h.events, ['access', 'sign']);
  assert.equal(JSON.stringify(body).includes(SECRET), false);
});

test('signed URL TTL is fixed server-side inside 60-300 s and cannot be requested by the client', async () => {
  assert.equal(SIGNED_URL_TTL_SECONDS, 120);
  assert.ok(SIGNED_URL_TTL_SECONDS >= MIN_SIGNED_URL_TTL_SECONDS && SIGNED_URL_TTL_SECONDS <= MAX_SIGNED_URL_TTL_SECONDS);
  assert.deepEqual([clampSignedUrlTtl(1), clampSignedUrlTtl(10_000), clampSignedUrlTtl(undefined), clampSignedUrlTtl(Number.NaN), clampSignedUrlTtl(180)], [60, 300, 120, 120, 180]);
  const h = urlHarness();
  await h.get('1', '?ttl=86400&expires_in=86400');
  assert.equal(h.signs[0][1], 120);
});

test('signed URL: ownership denial signs nothing, and bad slots are 404 before any lookup', async () => {
  for (const [code, status] of [['NOT_FOUND', 404], ['UNAUTHENTICATED', 401]]) {
    const h = urlHarness({ access: async () => { throw new JourneyError(code); } });
    assert.equal((await h.get('1')).status, status);
    assert.deepEqual(h.events, ['access']);
    assert.equal(h.signs.length, 0);
  }
  const h = urlHarness();
  for (const slot of ['0', '4', 'x', '1/../2', '']) assert.equal((await h.get(slot)).status, 404, slot);
  assert.deepEqual(h.events, []);
  const missing = urlHarness();
  assert.equal((await missing.get('3')).status, 404, 'slot not in manifest');
  assert.equal(missing.signs.length, 0);
});

test('signed URL covers the guest-cookie path under guest-requests and completion under care-completion', async () => {
  const guest = urlHarness({ access: async () => ({ id, kind: 'guest', account: `guest:${id}`, admin: false, db: {} }) });
  const response = await guest.get('1');
  assert.equal(response.status, 200);
  assert.deepEqual(guest.signs, [[`guest-requests/${id}/photo-1`, 120]]);
  assert.equal(response.headers.get('x-skycar-account'), `guest:${id}`);
  const completion = urlHarness();
  assert.equal((await completion.get('1', '?kind=completion')).status, 200);
  assert.deepEqual(completion.signs, [[`care-completion/${id}/photo-1`, 120]]);
  assert.deepEqual(completion.events, ['access', 'visible', 'sign']);
  const hidden = urlHarness({ completionVisible: async () => { throw new JourneyError('NOT_FOUND'); } });
  assert.equal((await hidden.get('1', '?kind=completion')).status, 404);
  assert.equal(hidden.signs.length, 0);
});

test('signed URL storage failure is a generic retryable 503 with no key or provider text', async () => {
  const h = urlHarness({ storageError: 'storage exploded' });
  const response = await h.get('1');
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes(SECRET) || text.includes('exploded'), false);
  assert.equal(JSON.parse(text).error.retryable, true);
});

test('route sources never reference service keys and the signed URL response is not cached', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['src/server/care/journey/photo-service.mjs', 'src/app/api/v1/care/journey/[id]/photos/[slot]/url/route.ts', 'src/app/api/v1/care/journey/[id]/photos/route.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/secretKey|SECRET|service_role|console\./i.test(source), false, file);
  }
});

test('PhotoError carries only a code and retry hint', () => {
  const error = new PhotoError('RATE_LIMITED', 5);
  assert.deepEqual([error.name, error.code, error.retryAfter, error.message], ['PhotoError', 'RATE_LIMITED', 5, 'RATE_LIMITED']);
});
