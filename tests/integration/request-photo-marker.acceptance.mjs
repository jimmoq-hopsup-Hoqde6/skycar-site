import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// DB acceptance for migration 20261101150000: the explicit 'legacy_unknown' marker state, the
// quota-free heal, the storage backfill, the legacy -> recorded upgrade and marker cleanup on
// request delete. Disposable database only.
export async function verifyRequestPhotoMarker({ sql, auth, quote, run, carePayload, garageCreate }) {
  let checks = 0;
  const ok_ = (value, label) => { assert.ok(value, label); checks += 1; };
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const service = statement => `begin; set local role service_role; ${statement}; commit;`;
  const anon = statement => `begin; set local role anon; ${statement}; commit;`;
  const first = output => output.split('\n')[0];
  const json = output => JSON.parse(first(output));
  const denies = (statement, expected, label) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(expected), label ?? expected);
    checks += 1;
  };
  const sha = value => createHash('sha256').update(value).digest('hex');
  const frozen = readFileSync('supabase/migrations/20261101130000_request_photo_flag_and_upload_quota.sql');
  equal(sha(frozen), 'a7cb4fc96d65f6e204fa5515d8b6265f9ce92243dc6b9e896b698f665b9252d5', 'migration 20261101130000 is frozen and unchanged');
  const migrationPath = 'supabase/migrations/20261101150000_request_photo_marker_legacy_state_and_cleanup.sql';
  const migration = readFileSync(migrationPath, 'utf8');
  const code = migration.replace(/--.*$/gm, '');
  assert.equal(/care_journey_command|pg_advisory|care_journeys|care_quotes|for update\s+of|\bvehicles\b/i.test(code), false, 'no journey, vehicle, quote or advisory lock is touched'); checks += 1;
  assert.equal(/care_photo_upload_quota/.test(code), false, 'no new function touches the upload quota table'); checks += 1;

  const owner = randomUUID(); const stranger = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)}),(${quote(stranger)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Marker legacy');
  const strangerVehicle = garageCreate(stranger, randomUUID(), 'Marker legacy other');
  const submit = (actor, vehicleId) => json(sql(auth(actor, `select public.care_submit_request(${quote(randomUUID())}::uuid, ${quote(carePayload(vehicleId))}::jsonb)`))).request.id;
  const guestRow = () => { const id = randomUUID(); sql(`insert into public.care_guest_requests(id, idempotency_key, fingerprint, payload) values (${quote(id)}::uuid, gen_random_uuid(), ${quote(sha('fp'))}, '{}'::jsonb)`); return id; };
  // Requests have deep FK children (events, outbox, journeys, ...); a real purge removes them first.
  // This temp function deletes the FK tree below one row (child triggers off), then the root row
  // with all its triggers (including the marker cleanup trigger) enabled. Setup helper only.
  const purgeFunction = `create or replace function pg_temp.purge(rel regclass, keycol name, vals text[], root boolean default false) returns void language plpgsql as $f$
    declare k record; child_pk name; ids text[];
    begin
      for k in select conrelid::regclass as child, (select attname from pg_attribute where attrelid = conrelid and attnum = conkey[1]) as col
        from pg_constraint where contype = 'f' and confrelid = rel loop
        select a.attname into child_pk from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = k.child and i.indisprimary and i.indnatts = 1;
        if child_pk is not null then
          execute format('select coalesce(array_agg(%I::text), ''{}'') from %s where %I::text = any($1)', child_pk, k.child, k.col) using vals into ids;
          if cardinality(ids) > 0 then perform pg_temp.purge(k.child, child_pk, ids); end if;
        else
          execute format('alter table %s disable trigger user', k.child);
          execute format('delete from %s where %I::text = any($1)', k.child, k.col) using vals;
          execute format('alter table %s enable trigger user', k.child);
        end if;
      end loop;
      if not root then execute format('alter table %s disable trigger user', rel); end if;
      execute format('delete from %s where %I::text = any($1)', rel, keycol) using vals;
      if not root then execute format('alter table %s enable trigger user', rel); end if;
    end $f$;`;
  const purge = (table, id) => `${purgeFunction} select pg_temp.purge('${table}'::regclass, 'id', array['${id}']::text[], true);`;
  const list = actor => json(sql(auth(actor, 'select public.care_list_requests()')));
  const item = (actor, id) => list(actor).items.find(entry => entry.id === id);
  const row = id => sql(`select coalesce(marker_state,'') || ':' || coalesce(manifest_sha256,'NULL') || ':' || photo_count || ':' || request_kind from public.care_request_photo_sets where request_id=${quote(id)}::uuid`);
  const rows = id => sql(`select count(*) from public.care_request_photo_sets where request_id=${quote(id)}::uuid`);
  const heal = (id, kind) => `select public.care_heal_request_photo_marker(${quote(id)}::uuid${kind ? `, ${quote(kind)}` : ''})`;
  const observed = (id, kind) => sql(`select coalesce(public.care_observed_request_photo_count(${quote(id)}::uuid, ${quote(kind)})::text, 'null')`);
  const putObjects = (kind, id, slots, { manifest = true, bucket = 'private-media', folder } = {}) => {
    const base = `${folder ?? (kind === 'account' ? 'care-requests' : 'guest-requests')}/${id}`;
    const names = [...(manifest ? ['manifest.json'] : []), ...slots.map(n => `photo-${n}`)];
    sql(`insert into storage.objects(bucket_id, name) values ${names.map(name => `(${quote(bucket)}, ${quote(`${base}/${name}`)})`).join(',')}`);
  };
  const record = (id, count, hash, kind) => `select public.care_record_request_photos(${quote(id)}::uuid, ${count}, ${quote(hash)}${kind ? `, ${quote(kind)}` : ''})`;
  const quotaRows = () => sql('select coalesce(sum(uploads),0) || \':\' || count(*) from public.care_photo_upload_quota');

  // Shape: explicit state column, hash only for recorded, definer functions with an empty search_path.
  equal(sql("select column_default || ':' || is_nullable from information_schema.columns where table_name='care_request_photo_sets' and column_name='marker_state'"), "'recorded'::text:NO");
  equal(sql("select is_nullable from information_schema.columns where table_name='care_request_photo_sets' and column_name='manifest_sha256'"), 'YES');
  const fns = ['care_record_request_photos(uuid,integer,text,text)', 'care_heal_request_photo_marker(uuid,text)', 'care_observed_request_photo_count(uuid,text)', 'care_backfill_legacy_photo_markers()', 'care_delete_request_photo_marker()'];
  for (const fn of fns) {
    equal(sql(`select (prosecdef)::text || ':' || coalesce(proconfig::text,'') from pg_proc where oid='public.${fn}'::regprocedure`), 'true:{"search_path=\\"\\""}', fn);
    const grants = ['anon', 'authenticated', 'service_role'].map(role => sql(`select has_function_privilege('${role}','public.${fn}','execute')::text`)).join(',');
    equal(grants, fn.startsWith('care_record') || fn.startsWith('care_heal') ? 'false,false,true' : 'false,false,false', `grants of ${fn}`);
  }
  // The table keeps service_role at select+insert: only the definer functions can change a marker.
  denies(service(`update public.care_request_photo_sets set photo_count=1`), 'permission denied');
  denies(service(`delete from public.care_request_photo_sets`), 'permission denied');
  denies(service(`select public.care_backfill_legacy_photo_markers()`), 'permission denied');
  denies(service(`select public.care_delete_request_photo_marker()`), 'permission denied');
  denies(auth(owner, heal(randomUUID())), 'permission denied', 'authenticated cannot heal');
  denies(anon(heal(randomUUID())), 'permission denied', 'anon cannot heal');

  // Heal: validation, existence by kind. Without Storage objects there is nothing to heal.
  const legacy = submit(owner, vehicle.id);
  const otherLegacy = submit(stranger, strangerVehicle.id);
  denies(service(heal(legacy, 'other')), 'VALIDATION_FAILED');
  denies(service(heal(randomUUID())), 'NOT_FOUND');
  denies(service(heal(legacy, 'guest')), 'NOT_FOUND', 'an account id is not a guest request');
  equal(json(sql(service(heal(legacy)))), { state: 'none', healed: false });
  equal(rows(legacy), '0', 'no objects: no marker, nothing invented');
  equal(item(owner, legacy).has_photos, false);
  // What counts as an observable set: manifest + consecutive photo-1..N (N<=3) in private-media.
  const shapes = [
    ['manifest only', { slots: [] }, 'null'], ['photos without manifest', { slots: [1, 2], manifest: false }, 'null'],
    ['gap', { slots: [1, 3] }, 'null'], ['starts at 2', { slots: [2, 3] }, 'null'], ['four slots', { slots: [1, 2, 3, 4] }, 'null'],
    ['other bucket', { slots: [1], bucket: 'other-bucket' }, 'null'], ['completion prefix', { slots: [1], folder: 'care-completion' }, 'null'],
    ['one photo', { slots: [1] }, '1'], ['three photos', { slots: [1, 2, 3] }, '3'],
  ];
  const shapeIds = [];
  for (const [label, shape, expected] of shapes) {
    const id = submit(owner, vehicle.id);
    if (['one photo', 'three photos'].includes(label)) shapeIds.push([id, expected]);
    if (shape.slots.length || shape.manifest !== false) putObjects('account', id, shape.slots, shape);
    equal(observed(id, 'account'), expected, label);
    equal(observed(id, 'guest'), 'null', `${label}: the account prefix is not a guest set`);
  }
  // At the upload limit: the heal still works and consumes nothing.
  const subject = `journey-photos:${owner}`;
  for (let i = 0; i < 3; i++) json(sql(service(`select public.care_reserve_photo_upload_slot(${quote(subject)}, 3, 3600)`)));
  equal(json(sql(service(`select public.care_reserve_photo_upload_slot(${quote(subject)}, 3, 3600)`))).allowed, false, 'the account is at its limit');
  const quotaBefore = quotaRows();
  putObjects('account', legacy, [1, 2]);
  equal(json(sql(service(heal(legacy)))), { request_id: legacy, photo_count: 2, state: 'legacy_unknown', manifest_sha256: null, healed: true });
  equal(quotaRows(), quotaBefore, 'healing never touches the quota');
  equal(row(legacy), 'legacy_unknown:NULL:2:account');
  equal([item(owner, legacy).photo_count, item(owner, legacy).has_photos], [2, true], 'legacy requests now report their photos');
  equal(list(stranger).items.some(entry => entry.id === legacy), false);
  // Idempotent: a later heal returns the same marker and never rewrites it.
  sql(`insert into storage.objects(bucket_id, name) values ('private-media', ${quote(`care-requests/${legacy}/photo-3`)})`);
  equal(json(sql(service(heal(legacy)))), { request_id: legacy, photo_count: 2, state: 'legacy_unknown', manifest_sha256: null, healed: false });
  equal(rows(legacy), '1');
  // The state/hash invariant is enforced by the table itself.
  denies(`insert into public.care_request_photo_sets(request_id,photo_count,manifest_sha256,marker_state) values (${quote(otherLegacy)}::uuid,1,null,'recorded')`, 'care_request_photo_sets_state_hash');
  denies(`insert into public.care_request_photo_sets(request_id,photo_count,manifest_sha256,marker_state) values (${quote(otherLegacy)}::uuid,1,${quote(sha('x'))},'legacy_unknown')`, 'care_request_photo_sets_state_hash');
  denies(`insert into public.care_request_photo_sets(request_id,photo_count,manifest_sha256,marker_state) values (${quote(otherLegacy)}::uuid,1,null,'bogus')`, 'marker_state_check');

  // Upgrade by the identical set: real hash from the body, replayed:false (the upgrade creates the
  // recorded set, so the caller keeps its slot), then ordinary replays and conflicts.
  const real = sha('manifest of the identical set');
  equal(json(sql(service(record(legacy, 3, real)))), { request_id: legacy, photo_count: 3, replayed: false });
  equal(row(legacy), `recorded:${real}:3:account`, 'the legacy count is replaced by the verified count');
  equal(quotaRows(), quotaBefore, 'the upgrade never touches the quota table');
  equal(json(sql(service(record(legacy, 3, real)))).replayed, true);
  denies(service(record(legacy, 3, sha('different'))), 'IDEMPOTENCY_CONFLICT');
  denies(service(record(legacy, 1, real)), 'IDEMPOTENCY_CONFLICT');
  // A recorded marker is never downgraded or changed by the heal; the hash is only reported.
  equal(json(sql(service(heal(legacy)))), { request_id: legacy, photo_count: 3, state: 'recorded', manifest_sha256: real, healed: false });
  equal(row(legacy), `recorded:${real}:3:account`);
  // Fresh recording is unchanged: same return shape, replay and conflict as before.
  const fresh = submit(stranger, strangerVehicle.id);
  const freshHash = sha('fresh');
  equal(json(sql(service(record(fresh, 1, freshHash)))), { request_id: fresh, photo_count: 1, replayed: false });
  equal(json(sql(service(record(fresh, 1, freshHash)))), { request_id: fresh, photo_count: 1, replayed: true });
  denies(service(record(fresh, 1, sha('other'))), 'IDEMPOTENCY_CONFLICT');

  // Guests: same states, kind-checked.
  const guestLegacy = guestRow();
  denies(service(heal(guestLegacy)), 'NOT_FOUND', 'guest id with account kind');
  equal(json(sql(service(heal(guestLegacy, 'guest')))), { state: 'none', healed: false });
  putObjects('guest', guestLegacy, [1]);
  equal(json(sql(service(heal(guestLegacy, 'guest')))), { request_id: guestLegacy, photo_count: 1, state: 'legacy_unknown', manifest_sha256: null, healed: true });
  equal(row(guestLegacy), 'legacy_unknown:NULL:1:guest');
  equal(json(sql(service(record(guestLegacy, 1, sha('guest set'), 'guest')))).replayed, false);
  equal(row(guestLegacy), `recorded:${sha('guest set')}:1:guest`);

  // Backfill from storage.objects: only complete, consecutive, existing, private-media sets; never a hash.
  const objects = [];
  const put = (bucket, name) => objects.push(`(${quote(bucket)}, ${quote(name)})`);
  const mk = () => submit(owner, vehicle.id);
  const bfTwo = mk(); const bfNoManifest = mk(); const bfGap = mk(); const bfRecorded = mk(); const bfFour = mk(); const bfOther = mk(); const bfCompletion = mk();
  const bfGuest = guestRow(); const bfGhost = randomUUID();
  put('private-media', `care-requests/${bfTwo}/manifest.json`); put('private-media', `care-requests/${bfTwo}/photo-1`); put('private-media', `care-requests/${bfTwo}/photo-2`);
  put('private-media', `care-requests/${bfNoManifest}/photo-1`);
  put('private-media', `care-requests/${bfGap}/manifest.json`); put('private-media', `care-requests/${bfGap}/photo-1`); put('private-media', `care-requests/${bfGap}/photo-3`);
  put('private-media', `care-requests/${bfRecorded}/manifest.json`); put('private-media', `care-requests/${bfRecorded}/photo-1`);
  put('private-media', `care-requests/${bfFour}/manifest.json`); for (const n of [1, 2, 3, 4]) put('private-media', `care-requests/${bfFour}/photo-${n}`);
  put('other-bucket', `care-requests/${bfOther}/manifest.json`); put('other-bucket', `care-requests/${bfOther}/photo-1`);
  put('private-media', `care-completion/${bfCompletion}/manifest.json`); put('private-media', `care-completion/${bfCompletion}/photo-1`);
  put('private-media', `guest-requests/${bfGuest}/manifest.json`); put('private-media', `guest-requests/${bfGuest}/photo-1`);
  put('private-media', `care-requests/${bfGhost}/manifest.json`); put('private-media', `care-requests/${bfGhost}/photo-1`);
  put('private-media', 'care-requests/not-a-uuid/manifest.json');
  sql(`insert into storage.objects(bucket_id, name) values ${objects.join(',')}`);
  sql(service(record(bfRecorded, 1, sha('already recorded'))));
  equal(sql('select public.care_backfill_legacy_photo_markers()'), '4', 'two shaped sets, one account set and one guest set are backfilled; already-marked ones are skipped');
  for (const [id, count] of shapeIds) equal(row(id), `legacy_unknown:NULL:${count}:account`);
  equal(row(bfTwo), 'legacy_unknown:NULL:2:account');
  equal(row(bfGuest), 'legacy_unknown:NULL:1:guest');
  equal(row(bfRecorded), `recorded:${sha('already recorded')}:1:account`, 'an existing marker is never touched');
  for (const id of [bfNoManifest, bfGap, bfFour, bfOther, bfCompletion, bfGhost]) equal(rows(id), '0', `no marker for ${id}`);
  equal(sql(`select count(*) from public.care_request_photo_sets where marker_state='legacy_unknown' and manifest_sha256 is not null`), '0', 'no hash is ever fabricated');
  equal(sql('select public.care_backfill_legacy_photo_markers()'), '0', 'the backfill is idempotent');
  equal([item(owner, bfTwo).photo_count, item(owner, bfTwo).has_photos], [2, true]);
  // The backfill is skipped, not failed, where Storage metadata does not exist.
  const skipped = sql('begin; alter schema storage rename to storage_hidden; select public.care_backfill_legacy_photo_markers(); alter schema storage_hidden rename to storage; commit;');
  assert.ok(first(skipped).startsWith('0'), skipped); checks += 1;
  equal(sql("select to_regclass('storage.objects') is not null"), 't');

  // Prerequisite: the migration role needs USAGE on schema storage. Without it, to_regclass and
  // has_table_privilege raise 42501; the backfill (the last statement of the migration) must
  // skip with a NOTICE instead of aborting the whole migration. Simulated by giving the backfill and the
  // observation function an owner with no privilege on schema storage (rolled back afterwards).
  sql(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'photo_nousage_owner') then create role photo_nousage_owner nologin; end if; end $$`);
  sql('revoke all on schema storage from photo_nousage_owner; revoke all on all tables in schema storage from photo_nousage_owner');
  equal(sql("select has_schema_privilege('photo_nousage_owner', 'storage', 'usage')"), 'f', 'the simulated owner has no USAGE on schema storage');
  const asNoUsageOwner = body => spawnSync('psql', [process.env.GARAGE_CARE_TEST_DATABASE_URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
    `begin; grant create on schema public to photo_nousage_owner;
     alter function public.care_backfill_legacy_photo_markers() owner to photo_nousage_owner;
     alter function public.care_observed_request_photo_count(uuid, text) owner to photo_nousage_owner;
     ${body}; rollback;`], { encoding: 'utf8' });
  const noUsageBefore = sql('select count(*) from public.care_request_photo_sets');
  const noUsage = asNoUsageOwner('select public.care_backfill_legacy_photo_markers()');
  equal(noUsage.status, 0, `the backfill by a role without USAGE on storage does not fail: ${noUsage.stderr}`);
  ok_(/^0$/m.test(noUsage.stdout), 'it returns 0');
  ok_(/NOTICE:\s+care_backfill_legacy_photo_markers: role photo_nousage_owner has no USAGE on schema storage; skipped/.test(noUsage.stderr), `it says why in a NOTICE: ${noUsage.stderr}`);
  const observedNoUsage = asNoUsageOwner(`select public.care_observed_request_photo_count(${quote(bfTwo)}::uuid, 'account') is null`);
  equal(observedNoUsage.status, 0, `the observation by a role without USAGE does not raise: ${observedNoUsage.stderr}`);
  ok_(/^t$/m.test(observedNoUsage.stdout), 'it answers "unknown" (NULL)');
  equal(sql('select count(*) from public.care_request_photo_sets'), noUsageBefore, 'the skipped backfill wrote nothing');
  equal(sql("select pg_get_userbyid(proowner) from pg_proc where proname = 'care_backfill_legacy_photo_markers'") !== 'photo_nousage_owner', true, 'ownership change was rolled back');
  sql('drop owned by photo_nousage_owner; drop role photo_nousage_owner');
  // The migration text carries the explicit prerequisite and the ordered checks.
  for (const needle of ["has_schema_privilege(current_user, 'storage', 'usage')", "to_regnamespace('storage')", 'no USAGE on schema storage']) {
    ok_(migration.includes(needle), `migration states the storage USAGE prerequisite: ${needle}`);
  }
  assert.ok(migration.indexOf("has_schema_privilege(current_user, 'storage', 'usage')") < migration.indexOf("to_regclass('storage.objects')"), 'USAGE is checked before the first call that needs it'); checks += 1;

  // Cleanup on delete: the marker goes with its request; other markers stay.
  const doomed = submit(owner, vehicle.id); const kept = submit(owner, vehicle.id);
  sql(service(record(doomed, 1, sha('doomed')))); sql(service(record(kept, 1, sha('kept'))));
  equal(rows(doomed), '1');
  sql(purge('public.care_requests', doomed));
  equal(rows(doomed), '0', 'account marker is removed with its request');
  equal(rows(kept), '1');
  sql(purge('public.care_requests', bfTwo));
  equal(rows(bfTwo), '0', 'legacy marker is removed with its request');
  const doomedGuest = guestRow();
  putObjects('guest', doomedGuest, [1]); sql(service(heal(doomedGuest, 'guest')));
  equal(rows(doomedGuest), '1');
  sql(purge('public.care_guest_requests', doomedGuest));
  equal(rows(doomedGuest), '0', 'guest marker is removed with its request');
  equal(rows(bfGuest), '1');
  // A cleanup trigger only removes the marker of its own kind.
  const crossed = randomUUID();
  sql(`insert into public.care_request_photo_sets(request_id, request_kind, photo_count, manifest_sha256) values (${quote(crossed)}::uuid,'guest',1,${quote(sha('crossed'))})`);
  const crossedAccount = submit(owner, vehicle.id);
  sql(`update public.care_requests set updated_at=updated_at where id=${quote(crossedAccount)}::uuid`);
  equal(rows(crossed), '1');
  // The migration's one-time sweep removes markers of requests that no longer exist (and only those).
  const sweep = /delete from public\.care_request_photo_sets m\b[\s\S]*?;/.exec(code)?.[0];
  assert.ok(sweep, 'sweep statement found'); checks += 1;
  const orphanAccount = randomUUID(); const orphanGuest = randomUUID();
  sql(`insert into public.care_request_photo_sets(request_id, request_kind, photo_count, manifest_sha256) values (${quote(orphanAccount)}::uuid,'account',1,${quote(sha('o1'))}),(${quote(orphanGuest)}::uuid,'guest',1,${quote(sha('o2'))})`);
  sql(sweep);
  equal([rows(orphanAccount), rows(orphanGuest)], ['0', '0'], 'orphans are swept');
  equal([rows(kept), rows(bfGuest), rows(legacy)], ['1', '1', '1'], 'live markers are kept');
  sql(`delete from public.care_request_photo_sets where request_id=${quote(crossed)}::uuid`);

  // A delete racing a marker write never leaves an orphan: the writer waits for the delete, then NOT_FOUND.
  const racing = submit(owner, vehicle.id);
  const deleter = run(`begin; ${purge('public.care_requests', racing)} select pg_sleep(1.2); commit;`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const late = await run(service(record(racing, 1, sha('late')))).then(() => 'ok', error => `${error.message}\n${error.stderr ?? ''}`);
  await deleter;
  assert.ok(late.includes('NOT_FOUND'), late); checks += 1;
  equal(rows(racing), '0', 'no orphan marker');
  // Concurrent heal, upgrade and replay calls on one request converge without deadlock or error.
  const raced = submit(owner, vehicle.id); const racedHash = sha('raced');
  putObjects('account', raced, [1, 2]);
  const calls = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
    const statement = index % 2 ? record(raced, 2, racedHash) : heal(raced);
    try { return JSON.parse(first(await run(service(statement)))); } catch (error) { return { error: `${error.message}\n${error.stderr ?? ''}` }; }
  }));
  assert.equal(calls.some(entry => entry.error), false, JSON.stringify(calls.filter(entry => entry.error))); checks += 1;
  equal(rows(raced), '1');
  equal(row(raced), `recorded:${racedHash}:2:account`);
  equal(calls.filter(entry => entry.replayed === false).length, 1, 'exactly one record call created (or upgraded to) the recorded set');
  // Marker writes and a journey command on the same request do not block each other.
  const journeyHolder = run(`begin; update public.care_requests set description=description where id=${quote(raced)}::uuid; select pg_sleep(0.8); commit;`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const started = Date.now();
  await run(service(heal(raced)));
  assert.ok(Date.now() - started < 600, 'marker write is not blocked by a non-key update of the request'); checks += 1;
  await journeyHolder;

  console.log(`PASS: ${checks} request photo marker legacy-state, heal, backfill and cleanup assertions (disposable database).`);
}
