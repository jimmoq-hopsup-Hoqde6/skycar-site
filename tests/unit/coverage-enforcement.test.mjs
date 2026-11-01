import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import data from '../../src/server/care/coverage-areas.json' with { type: 'json' };
import { buildCoverageIndex, createCoverageResolver } from '../../src/server/care/coverage-resolver.ts';
import { coverageSeedSql } from '../../scripts/coverage-data/build-coverage-migration.mjs';
import { GuestError } from '../../src/domain/care/guest.mjs';
import { guestHandler } from '../../src/server/care/guest-http.mjs';
import { saveGuestIntake } from '../../src/server/care/guest-intake.mjs';
import { manifestDigest, readGuestPhotos } from '../../src/server/care/guest-photos.mjs';
import { careHandlers } from '../../src/server/care/http.ts';
import { CareError } from '../../src/domain/care/request.ts';

const dir = 'supabase/migrations';
const migrations = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
const coverageMigrations = migrations.filter(name => name.includes('care_service_coverage'));
const latest = coverageMigrations.at(-1);
const read = name => readFileSync(`${dir}/${name}`, 'utf8');

// ---- one list: the database mirror is generated from the JSON the resolver reads ----------------

test('the coverage migration sorts after the photo-marker migration and is the newest coverage seed', () => {
  assert.ok(latest, 'a care_service_coverage migration exists');
  assert.ok(latest > '20261101150000', latest);
  assert.equal(migrations.at(-1) >= latest, true);
});

test('the latest seed block in the migrations equals the one generated from coverage-areas.json', () => {
  const sql = read(latest);
  const begin = sql.indexOf('-- BEGIN GENERATED COVERAGE SEED');
  const end = sql.indexOf('-- END GENERATED COVERAGE SEED') + '-- END GENERATED COVERAGE SEED'.length;
  assert.ok(begin > 0 && end > begin);
  assert.equal(sql.slice(begin, end), coverageSeedSql(data), 'regenerate with scripts/coverage-data/build-coverage-migration.mjs in a NEW migration');
});

test('the seeded postcodes per service are exactly the resolver index (147 postcodes, both services)', async () => {
  const sql = read(latest);
  const seeded = new Map();
  for (const match of sql.matchAll(/select '([a-z]+)', code from unnest\(array\[([^\]]*)\]\)/g)) {
    seeded.set(match[1], new Set(match[2].match(/\d{4}/g)));
  }
  const index = buildCoverageIndex(data);
  assert.deepEqual([...seeded.keys()].sort(), [...index.keys()].sort());
  for (const [service, postcodes] of index) {
    assert.equal(postcodes.size, 147);
    assert.deepEqual([...seeded.get(service)].sort(), [...postcodes].sort(), service);
  }
  const resolve = createCoverageResolver(data);
  for (const code of ['5000', '5251', '5290', '3000']) {
    for (const service of ['repair', 'cleaning']) assert.equal(seeded.get(service).has(code) ? 'available' : 'unavailable', await resolve({ service, postcode: code }));
  }
  assert.match(sql, new RegExp(`'${data.areaId}', '${data.version}'`));
});

test('the generator refuses data the resolver would refuse (no migration from a tampered file)', () => {
  const broken = structuredClone(data);
  broken.candidates.find(item => item.postcode === '5000').included = false;
  assert.throws(() => coverageSeedSql(broken), /COVERAGE_UNAVAILABLE/);
  assert.throws(() => coverageSeedSql({ ...data, candidates: [] }), /COVERAGE_UNAVAILABLE/);
});

test('the migration is forward-only, definer-with-empty-search_path, lock-ordered and does not touch Storage', () => {
  const sql = read(latest);
  assert.match(sql, /create function public\.care_assert_postcode_covered[\s\S]*?security definer set search_path = ''/);
  assert.match(sql, /create or replace function public\.care_submit_request[\s\S]*?security definer set search_path = ''/);
  assert.match(sql, /create or replace function public\.care_submit_guest_request[\s\S]*?set search_path = ''/);
  assert.equal(/search_path\s*=\s*public/i.test(sql), false);
  assert.equal(/drop\s+(function|table)|alter\s+table\s+public\.(care_requests|care_guest_requests|care_request_commands)/i.test(sql), false);
  assert.match(sql, /revoke all on function public\.care_assert_postcode_covered\(text, text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke all on public\.care_service_coverage, public\.care_service_coverage_meta from public, anon, authenticated, service_role;/);
  assert.equal(/storage\./i.test(sql.replace(/--.*$/gm, '')), false);
  // The authenticated function decides coverage after the replay lookup and BEFORE the vehicle lock.
  const body = sql.slice(sql.indexOf('create or replace function public.care_submit_request'), sql.indexOf('create or replace function public.care_submit_guest_request'));
  const order = ['perform pg_advisory_xact_lock', 'from public.care_request_commands', 'perform public.care_assert_postcode_covered', 'from public.vehicles where id', 'from public.care_response_policy', 'insert into public.care_requests'].map(token => body.indexOf(token));
  assert.equal(order.every(position => position > 0), true);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'advisory, replay, coverage, vehicle, policy, insert');
  // The guest function decides coverage after the replay lookup and before the rate limits and the insert.
  const guest = sql.slice(sql.indexOf('create or replace function public.care_submit_guest_request'));
  const guestOrder = ['pg_advisory_xact_lock', 'where idempotency_key', 'care_assert_postcode_covered', "interval '1 hour'", 'insert into public.care_guest_requests'].map(token => guest.indexOf(token));
  assert.deepEqual([...guestOrder].sort((a, b) => a - b), guestOrder);
  assert.equal(guestOrder.every(position => position > 0), true);
});

test('frozen migrations that define the two functions are untouched', () => {
  const text = read('202609200002_care_requests.sql');
  assert.equal(text.includes('postcode'), false, 'the original submit function has no postcode: the change is a new forward-only migration');
  assert.equal(read('20261001030000_care_guest_requests.sql').includes('care_assert_postcode_covered'), false);
});

// ---- guest intake: reject before any Storage or photo I/O ---------------------------------------

const key = 'd35e8b9f-75a0-4d0d-8393-26527c451616';
const details = { name: 'Test Owner', email: 'owner@example.com', phone: '0400 000 000', suburb: 'Adelaide', postcode: '5000', vehicle: 'Toyota Corolla 2020', service: 'repair', description: 'Synthetic scratch test only.', preferred_window: 'flexible', consent: true };
const jpeg = () => { const bytes = new Uint8Array(200); bytes.set([255, 216, 255]); return bytes; };
const receipt = { id: '2b9a6a9e-4d1c-4b6e-9d73-0f1d5f0a7c11', stage: 'request_received', created_at: '2026-11-01T03:00:00Z' };

// Fake service-role client whose RPC decides coverage with the REAL resolver, and which records
// every Storage touch, marker query and marker write so tests can assert none happened before a
// rejection and that an accepted request records its photo marker.
function guestWorld() {
  const resolve = createCoverageResolver(data);
  const log = { rpc: [], storageFrom: 0, uploads: 0, markerReads: 0, markers: [], paths: [] };
  const client = {
    async rpc(name, args) {
      log.rpc.push([name, args]);
      if (name === 'care_record_request_photos') { log.markers.push([log.uploads, args]); return { data: { request_id: args.p_request_id, photo_count: args.p_count, replayed: false }, error: null }; }
      const code = args.p_payload.postcode;
      const decided = await resolve({ service: args.p_payload.service, postcode: code });
      if (decided === 'unavailable') return { data: null, error: { code: 'P0001', message: 'OUT_OF_AREA' }, status: 400 };
      return { data: receipt, error: null, status: 200 };
    },
    from() { log.markerReads += 1; const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) }; return query; },
    storage: { from() { log.storageFrom += 1; return { upload: async path => { log.uploads += 1; log.paths.push(path); return { error: null }; }, download: async () => ({ error: { message: 'missing' } }) }; } },
  };
  return { client, log };
}
const multipart = (body, withPhoto = true) => {
  const form = new FormData(); form.set('details', JSON.stringify(body));
  if (withPhoto) form.append('photos', new File([jpeg()], 'p.jpg', { type: 'image/jpeg' }));
  return new Request('http://localhost:3000/api/v1/care/guest-requests', { method: 'POST', headers: { origin: 'http://localhost:3000', 'idempotency-key': key }, body: form });
};
const handlerFor = world => guestHandler({ enabled: () => true, save: (k, payload, _request, photos) => saveGuestIntake({ client: world.client, key: k, payload, fingerprint: 'f'.repeat(64), photos }) });

test('guest bypass: an out-of-area postcode with photos is rejected 422 OUT_OF_AREA with no Storage or photo I/O', async () => {
  for (const postcode of ['5290', '3000', '0800', '5254', '5999']) {
    const world = guestWorld();
    const response = await handlerFor(world)(multipart({ ...details, postcode }));
    assert.equal(response.status, 422, postcode);
    const body = await response.json();
    assert.equal(body.error.code, 'OUT_OF_AREA');
    assert.equal(body.error.retryable, false);
    assert.equal(body.data, undefined);
    assert.equal(JSON.stringify(body).includes(postcode), false, 'the error does not echo input');
    assert.deepEqual([world.log.storageFrom, world.log.uploads, world.log.markerReads, world.log.markers.length], [0, 0, 0, 0], 'no Storage, marker read or marker write');
    assert.equal(world.log.rpc.length, 1);
  }
});

test('guest in-area postcode with photos: receipt first, then Storage, then the guest photo marker is recorded', async () => {
  const world = guestWorld();
  const response = await handlerFor(world)(multipart({ ...details, postcode: '5251' }));
  assert.equal(response.status, 201);
  assert.equal(world.log.rpc[0][0], 'care_submit_guest_request', 'the database decision is the first call');
  assert.deepEqual(world.log.paths.sort(), [`guest-requests/${receipt.id}/manifest.json`, `guest-requests/${receipt.id}/photo-1`].sort(), 'stored under the new request id');
  assert.equal(world.log.markers.length, 1, 'the marker is recorded once');
  const [uploadsBefore, args] = world.log.markers[0];
  assert.equal(uploadsBefore, 2, 'the marker is written after the manifest and the photo are stored');
  const expected = manifestDigest(await readGuestPhotos([new File([jpeg()], 'p.jpg', { type: 'image/jpeg' })]));
  assert.deepEqual(args, { p_request_id: receipt.id, p_count: 1, p_manifest_sha256: expected.manifestSha256, p_kind: 'guest' });
});

test('guest in-area postcode without photos records no marker and touches no Storage', async () => {
  const world = guestWorld();
  const response = await handlerFor(world)(multipart({ ...details, postcode: '5251' }, false));
  assert.equal(response.status, 201);
  assert.deepEqual([world.log.uploads, world.log.markers.length, world.log.markerReads], [0, 0, 0]);
});

test('guest service-area check failing closed is a non-retryable 503 with nothing stored', async () => {
  const world = guestWorld();
  world.client.rpc = async () => ({ data: null, error: { code: 'P0001', message: 'COVERAGE_UNAVAILABLE' }, status: 400 });
  const response = await handlerFor(world)(multipart(details));
  assert.deepEqual([world.log.uploads, world.log.markers.length, world.log.markerReads], [0, 0, 0]);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'COVERAGE_UNAVAILABLE');
  assert.equal(body.error.retryable, false);
  assert.equal(world.log.storageFrom, 0);
});

test('guest rejections other than the known database codes stay generic and store nothing', async () => {
  for (const error of [{ code: 'P0001', message: 'secret internal detail' }, { code: '42501', message: 'OUT_OF_AREA' }, { code: 'XX000', message: 'COVERAGE_UNAVAILABLE' }]) {
    const world = guestWorld();
    world.client.rpc = async () => ({ data: null, error, status: 400 });
    await assert.rejects(saveGuestIntake({ client: world.client, key, payload: details, fingerprint: 'f'.repeat(64), photos: [] }), caught => caught instanceof GuestError && caught.code === 'UNAVAILABLE');
    assert.equal(world.log.storageFrom, 0);
  }
});

// ---- authenticated API: error mapping ----------------------------------------------------------

const id = '11111111-1111-4111-8111-111111111111';
const careBody = { vehicle_id: id, service: 'repair', description: 'Scratch on rear bumper', preferred_window: 'flexible', postcode: '5000' };
const careRequest = body => new Request('https://skycar.test/api/v1/care/requests', { method: 'POST', headers: { origin: 'https://skycar.test', 'content-type': 'application/json', 'idempotency-key': id }, body: JSON.stringify(body) });

test('authenticated API: the postcode is forwarded to the database, OUT_OF_AREA is 422 and nothing about it is stored by the route', async () => {
  const seen = [];
  const handlers = careHandlers({ enabled: () => true, connect: async () => ({ submit: async (k, input) => { seen.push(input); throw new CareError('OUT_OF_AREA'); } }) });
  const response = await handlers.submit(careRequest({ ...careBody, postcode: '5290' }));
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, 'OUT_OF_AREA');
  assert.equal(body.error.retryable, false);
  assert.equal(seen[0].postcode, '5290');
  // A scripted client cannot omit the postcode to skip the check: the route rejects it before the database.
  const { postcode, ...withoutPostcode } = careBody; void postcode;
  const missing = await handlers.submit(careRequest(withoutPostcode));
  assert.equal(missing.status, 400);
  assert.equal(seen.length, 1);
});

test('the signed-in form sends the checked postcode with the request', () => {
  const source = readFileSync('src/features/care/request-form.tsx', 'utf8');
  assert.match(source, /preferred_window: preferredWindow, postcode: code \}/);
  assert.match(source, /"POLICY_UNAVAILABLE", "COVERAGE_UNAVAILABLE"/);
});
