// Runs PostgreSQL (PGlite or a disposable server) with auth/storage stubs, NOT live Supabase.
// Usage: GARAGE_PGLITE_MODULE=/tmp/garage-validation/node_modules/@electric-sql/pglite/dist/index.js node tests/rls/garage.postgres.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
let db;
let engine = 'PGlite';
if (process.env.GARAGE_PG_MODULE) {
  const url = new URL(process.env.GARAGE_TEST_DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/garage_test') throw new Error('Only a disposable local garage_test database is allowed.');
  const pg = await import(pathToFileURL(process.env.GARAGE_PG_MODULE).href);
  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  db = { exec: sql => client.query(sql), query: (sql, args) => client.query(sql, args), close: () => client.end() };
  engine = 'PostgreSQL server';
} else {
  if (!process.env.GARAGE_PGLITE_MODULE) throw new Error('Set GARAGE_PGLITE_MODULE or GARAGE_PG_MODULE.');
  const { PGlite } = await import(pathToFileURL(process.env.GARAGE_PGLITE_MODULE).href);
  db = new PGlite();
}
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    grant usage on schema public, auth, storage to authenticated, service_role;
    grant select, insert, delete on storage.objects to authenticated;
    grant select, insert, delete on storage.objects to service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    alter default privileges in schema public grant all on tables to authenticated, anon, service_role;
  `);
  for (const filename of ['202609200001_foundation.sql', '202609200100_garage_mutations.sql', '202609200300_garage_vehicle_photos.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
  }
  const a = randomUUID(), b = randomUUID();
  await db.query('insert into auth.users(id) values ($1),($2)', [a, b]);
  const login = async user => { await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]); await db.exec('set role authenticated'); };
  const mutate = async (command, id, payload, key = randomUUID()) => (await db.query('select public.garage_mutate_vehicle($1,$2,$3::jsonb,$4,$5) as result', [command, id, JSON.stringify(payload), key, randomUUID()])).rows[0].result;
  const rejects = async (call, code) => { await assert.rejects(call, error => error.message.includes(code)); checks++; };
  const service = async (sql, args = []) => {
    await db.exec('reset role; set role service_role');
    try { return await db.query(sql, args); }
    finally { await db.exec('reset role'); }
  };
  const reservePhoto = async (actor, vehicle, asset, path, hash, uploadKey, size = 1024) =>
    (await service('select public.garage_reserve_vehicle_photo($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [actor, vehicle, asset, path, 'image/jpeg', size, hash, uploadKey])).rows[0].result;
  const finalizePhoto = async (actor, uploadKey) =>
    (await service('select public.garage_finalize_vehicle_photo($1,$2,$3) as result',
      [actor, uploadKey, randomUUID()])).rows[0].result;
  const input = { make: 'Toyota', model: 'Corolla', variant: null, year: 2020, registration: 'ABC123', registration_state: 'SA' };
  await login(a);
  const key = randomUUID();
  const first = await mutate('create', null, input, key);
  check(first.revision === 1 && !('owner_id' in first), 'create returns public snapshot');
  const replay = await mutate('create', null, input, key);
  check(replay.id === first.id, 'replay reuses committed vehicle');
  check((await db.query('select count(*)::int as n from public.vehicles')).rows[0].n === 1, 'one vehicle after replay');
  const photoKey = randomUUID(), assetId = randomUUID();
  const photoPath = `${a}/vehicles/${first.id}/${assetId}/original.jpg`;
  await rejects(() => db.query(
    'select public.garage_reserve_vehicle_photo($1,$2,$3,$4,$5,$6,$7,$8)',
    [a, first.id, assetId, photoPath, 'image/jpeg', 1024, 'a'.repeat(64), photoKey],
  ), 'permission denied');
  const reservation = await reservePhoto(a, first.id, assetId, photoPath, 'a'.repeat(64), photoKey);
  check(reservation.processing_state === 'uploading', 'trusted server reserves metadata before storage');
  await login(a);
  await rejects(() => db.query("insert into storage.objects(bucket_id,name) values ('private-media',$1)", [photoPath]), 'permission denied');
  await rejects(() => finalizePhoto(a, photoKey), 'PHOTO_NOT_UPLOADED');
  await service("insert into storage.objects(bucket_id,name) values ('private-media',$1)", [photoPath]);
  const photo = await finalizePhoto(a, photoKey);
  check(photo.id === assetId && photo.original_status === 'stored' && photo.display_status === 'unavailable', 'photo metadata records private original without claiming a display derivative');
  check(!('object_path' in photo) && !('content_sha256' in photo) && !('owner_id' in photo), 'photo response redacts storage and ownership internals');
  const photoReplay = await finalizePhoto(a, photoKey);
  check(photoReplay.replayed === true, 'photo metadata retry is idempotent');
  await rejects(() => reservePhoto(a, first.id, assetId, photoPath, 'b'.repeat(64), photoKey), 'IDEMPOTENCY_CONFLICT');
  await login(a);
  await rejects(() => db.query(
    'select public.garage_finalize_vehicle_photo($1,$2,$3)',
    [a, photoKey, randomUUID()],
  ), 'permission denied');
  await rejects(() => db.query('select public.garage_fail_vehicle_photo($1,$2)', [a, photoKey]), 'permission denied');
  await rejects(() => db.query('select object_path from public.media_assets where id=$1', [assetId]), 'permission denied');
  await rejects(() => db.query("insert into public.media_assets(owner_id,vehicle_id,object_path,purpose) values ($1,$2,'forged','vehicle_display')", [a, first.id]), 'permission denied');
  await db.exec('reset role');
  const recoveryKey = randomUUID(), recoveryAsset = randomUUID();
  const recoveryPath = `${a}/vehicles/${first.id}/${recoveryAsset}/original.jpg`;
  await reservePhoto(a, first.id, recoveryAsset, recoveryPath, 'e'.repeat(64), recoveryKey);
  await service("insert into storage.objects(bucket_id,name) values ('private-media',$1)", [recoveryPath]);
  await db.exec("create function public.test_photo_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'TEST_PHOTO_AUDIT_FAILURE'; end $$; create trigger test_photo_audit_fail before insert on public.audit_events for each row execute function public.test_photo_audit_fail();");
  await rejects(() => finalizePhoto(a, recoveryKey), 'TEST_PHOTO_AUDIT_FAILURE');
  check((await service('select processing_state from public.media_assets where id=$1', [recoveryAsset])).rows[0].processing_state === 'uploading',
    'post-upload database failure retains a durable reconciliation reservation');
  check((await service("select count(*)::int as n from storage.objects where bucket_id='private-media' and name=$1", [recoveryPath])).rows[0].n === 1,
    'post-upload database failure does not race-delete the private object');
  await db.exec('drop trigger test_photo_audit_fail on public.audit_events');
  const recovered = await finalizePhoto(a, recoveryKey);
  check(recovered.id === recoveryAsset && recovered.processing_state === 'stored', 'exact retry reconciles upload after database failure');
  check((await service("select count(*)::int as n from public.vehicle_history where vehicle_id=$1 and payload->>'asset_id'=$2", [first.id, recoveryAsset])).rows[0].n === 1,
    'reconciliation records one photo history event');
  await login(a);
  await rejects(() => mutate('create', null, { ...input, model: 'Changed' }, key), 'IDEMPOTENCY_CONFLICT');
  await rejects(() => mutate('create', null, { ...input, owner_id: b }), 'VALIDATION_FAILED');
  await rejects(() => mutate('create', null, { ...input, year: '2020' }), 'VALIDATION_FAILED');
  await rejects(() => mutate('create', null, { ...input, make: '' }), 'VALIDATION_FAILED');
  await rejects(() => db.query('update public.vehicles set make = $1 where id = $2', ['Bypassed', first.id]), 'permission denied');
  await rejects(() => db.query('delete from public.vehicles where id = $1', [first.id]), 'permission denied');
  await rejects(() => db.query("insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source) values ($1,'vehicle_added',now(),'garage')", [first.id]), 'permission denied');
  await rejects(() => db.query('select * from public.garage_mutations'), 'permission denied');
  await login(b);
  check((await db.query('select * from public.vehicles where id = $1', [first.id])).rows.length === 0, 'RLS hides another user vehicle');
  check((await db.query('select * from public.vehicle_history where vehicle_id = $1', [first.id])).rows.length === 0, 'RLS hides another user history');
  await rejects(() => mutate('update', first.id, { ...input, expected_revision: 1 }), 'NOT_FOUND');
  await rejects(() => mutate('archive', first.id, { expected_revision: 1 }), 'NOT_FOUND');
  const foreignAsset = randomUUID();
  await rejects(() => reservePhoto(b, first.id, foreignAsset,
    `${b}/vehicles/${first.id}/${foreignAsset}/original.jpg`, 'c'.repeat(64), randomUUID()), 'NOT_FOUND');
  const other = await mutate('create', null, input, key);
  check(other.id !== first.id, 'same key is isolated by actor');
  await login(a);
  const edited = await mutate('update', first.id, { ...input, model: 'Camry', expected_revision: 1 });
  check(edited.revision === 2 && edited.model === 'Camry', 'edit increments revision');
  await rejects(() => mutate('update', first.id, { ...input, expected_revision: 1 }), 'REVISION_CONFLICT');
  const racingKey = randomUUID(), racingAsset = randomUUID();
  const racingPath = `${a}/vehicles/${first.id}/${racingAsset}/original.jpg`;
  await reservePhoto(a, first.id, racingAsset, racingPath, 'f'.repeat(64), racingKey);
  await service("insert into storage.objects(bucket_id,name) values ('private-media',$1)", [racingPath]);
  await login(a);
  const archiveKey = randomUUID();
  const archived = await mutate('archive', first.id, { expected_revision: 2 }, archiveKey);
  check(archived.revision === 3 && !!archived.archived_at, 'archive retains vehicle with new revision');
  const racingFinal = await finalizePhoto(a, racingKey);
  check(racingFinal.processing_state === 'stored', 'photo reserved before a concurrent archive finalizes to one reconciled record');
  await login(a);
  check((await mutate('archive', first.id, { expected_revision: 2 }, archiveKey)).revision === 3, 'archive retry is idempotent');
  await rejects(() => mutate('update', first.id, { ...input, expected_revision: 3 }), 'VEHICLE_ARCHIVED');
  const archivedAsset = randomUUID();
  await rejects(() => reservePhoto(a, first.id, archivedAsset,
    `${a}/vehicles/${first.id}/${archivedAsset}/original.jpg`, 'd'.repeat(64), randomUUID()), 'VEHICLE_ARCHIVED');
  await login(a);
  check((await db.query('select count(*)::int as n from public.vehicle_history where vehicle_id = $1', [first.id])).rows[0].n === 6, 'history recorded once per committed mutation/photo');
  await db.exec('reset role');
  check((await db.query('select count(*)::int as n from public.audit_events where resource_id = $1', [first.id])).rows[0].n === 6, 'audit recorded atomically without retry duplicates');
  // A failing audit insert must roll back vehicle/history/ledger, not return partial success.
  await db.exec("create function public.test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end $$; create trigger test_audit_fail before insert on public.audit_events for each row execute function public.test_audit_fail();");
  await login(a);
  await rejects(() => mutate('create', null, input), 'TEST_AUDIT_FAILURE');
  check((await db.query('select count(*)::int as n from public.vehicles')).rows[0].n === 1, 'failed audit rolls back vehicle creation');
  await db.exec('reset role; drop trigger test_audit_fail on public.audit_events;');
  await login('');
  await rejects(() => mutate('create', null, input), 'UNAUTHENTICATED');
  console.log(`PASS: ${checks} migration/RLS/RPC checks (${engine}; auth/storage stubs, not live Supabase).`);
} finally { await db.close(); }
