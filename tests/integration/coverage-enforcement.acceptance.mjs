import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import data from '../../src/server/care/coverage-areas.json' with { type: 'json' };
import { buildCoverageIndex } from '../../src/server/care/coverage-resolver.ts';

// Server-side service-area enforcement (migration 20261101160000, including its deploy-window compatibility switch). Every case calls the real
// database functions as the roles a scripted client would use (authenticated via PostgREST RPC;
// service_role for guest intake), so the UI and /api/v1/care/coverage are bypassed entirely.
export async function verifyCoverageEnforcement({ sql, auth, quote, garageCreate, result }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const fails = (statement, expected, label = expected) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(expected), label);
    checks += 1;
  };
  const index = buildCoverageIndex(data);
  const covered = '5000', outside = ['5290', '3000', '0800', '5254', '9999'];
  for (const code of outside) for (const service of ['repair', 'cleaning']) assert.equal(index.get(service).has(code), false, `${code} must be outside the list`);
  assert.equal(index.get('repair').has(covered) && index.get('cleaning').has(covered), true);

  const owner = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Coverage');
  const payload = (overrides = {}, service = 'repair') => JSON.stringify({
    vehicle_id: vehicle.id, service, description: 'Scratch on rear bumper', preferred_window: 'flexible', postcode: covered, ...overrides,
  });
  const submit = (key, body) => `select public.care_submit_request(${quote(key)}::uuid, ${quote(body)}::jsonb)`;
  const counts = () => sql(`select (select count(*) from public.care_requests)||','||(select count(*) from public.care_request_commands)
    ||','||(select count(*) from public.care_request_events)||','||(select count(*) from public.care_notification_outbox)
    ||','||(select count(*) from public.care_guest_requests)`);
  const asOwner = (statement, setup = '') => `begin; ${setup} set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; ${statement}; rollback;`;

  // 1. One list: the table is the JSON, not a second copy that can drift.
  const rows = sql('select service||\':\'||postcode from public.care_service_coverage order by 1').split('\n');
  const expectedRows = [...index].flatMap(([service, codes]) => [...codes].map(code => `${service}:${code}`)).sort();
  equal(rows, expectedRows, 'database coverage rows equal the JSON-derived index');
  equal(sql('select area_id||\'|\'||version||\'|\'||(select count(*) from public.care_service_coverage_meta) from public.care_service_coverage_meta'), `${data.areaId}|${data.version}|1`, 'metadata identifies the same area and version');

  // 2. Nobody can read or edit the list over the API; only the definer functions read it.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    fails(`begin; set local role ${role}; select * from public.care_service_coverage`, 'permission denied');
    fails(`begin; set local role ${role}; delete from public.care_service_coverage`, 'permission denied');
    fails(`begin; set local role ${role}; insert into public.care_service_coverage_meta(area_id,version) values('x','y')`, 'permission denied');
  }
  for (const role of ['anon', 'authenticated']) fails(`begin; set local role ${role}; select public.care_assert_postcode_covered('repair','5000')`, 'permission denied');
  equal(sql(`begin; set local role service_role; select 'ok' from (select public.care_assert_postcode_covered('repair','5000')) x; rollback`).split('\n')[0], 'ok', 'service role may call the check');
  equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('care_assert_postcode_covered','care_submit_request','care_submit_guest_request') and p.proconfig @> array['search_path=\"\"']"), '3', 'all three keep search_path empty');
  equal(sql("select string_agg(proname||':'||prosecdef, ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ('care_assert_postcode_covered','care_submit_request','care_submit_guest_request')"),
    'care_assert_postcode_covered:true,care_submit_guest_request:false,care_submit_request:true', 'definer where it was definer, invoker where it was invoker');

  // 3. Authenticated bypass attempts: out of area, in either service, is refused with no trace.
  const before = counts();
  for (const code of outside) {
    for (const service of ['repair', 'cleaning']) {
      fails(auth(owner, submit(randomUUID(), payload({ postcode: code, service }, service))), 'OUT_OF_AREA', `${service} ${code}`);
    }
  }
  equal(counts(), before, 'rejections create no request, command, event, outbox or guest rows');

  // 4. A scripted client cannot skip the check by bending the postcode. (Leaving it out is the legacy
  //    four-key shape: allowed to replay always, and to create only while the compatibility switch is on; see 11.)
  const { postcode: dropped, ...legacy } = JSON.parse(payload()); void dropped;
  const legacyBody = (overrides = {}) => JSON.stringify({ ...legacy, ...overrides });
  const { description: noDescription, ...threeKeys } = legacy; void noDescription;
  fails(auth(owner, submit(randomUUID(), JSON.stringify(threeKeys))), 'VALIDATION_FAILED', 'three-key payload is not a valid shape');
  fails(auth(owner, submit(randomUUID(), JSON.stringify({ ...legacy, extra: 'x' }))), 'VALIDATION_FAILED', 'legacy shape plus an unknown key');
  fails(auth(owner, submit(randomUUID(), legacyBody({ service: 'detailing' }))), 'VALIDATION_FAILED', 'legacy shape with a bad service');
  for (const bad of ['500', '50000', ' 5000', '5000 ', '5000\n', 'abcd', '５０００', '', 5000, null, ['5000'], { v: '5000' }, true]) {
    fails(auth(owner, submit(randomUUID(), payload({ postcode: bad }))), 'VALIDATION_FAILED', `postcode ${JSON.stringify(bad)}`);
  }
  fails(auth(owner, submit(randomUUID(), payload({ suburb: 'Adelaide' }))), 'VALIDATION_FAILED', 'extra key still rejected');
  fails(auth(owner, submit(randomUUID(), payload({ service: 'detailing' }))), 'VALIDATION_FAILED');
  equal(counts(), before, 'validation failures create nothing');

  // 5. In-area creation works; the postcode is not stored on the request.
  let persisted = 0;
  const key = randomUUID();
  const created = JSON.parse(sql(auth(owner, submit(key, payload()))).split('\n')[0]);
  persisted += 1;
  equal(created.replayed, false, 'in-area request is created');
  equal(Object.keys(created.request).includes('postcode'), false, 'the receipt does not carry the postcode');
  for (const code of [covered, '5251', '5159']) {
    assert.equal(index.get('cleaning').has(code), true, code);
    persisted += 1;
    equal(JSON.parse(sql(auth(owner, submit(randomUUID(), payload({ postcode: code }, 'cleaning')))).split('\n')[0]).replayed, false, `cleaning ${code}`);
  }

  // 6. Idempotency: a replay returns the existing request and never re-decides coverage;
  //    the same key with a different postcode is a conflict, not an area rejection.
  equal(JSON.parse(sql(auth(owner, submit(key, payload()))).split('\n')[0]).replayed, true, 'plain replay');
  fails(auth(owner, submit(key, payload({ postcode: outside[0] }))), 'IDEMPOTENCY_CONFLICT', 'changed postcode on a used key');
  equal(JSON.parse(sql(asOwner(submit(key, payload()), 'delete from public.care_service_coverage; delete from public.care_service_coverage_meta;')).split('\n')[0]).replayed, true,
    'a replay still works while the list is unavailable');

  // 7. Requests stored before this migration have no postcode in their command: they replay against the other fields.
  sql(`update public.care_request_commands set payload = payload - 'postcode' where idempotency_key = ${quote(key)}::uuid`);
  equal(JSON.parse(sql(auth(owner, submit(key, payload()))).split('\n')[0]).request.id, created.request.id, 'legacy command replays the same request');
  equal(JSON.parse(sql(auth(owner, submit(key, payload({ postcode: outside[0] })))).split('\n')[0]).replayed, true, 'legacy replay is not re-decided by area');
  fails(auth(owner, submit(key, payload({ description: 'A different description here' }))), 'IDEMPOTENCY_CONFLICT', 'legacy replay with changed content');
  sql(`update public.care_request_commands set payload = payload || jsonb_build_object('postcode', ${quote(covered)}) where idempotency_key = ${quote(key)}::uuid`);

  // 11. Deploy window (migration first, app later, or a stale form). The legacy four-key payload:
  //     - replays any request already created, whichever shape created it, never VALIDATION_FAILED;
  //     - creates only while care_service_coverage_compat.accept_legacy_create is true (the default);
  //     - never makes the 5-key path weaker: a postcode that is present is always checked.
  equal(sql('select accept_legacy_create from public.care_service_coverage_compat'), 't', 'the switch is open by default');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    fails(`begin; set local role ${role}; select * from public.care_service_coverage_compat`, 'permission denied');
    fails(`begin; set local role ${role}; update public.care_service_coverage_compat set accept_legacy_create = false`, 'permission denied');
  }
  equal(sql("select relrowsecurity from pg_class where oid = 'public.care_service_coverage_compat'::regclass"), 't', 'RLS enabled on the switch');
  const closed = 'update public.care_service_coverage_compat set accept_legacy_create = false;';
  // 11a. a request created by the OLD function (command stored with four keys) replays in both shapes, also with the switch closed.
  const oldKey = randomUUID();
  const oldCreated = JSON.parse(sql(auth(owner, submit(oldKey, payload()))).split('\n')[0]); persisted += 1;
  sql(`update public.care_request_commands set payload = payload - 'postcode' where idempotency_key = ${quote(oldKey)}::uuid`);
  for (const [label, body] of [['legacy four-key', legacyBody()], ['five-key in area', payload()], ['five-key out of area', payload({ postcode: outside[0] })]]) {
    for (const [mode, setup] of [['switch open', ''], ['switch closed', closed], ['list unavailable', 'delete from public.care_service_coverage; delete from public.care_service_coverage_meta;'], ['switch row missing', 'delete from public.care_service_coverage_compat;']]) {
      const replay = JSON.parse(sql(asOwner(submit(oldKey, body), setup)).split('\n')[0]);
      equal([replay.replayed, replay.request.id], [true, oldCreated.request.id], `old-created request replays: ${label}, ${mode}`);
    }
  }
  fails(auth(owner, submit(oldKey, legacyBody({ description: 'A different description here' }))), 'IDEMPOTENCY_CONFLICT', 'legacy replay with changed content');
  fails(auth(owner, submit(oldKey, legacyBody({ preferred_window: 'seven_to_fourteen_days' }))), 'IDEMPOTENCY_CONFLICT', 'legacy replay with another window');
  // 11b. a request created by the NEW function (command has the postcode) replays from a legacy-shaped retry; two postcodes still conflict.
  const newKey = randomUUID();
  const newCreated = JSON.parse(sql(auth(owner, submit(newKey, payload()))).split('\n')[0]); persisted += 1;
  for (const setup of ['', closed, 'delete from public.care_service_coverage;']) {
    const replay = JSON.parse(sql(asOwner(submit(newKey, legacyBody()), setup)).split('\n')[0]);
    equal([replay.replayed, replay.request.id], [true, newCreated.request.id], `legacy-shaped retry of a five-key request replays (${setup || 'defaults'})`);
  }
  fails(auth(owner, submit(newKey, legacyBody({ description: 'A different description here' }))), 'IDEMPOTENCY_CONFLICT', 'legacy-shaped retry with changed content');
  fails(auth(owner, submit(newKey, payload({ postcode: '5251' }))), 'IDEMPOTENCY_CONFLICT', 'a different postcode under a five-key command conflicts');
  // 11c. a legacy create while the switch is open stores a command without a postcode and replays in all shapes.
  const legacyKey = randomUUID();
  const legacyCreated = JSON.parse(sql(auth(owner, submit(legacyKey, legacyBody()))).split('\n')[0]); persisted += 1;
  equal([legacyCreated.replayed, Object.keys(legacyCreated.request).includes('postcode')], [false, false], 'legacy create works while the switch is open');
  equal(sql(`select payload ? 'postcode' from public.care_request_commands where idempotency_key = ${quote(legacyKey)}::uuid`), 'f', 'the stored command has no invented postcode');
  const legacyReplay = JSON.parse(sql(auth(owner, submit(legacyKey, payload({ postcode: outside[0] })))).split('\n')[0]);
  equal([legacyReplay.replayed, legacyReplay.request.id], [true, legacyCreated.request.id], 'five-key replay of a legacy create');
  // 11d. the switch closes (and fails closed when its row is gone) for CREATION only; the 5-key path is unaffected.
  for (const [label, setup] of [['closed', closed], ['row missing', 'delete from public.care_service_coverage_compat;']]) {
    fails(asOwner(submit(randomUUID(), legacyBody()), setup), 'VALIDATION_FAILED', `legacy create refused: switch ${label}`);
    equal(JSON.parse(sql(asOwner(submit(randomUUID(), payload()), setup)).split('\n')[0]).replayed, false, `five-key create unaffected: switch ${label}`);
    fails(asOwner(submit(randomUUID(), payload({ postcode: outside[0] })), setup), 'OUT_OF_AREA', `five-key out of area refused: switch ${label}`);
  }
  // 11e. a legacy create is refused without leaving rows when the switch is closed, and does not wait for the vehicle lock.
  const legacyBefore = counts();
  fails(auth(owner, submit(randomUUID(), legacyBody())).replace('begin;', `begin; ${closed}`), 'VALIDATION_FAILED', 'closed switch, committed path');
  equal(counts(), legacyBefore, 'refused legacy creates leave no rows');

  // 8. Fail closed: a missing or empty list is COVERAGE_UNAVAILABLE for creation, never "covered" and never "out of area".
  const unavailable = (setup, body = payload(), expected = 'COVERAGE_UNAVAILABLE') => fails(asOwner(submit(randomUUID(), body), setup), expected, setup);
  unavailable('delete from public.care_service_coverage;');
  unavailable('delete from public.care_service_coverage_meta;');
  unavailable("delete from public.care_service_coverage where service='repair';");
  equal(JSON.parse(sql(asOwner(submit(randomUUID(), payload({}, 'cleaning')), "delete from public.care_service_coverage where service='repair';")).split('\n')[0]).replayed, false,
    'an unavailable service does not block the other one');
  unavailable('delete from public.care_service_coverage;', payload({ postcode: outside[0] }));
  equal(counts().split(',').slice(0, 4).map(Number), [0, 1, 2, 3].map(position => Number(before.split(',')[position]) + persisted), 'only the in-area creations exist (rolled-back probes left nothing)');

  // 9. No work before rejection: an out-of-area request does not wait for the vehicle lock;
  //    the same request in area does (so this proves the check precedes the lock).
  const tag = `cov-holder-${randomUUID()}`;
  const holder = result(`begin; /* ${tag} */ select 1 from public.vehicles where id=${quote(vehicle.id)}::uuid for update; select pg_sleep(4); commit;`);
  for (let attempt = 0; attempt < 150; attempt++) {
    if (sql(`select count(*) from pg_stat_activity where query like ${quote(`%${tag}%`)} and wait_event='PgSleep'`) === '1') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const lockedOut = await result(asOwner(submit(randomUUID(), payload({ postcode: outside[0] })), "set local lock_timeout='400ms';"));
  assert.match(lockedOut.output, /OUT_OF_AREA/); assert.doesNotMatch(lockedOut.output, /lock timeout/); checks += 2;
  const lockedIn = await result(asOwner(submit(randomUUID(), payload()), "set local lock_timeout='400ms';"));
  assert.match(lockedIn.output, /lock timeout/); checks += 1;
  assert.equal((await holder).error, undefined); checks += 1;

  // 10. Guest bypass attempts (service_role is how the app and any leaked key reach the guest function).
  const guest = (overrides = {}, key = randomUUID(), fingerprint = 'a'.repeat(64)) => ({
    key, sql: `begin; set local role service_role; select public.care_submit_guest_request(${quote(key)}::uuid, ${quote(JSON.stringify({
      name: 'Guest Tester', email: 'coverage-guest@example.com', phone: '0400 000 001', suburb: 'Adelaide', postcode: covered, vehicle: 'Toyota Corolla 2020',
      service: 'repair', description: 'Visible scratch on the rear bumper', preferred_window: 'flexible', consent: true, ...overrides,
    }))}::jsonb, ${quote(fingerprint)}); commit;`,
  });
  const guestBefore = counts();
  for (const code of outside) for (const service of ['repair', 'cleaning']) fails(guest({ postcode: code, service }).sql, 'OUT_OF_AREA', `guest ${service} ${code}`);
  equal(counts(), guestBefore, 'guest rejections store nothing');
  for (let attempt = 0; attempt < 12; attempt++) fails(guest({ postcode: outside[1] }).sql, 'OUT_OF_AREA', 'a rejected guest never consumes the rate limit');
  equal(counts(), guestBefore, 'repeated rejections still store nothing');
  fails(guest({ postcode: '500' }).sql, 'VALIDATION_FAILED');
  // The decision comes before the rate limits: a rejected request reports OUT_OF_AREA even when
  // the sender is already at a limit, and never uses up a limit itself.
  const guestKey = randomUUID();
  const guestCreated = JSON.parse(sql(guest({}, guestKey).sql).split('\n')[0]);
  equal(guestCreated.stage, 'request_received', 'in-area guest request is stored');
  equal(JSON.parse(sql(guest({}, guestKey).sql).split('\n')[0]).id, guestCreated.id, 'guest replay returns the same request');
  fails(guest({ postcode: outside[0] }, guestKey).sql, 'IDEMPOTENCY_CONFLICT', 'same guest key, different postcode');
  fails(`begin; delete from public.care_service_coverage; ${guest().sql.replace('begin;', '')}`, 'COVERAGE_UNAVAILABLE', 'guest fails closed with an empty list');
  fails(`begin; delete from public.care_service_coverage_meta; ${guest().sql.replace('begin;', '')}`, 'COVERAGE_UNAVAILABLE', 'guest fails closed without metadata');
  equal(sql(`begin; delete from public.care_service_coverage; ${guest({}, guestKey).sql.replace('begin;', '').replace('commit;', 'rollback;')}`).includes(guestCreated.id), true, 'guest replay works while the list is unavailable');
  for (let stored = 0; stored < 2; stored++) equal(JSON.parse(sql(guest().sql).split('\n')[0]).stage, 'request_received', 'second and third in-area requests for this email');
  fails(guest().sql, 'RATE_LIMITED', 'the email is now at its daily limit');
  fails(guest({ postcode: outside[0] }).sql, 'OUT_OF_AREA', 'out-of-area is decided before the rate limit');
  equal(sql("select count(*) from public.care_guest_requests where payload->>'email'='coverage-guest@example.com'"), '3', 'only the three in-area guest requests exist');

  console.log(`PASS: ${checks} server-side coverage enforcement assertions (authenticated and guest bypass, replay, fail-closed, lock order; disposable database).`);
}
