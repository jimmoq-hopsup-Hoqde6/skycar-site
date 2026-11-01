import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// DB acceptance for N2 (photo_count / has_photos on care_list_requests) and N6
// (atomic per-subject upload quota). Disposable database only.
export async function verifyRequestPhotos({ sql, auth, quote, run, carePayload, garageCreate }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const service = statement => `begin; set local role service_role; ${statement}; commit;`;
  const anon = statement => `begin; set local role anon; ${statement}; commit;`;
  const first = output => output.split('\n')[0];
  const json = output => JSON.parse(first(output));
  const denies = (statement, expected, label) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(expected), label);
    checks += 1;
  };
  const sha = value => createHash('sha256').update(value).digest('hex');
  const migrationPath = 'supabase/migrations/20261101130000_request_photo_flag_and_upload_quota.sql';
  const migration = readFileSync(migrationPath, 'utf8');
  assert.equal(/care_journey_command|for update|advisory|pg_advisory/i.test(migration.replace(/--.*$/gm, '')), false, 'migration must not touch the journey command or locks');
  checks += 1;

  const owner = randomUUID(); const stranger = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)}),(${quote(stranger)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Photo flag');
  const otherVehicle = garageCreate(stranger, randomUUID(), 'Photo flag other');
  const submit = (actor, vehicleId) => json(sql(auth(actor,
    `select public.care_submit_request(${quote(randomUUID())}::uuid, ${quote(carePayload(vehicleId))}::jsonb)`))).request.id;
  const withPhotos = submit(owner, vehicle.id);
  const without = submit(owner, vehicle.id);
  const strangers = submit(stranger, otherVehicle.id);
  const list = (actor, args = '') => json(sql(auth(actor, `select public.care_list_requests(${args})`)));
  const item = (actor, id) => list(actor).items.find(entry => entry.id === id);

  // Defaults, and the #76 fields remain in the projection.
  for (const id of [withPhotos, without]) {
    equal(item(owner, id).photo_count, 0, 'no marker means zero photos');
    equal(item(owner, id).has_photos, false);
    assert.ok('journey_state' in item(owner, id) && 'completion_review_state' in item(owner, id), '#76 fields kept'); checks += 1;
  }

  // Function shape and grants are unchanged.
  equal(sql(`select pg_get_function_arguments('public.care_list_requests(integer,uuid,timestamptz,uuid)'::regprocedure)`),
    'p_limit integer DEFAULT 20, p_vehicle_id uuid DEFAULT NULL::uuid, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid');
  equal(sql(`select (prosecdef)::text || ':' || coalesce(proconfig::text,'') from pg_proc where oid='public.care_list_requests(integer,uuid,timestamptz,uuid)'::regprocedure`), 'true:{"search_path=\\"\\""}');
  equal(sql(`select has_function_privilege('authenticated','public.care_list_requests(integer,uuid,timestamptz,uuid)','execute')::text || has_function_privilege('anon','public.care_list_requests(integer,uuid,timestamptz,uuid)','execute')::text || has_function_privilege('service_role','public.care_list_requests(integer,uuid,timestamptz,uuid)','execute')::text`), 'truefalsefalse');

  // Browser roles cannot set, read or reach the marker or quota objects.
  const recordCall = (id, count, hash) => `select public.care_record_request_photos(${quote(id)}::uuid, ${count}, ${quote(hash)})`;
  const manifest = sha('manifest-bytes');
  denies(auth(owner, recordCall(withPhotos, 2, manifest)), 'permission denied', 'authenticated cannot call record RPC');
  denies(anon(recordCall(withPhotos, 2, manifest)), 'permission denied', 'anon cannot call record RPC');
  denies(auth(owner, `insert into public.care_request_photo_sets(request_id,photo_count,manifest_sha256) values (${quote(withPhotos)}::uuid,3,${quote(manifest)})`), 'permission denied', 'no direct insert');
  denies(auth(owner, 'select * from public.care_request_photo_sets'), 'permission denied', 'no direct read');
  denies(auth(owner, "select public.care_reserve_photo_upload_slot('x', 5, 3600)"), 'permission denied', 'authenticated cannot reserve quota');
  denies(anon("select public.care_reserve_photo_upload_slot('x', 5, 3600)"), 'permission denied', 'anon cannot reserve quota');
  denies(auth(owner, "select public.care_release_photo_upload_slot('x', now())"), 'permission denied', 'authenticated cannot release quota');
  denies(anon("select public.care_release_photo_upload_slot('x', now())"), 'permission denied', 'anon cannot release quota');
  denies(auth(owner, 'select * from public.care_photo_upload_quota'), 'permission denied', 'quota table is private');
  equal(sql(`select count(*) from public.care_request_photo_sets`), '0', 'nothing was written by denied callers');

  // Trusted route path: validation, ownership of the request row, write-once replay.
  denies(service(recordCall(withPhotos, 0, manifest)), 'VALIDATION_FAILED');
  denies(service(recordCall(withPhotos, 4, manifest)), 'VALIDATION_FAILED');
  denies(service(recordCall(withPhotos, 2, 'not-a-hash')), 'VALIDATION_FAILED');
  denies(service(recordCall(randomUUID(), 2, manifest)), 'NOT_FOUND');
  equal(json(sql(service(recordCall(withPhotos, 2, manifest)))), { request_id: withPhotos, photo_count: 2, replayed: false });
  equal(json(sql(service(recordCall(withPhotos, 2, manifest)))), { request_id: withPhotos, photo_count: 2, replayed: true });
  denies(service(recordCall(withPhotos, 3, manifest)), 'IDEMPOTENCY_CONFLICT');
  denies(service(recordCall(withPhotos, 2, sha('other'))), 'IDEMPOTENCY_CONFLICT');
  denies(service(`update public.care_request_photo_sets set photo_count=1 where request_id=${quote(withPhotos)}::uuid`), 'permission denied', 'marker is write-once');
  denies(service(`delete from public.care_request_photo_sets where request_id=${quote(withPhotos)}::uuid`), 'permission denied', 'marker cannot be deleted');
  equal(sql(`select photo_count::text from public.care_request_photo_sets where request_id=${quote(withPhotos)}::uuid`), '2');

  // Projection: only the owner's marked request carries a count; no cross-account leakage.
  equal([item(owner, withPhotos).photo_count, item(owner, withPhotos).has_photos], [2, true]);
  equal([item(owner, without).photo_count, item(owner, without).has_photos], [0, false]);
  equal(list(stranger).items.map(entry => [entry.id, entry.photo_count, entry.has_photos]), [[strangers, 0, false]]);
  assert.equal(JSON.stringify(list(stranger)).includes(manifest), false, 'manifest hash never leaves the database'); checks += 1;
  assert.equal(JSON.stringify(list(owner)).includes(manifest), false); checks += 1;
  // Pagination and the vehicle filter still work with the join.
  const page = list(owner, 'p_limit => 1');
  equal(page.items.length, 1); assert.ok(page.next_position); checks += 1;
  const second = list(owner, `p_limit => 1, p_before_created_at => ${quote(page.next_position.created_at)}::timestamptz, p_before_id => ${quote(page.next_position.id)}::uuid`);
  equal(new Set([page.items[0].id, second.items[0].id]), new Set([withPhotos, without]));
  equal(list(owner, `p_vehicle_id => ${quote(vehicle.id)}::uuid`).items.length, 2);
  // Journey-state projection still coexists with the photo fields.
  sql(`insert into public.care_journeys(id, account_request_id, state) values (${quote(withPhotos)}::uuid, ${quote(withPhotos)}::uuid, 'quotes_ready')`);
  equal([item(owner, withPhotos).journey_state, item(owner, withPhotos).photo_count], ['quotes_ready', 2]);

  // N6: reserve/release. Boundary, per-subject isolation, denied calls do not consume, rollover.
  const reserve = (subject, limit, window = 3600) => json(sql(service(`select public.care_reserve_photo_upload_slot(${quote(subject)}, ${limit}, ${window})`)));
  const release = (subject, windowStart) => json(sql(service(`select public.care_release_photo_upload_slot(${quote(subject)}, ${quote(windowStart)}::timestamptz)`)));
  const used = subject => Number(sql(`select coalesce(sum(uploads),0) from public.care_photo_upload_quota where subject=${quote(subject)}`));
  const a = `journey-photos:${owner}`; const b = `journey-photos:${stranger}`;
  const steps = [1, 2, 3].map(() => reserve(a, 3));
  equal(steps.map(step => [step.allowed, step.used, step.remaining]), [[true, 1, 2], [true, 2, 1], [true, 3, 0]]);
  assert.ok(steps.every(step => step.window_start === steps[0].window_start)); checks += 1;
  const denied = reserve(a, 3);
  equal([denied.allowed, denied.used, denied.remaining], [false, 3, 0]);
  assert.ok(denied.retry_after_seconds >= 1 && denied.retry_after_seconds <= 3600); checks += 1;
  equal(reserve(a, 3).used, 3, 'denied attempts do not increment');
  // Failure releases the slot: a released slot is immediately reusable, and the limit stays exact.
  equal(release(a, steps[0].window_start), { released: true, used: 2 });
  equal(used(a), 2);
  const reused = reserve(a, 3);
  equal([reused.allowed, reused.used], [true, 3]);
  equal(reserve(a, 3).allowed, false, 'limit is still exact after release and re-reserve');
  // Releases never go below zero and an unknown window releases nothing.
  for (let i = 0; i < 3; i++) release(a, steps[0].window_start);
  equal(release(a, steps[0].window_start), { released: false, used: null });
  equal(used(a), 0, 'count floors at zero');
  equal(release(b, steps[0].window_start), { released: false, used: null });
  equal(reserve(a, 3).used, 1, 'a floored window counts from zero again');
  equal(reserve(b, 3).allowed, true, 'another account is independent');
  denies(service("select public.care_reserve_photo_upload_slot('', 3, 3600)"), 'VALIDATION_FAILED');
  denies(service(`select public.care_reserve_photo_upload_slot(${quote('x'.repeat(81))}, 3, 3600)`), 'VALIDATION_FAILED');
  denies(service("select public.care_reserve_photo_upload_slot('x', 0, 3600)"), 'VALIDATION_FAILED');
  denies(service("select public.care_reserve_photo_upload_slot('x', 3, 59)"), 'VALIDATION_FAILED');
  denies(service("select public.care_release_photo_upload_slot('', now())"), 'VALIDATION_FAILED');
  denies(service("select public.care_release_photo_upload_slot('x', null)"), 'VALIDATION_FAILED');
  const rolling = `journey-photos:${randomUUID()}`;
  const firstWindow = reserve(rolling, 1, 60);
  equal(firstWindow.allowed, true);
  equal(reserve(rolling, 1, 60).allowed, false);
  sql(`update public.care_photo_upload_quota set window_start = window_start - interval '60 seconds' where subject=${quote(rolling)}`);
  equal(reserve(rolling, 1, 60).allowed, true, 'a new window starts a new count');
  sql(`update public.care_photo_upload_quota set window_start = window_start - interval '1 day' where subject=${quote(rolling)}`);
  sql(`insert into public.care_photo_upload_quota(subject,window_start,uploads) values (${quote(rolling)}, now() - interval '3 days', 1)`);
  reserve(rolling, 1, 60);
  equal(sql(`select count(*) from public.care_photo_upload_quota where subject=${quote(rolling)}`), '1', 'expired windows are pruned');

  // Concurrency: many simultaneous sessions never exceed the limit and never deadlock.
  const crowded = `journey-photos:${randomUUID()}`;
  const attempts = await Promise.all(Array.from({ length: 40 }, async () => {
    try { return JSON.parse(first(await run(service(`select public.care_reserve_photo_upload_slot(${quote(crowded)}, 7, 3600)`)))); }
    catch (error) { return { error: `${error.message}\n${error.stderr ?? ''}` }; }
  }));
  assert.equal(attempts.some(entry => entry.error), false, JSON.stringify(attempts.filter(entry => entry.error))); checks += 1;
  equal(attempts.filter(entry => entry.allowed).length, 7, 'exactly the limit is allowed');
  equal(attempts.filter(entry => !entry.allowed).length, 33);
  equal(used(crowded), 7);
  // Concurrent releases of the held slots return exactly the held count, never more.
  const windowStart = attempts.find(entry => entry.allowed).window_start;
  const releases = await Promise.all(Array.from({ length: 20 }, async () => JSON.parse(first(await run(service(`select public.care_release_photo_upload_slot(${quote(crowded)}, ${quote(windowStart)}::timestamptz)`))))));
  equal(releases.filter(entry => entry.released).length, 7);
  equal(used(crowded), 0);
  // Mixed concurrent reserve and release: the stored count always equals reserves minus releases.
  const mixed = `journey-photos:${randomUUID()}`;
  const seed = reserve(mixed, 50);
  const mix = await Promise.all(Array.from({ length: 30 }, async (_, index) => index % 3 === 0
    ? JSON.parse(first(await run(service(`select public.care_release_photo_upload_slot(${quote(mixed)}, ${quote(seed.window_start)}::timestamptz)`))))
    : JSON.parse(first(await run(service(`select public.care_reserve_photo_upload_slot(${quote(mixed)}, 50, 3600)`))))));
  const granted = mix.filter(entry => entry.allowed).length; const refunded = mix.filter(entry => entry.released).length;
  equal(used(mixed), 1 + granted - refunded);
  // Concurrent identical marker writes converge on one row.
  const raced = submit(owner, vehicle.id);
  const writes = await Promise.all(Array.from({ length: 12 }, async () => JSON.parse(first(await run(service(recordCall(raced, 1, manifest)))))));
  equal(writes.filter(entry => !entry.replayed).length, 1);
  equal(sql(`select count(*) from public.care_request_photo_sets where request_id=${quote(raced)}::uuid`), '1');

  console.log(`PASS: ${checks} request photo flag and upload quota assertions (disposable database).`);
}
