import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { journeyBoundary, journeyJson, boundedBody, JourneyError } from '../../src/server/care/journey/http.ts';
import {
  PHOTO_UPLOAD_LIMIT, PHOTO_UPLOAD_WINDOW_SECONDS, SIGNED_URL_TTL_SECONDS, MIN_SIGNED_URL_TTL_SECONDS, MAX_SIGNED_URL_TTL_SECONDS,
  PhotoError, clampSignedUrlTtl, consumePhotoQuota, handlePhotoUpload, handlePhotoUrl, recordRequestPhotos, signedPhotoUrl,
} from '../../src/server/care/journey/photo-service.mjs';
import { readGuestPhotos, storeCarePhotos } from '../../src/server/care/guest-photos.mjs';
import { isTrustedWriteOrigin } from '../../src/server/http/request-origin.mjs';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const owner = '11111111-1111-4111-8111-111111111111';
const SECRET = 'sb_secret_UNIT_TEST_SERVICE_KEY';
const jpeg = size => { const bytes = new Uint8Array(size).fill(7); bytes.set([0xff, 0xd8, 0xff]); return bytes; };
const upload = (count = 1, headers = {}) => {
  const form = new FormData();
  for (let i = 0; i < count; i++) form.append('photos', new File([jpeg(300 + i)], `p${i}.jpg`, { type: 'image/jpeg' }));
  return new Request(`https://skycar.test/api/v1/care/journey/${id}/photos`, { method: 'POST', body: form, headers: { origin: 'https://skycar.test', ...headers } });
};
const accountAccess = (actor = owner) => ({ id, kind: 'account', account: actor, admin: false, db: {} });
// A fake of the RPC: one atomic read-modify-write per call, like the SQL upsert.
function quotaDb({ limit = PHOTO_UPLOAD_LIMIT, fail = false } = {}) {
  const counts = new Map(); const calls = [];
  return { counts, calls, async rpc(name, args) {
    calls.push([name, args]);
    await Promise.resolve();
    if (fail) return { data: null, error: { code: 'XX000', message: `boom ${SECRET}` } };
    const used = counts.get(args.p_subject) ?? 0;
    if (used >= args.p_limit) return { data: { allowed: false, limit: args.p_limit, used, remaining: 0, window_seconds: args.p_window_seconds, retry_after_seconds: 1234 }, error: null };
    counts.set(args.p_subject, used + 1);
    return { data: { allowed: true, limit: args.p_limit, used: used + 1, remaining: args.p_limit - used - 1, window_seconds: args.p_window_seconds, retry_after_seconds: 0 }, error: null };
  } };
}
function harness({ access = async () => accountAccess(), db = quotaDb() } = {}) {
  const saved = []; const events = [];
  const deps = {
    access: async (...args) => { events.push('access'); return access(...args); },
    isTrustedWrite: request => { events.push('csrf'); return isTrustedWriteOrigin(request); },
    consumeQuota: async value => { events.push('quota'); return consumePhotoQuota(db, value); },
    readBody: async (...args) => { events.push('body'); return boundedBody(...args); },
    readPhotos: readGuestPhotos,
    save: async (value, photos, completion) => { events.push('save'); saved.push({ value, photos, completion }); },
  };
  const post = request => journeyBoundary(async () => { const r = await handlePhotoUpload(request, id, deps); return journeyJson(r.data, r.status, r.account); });
  return { post, saved, events, db };
}

test('upload checks ownership first, then CSRF, quota, body, validation and storage in that order', async () => {
  const h = harness();
  const response = await h.post(upload(2));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { stored: 2 } });
  assert.equal(response.headers.get('x-skycar-account'), owner);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(h.events, ['access', 'csrf', 'quota', 'body', 'save']);
  assert.equal(h.saved[0].photos.length, 2);
  assert.deepEqual(h.db.calls[0], ['care_consume_photo_upload_quota', { p_subject: `journey-photos:${owner}`, p_limit: 10, p_window_seconds: 3600 }]);
  assert.equal(PHOTO_UPLOAD_LIMIT, 10); assert.equal(PHOTO_UPLOAD_WINDOW_SECONDS, 3600);
});

test('ownership denial (other account, unauthenticated, guest without cookie) never consumes quota, reads the body or stores', async () => {
  for (const [code, status] of [['NOT_FOUND', 404], ['UNAUTHENTICATED', 401], ['UNAVAILABLE', 503]]) {
    const h = harness({ access: async () => { throw new JourneyError(code); } });
    const response = await h.post(upload());
    assert.equal(response.status, status);
    assert.deepEqual(h.events, ['access']);
    assert.equal(h.db.calls.length, 0);
    assert.equal(h.saved.length, 0);
  }
});

test('guest cookie access is limited per guest request, not shared with accounts', async () => {
  const h = harness({ access: async () => ({ id, kind: 'guest', account: `guest:${id}`, admin: false, db: {} }) });
  assert.equal((await h.post(upload())).status, 201);
  assert.equal(h.db.calls[0][1].p_subject, `journey-photos:guest:${id}`);
  assert.ok(h.db.calls[0][1].p_subject.length <= 80);
});

test('wrong content type and failed CSRF are rejected before the quota is touched; completion evidence is not a customer upload', async () => {
  const h = harness();
  const json = new Request(`https://skycar.test/x`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://skycar.test' } });
  assert.equal((await h.post(json)).status, 400);
  const crossSite = await h.post(upload(1, { origin: 'https://evil.test' }));
  assert.equal(crossSite.status, 403);
  assert.equal(h.db.calls.length, 0);
  const completion = new Request(`https://skycar.test/x?kind=completion`, { method: 'POST', body: (() => { const f = new FormData(); f.append('photos', new File([jpeg(300)], 'p.jpg', { type: 'image/jpeg' })); return f; })(), headers: { origin: 'https://skycar.test' } });
  assert.equal((await h.post(completion)).status, 201);
  assert.equal(h.db.calls.length, 0);
  assert.equal(h.saved.at(-1).completion, true);
});

test('rate limit boundary: the 10th upload succeeds, the 11th is 429 with Retry-After and nothing is stored', async () => {
  const h = harness();
  for (let i = 1; i <= 10; i++) assert.equal((await h.post(upload())).status, 201, `upload ${i}`);
  const limited = await h.post(upload());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1234');
  assert.equal(limited.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await limited.json(), { error: { code: 'RATE_LIMITED', message: 'Too many photo uploads. Wait a little, then retry the same photos.', retryable: true } });
  assert.equal(h.saved.length, 10);
  // Another account is unaffected.
  const other = harness({ db: h.db, access: async () => accountAccess('22222222-2222-4222-8222-222222222222') });
  assert.equal((await other.post(upload())).status, 201);
});

test('rate limiting fails closed: an unreadable counter stores nothing and leaks no detail', async () => {
  const h = harness({ db: quotaDb({ fail: true }) });
  const response = await h.post(upload());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes(SECRET), false);
  assert.equal(h.saved.length, 0);
});

test('Retry-After is bounded by the window even if the database reports a larger value', async () => {
  const db = { async rpc(_name, args) { return { data: { allowed: false, retry_after_seconds: 999999 }, error: null }; } };
  await assert.rejects(consumePhotoQuota(db, accountAccess()), error => error.code === 'RATE_LIMITED' && error.retryAfter === 3600);
  await assert.rejects(consumePhotoQuota({ async rpc() { return { data: { allowed: false, retry_after_seconds: 0 }, error: null }; } }, accountAccess(), { windowSeconds: 600 }), error => error.retryAfter === 600);
});

test('concurrent uploads from one account never exceed the limit and each denied call stores nothing', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({ length: 30 }, () => h.post(upload())));
  const statuses = responses.map(response => response.status);
  assert.equal(statuses.filter(status => status === 201).length, 10);
  assert.equal(statuses.filter(status => status === 429).length, 20);
  assert.equal(h.saved.length, 10);
  assert.equal(h.db.counts.get(`journey-photos:${owner}`), 10);
});

test('storeCarePhotos returns the SHA-256 of the manifest it wrote and is null for no photos', async () => {
  const objects = new Map();
  const bucket = { async upload(path, bytes) { if (objects.has(path)) return { error: { message: 'exists' } }; objects.set(path, Buffer.from(bytes)); return { error: null }; }, async download(path) { return objects.has(path) ? { data: new Blob([objects.get(path)]), error: null } : { error: { message: 'missing' } }; } };
  const photos = await readGuestPhotos([new File([jpeg(300)], 'a.jpg', { type: 'image/jpeg' }), new File([jpeg(400)], 'b.jpg', { type: 'image/jpeg' })]);
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
