import assert from 'node:assert/strict';
import { LEGACY_CAP as CAP, LEGACY_OPEN_AT, LEGACY_BEFORE_CAP, LEGACY_AFTER_CAP, installLegacySunsetTestClock } from './legacy-sunset-test-clock.mjs';
import { randomUUID } from 'node:crypto';
import data from '../../src/server/care/coverage-areas.json' with { type: 'json' };
import { buildCoverageIndex } from '../../src/server/care/coverage-resolver.ts';

// Server-side service-area enforcement (migration 20261101160000 plus the legacy-create
// sunset 20261108120000). proveLegacyBypassThenSunset runs first, on 160000 alone, and
// applies the sunset. The coverage probes use the installed functions as API roles,
// with only the two sunset decision clock expressions temporarily instrumented.
// The UI and /api/v1/care/coverage are bypassed entirely.
// The real predicate, hard cap, grants, lock order and snapshots remain in use.

export function proveLegacyBypassThenSunset({ database, sql, auth, quote, garageCreate, file }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const fails = (statement, expected, label = expected) => {
    assert.throws(() => sql(statement), error => `${error.message}\n${error.stderr ?? ''}`.includes(expected), label);
    checks += 1;
  };
  const index = buildCoverageIndex(data);
  assert.equal(index.get('repair').has('5000'), true);
  assert.equal(index.get('repair').has('5290'), false);
  const owner = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Legacy bypass');
  const legacy = JSON.stringify({
    vehicle_id: vehicle.id, service: 'repair', description: 'Scratch on rear bumper', preferred_window: 'flexible',
  });
  const withPostcode = postcode => JSON.stringify({
    vehicle_id: vehicle.id, service: 'repair', description: 'Scratch on rear bumper', preferred_window: 'flexible', postcode,
  });
  const submit = (key, body) => `select public.care_submit_request(${quote(key)}::uuid, ${quote(body)}::jsonb)`;
  const asOwner = (statement, setup = '') => `begin; ${setup} set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; ${statement}; rollback;`;

  equal(sql("select to_regclass('public.care_legacy_create_audit') is null"), 't', 'pre-fix has no legacy-create audit');
  equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='care_service_coverage_compat' and column_name='legacy_create_deadline'"), '0', 'pre-fix has no deadline');
  equal(sql('select accept_legacy_create from public.care_service_coverage_compat'), 't', 'pre-fix boolean stays open');
  equal(sql("select position('care_legacy_create_open' in pg_get_functiondef('public.care_submit_request(uuid,jsonb)'::regprocedure)) = 0"), 't', 'pre-fix submit cannot expire a legacy create');
  const key = randomUUID();
  const created = JSON.parse(sql(auth(owner, submit(key, legacy))).split('\n')[0]);
  equal([created.replayed, Object.keys(created.request).includes('postcode')], [false, false], 'pre-fix legacy create bypasses the area check');
  equal(sql(`select payload ? 'postcode' from public.care_request_commands where idempotency_key = ${quote(key)}::uuid`), 'f', 'pre-fix stores no invented postcode');
  fails(auth(owner, submit(randomUUID(), withPostcode('5290'))), 'OUT_OF_AREA', 'pre-fix still rejects a present out-of-area postcode');

  file('supabase/migrations/20261108120000_care_legacy_create_sunset.sql');
  const clock = installLegacySunsetTestClock({ database, sql, quote });
  try {
    const pastDeadline = `update public.care_service_coverage_compat set legacy_create_deadline = least(${clock.now} - interval '1 microsecond', timestamptz ${quote(CAP)});`;

    const replay = JSON.parse(sql(auth(owner, submit(key, legacy))).split('\n')[0]);
    equal([replay.replayed, replay.request.id], [true, created.request.id], 'the pre-fix create replays after the sunset migration');
    equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'a create from before the sunset migration is not backfilled');
    equal(sql(`select (timestamptz '2026-11-22 00:00:00 Australia/Adelaide') = timestamptz ${quote(CAP)}`), 't', 'Adelaide midnight is 2026-11-21T13:30:00Z');
    equal(sql(`select legacy_create_deadline = timestamptz ${quote(CAP)} and accept_legacy_create from public.care_service_coverage_compat`), 't', 'the boolean stays true and the deadline is the cap');
    equal(sql(`select public.care_legacy_create_open(timestamptz ${quote(CAP)} - interval '1 microsecond')`), 't', 'one microsecond before the cap is open');
    equal(sql(`select public.care_legacy_create_open(timestamptz ${quote(CAP)})`), 'f', 'the cap instant is closed');
    equal(sql(`select public.care_legacy_create_open(timestamptz ${quote(CAP)} + interval '1 microsecond')`), 'f', 'after the cap is closed');
    equal(sql('select public.care_legacy_create_open(null)'), 'f', 'a null clock fails closed');
    fails(asOwner(submit(randomUUID(), legacy), pastDeadline), 'VALIDATION_FAILED', 'the same legacy create fails closed once the deadline is in the past');
    equal(JSON.parse(sql(asOwner(submit(key, legacy), pastDeadline)).split('\n')[0]).request.id, created.request.id, 'expiry does not turn a replay into a rejection');
    equal(JSON.parse(sql(asOwner(submit(randomUUID(), withPostcode('5000')), pastDeadline)).split('\n')[0]).replayed, false, 'a past deadline does not block an in-area postcode');
    fails(asOwner(submit(randomUUID(), withPostcode('5290')), pastDeadline), 'OUT_OF_AREA', 'a past deadline does not skip an out-of-area postcode');
    equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'expired and rolled-back probes do not count');
    equal(sql(`select legacy_create_deadline = timestamptz ${quote(CAP)} from public.care_service_coverage_compat`), 't', 'deadline probes roll back to the cap');
    fails(`begin; update public.care_service_coverage_compat set legacy_create_deadline = timestamptz ${quote(CAP)} + interval '1 microsecond'; commit;`, 'care_service_coverage_compat_deadline_cap', 'the deadline cannot be extended past the cap');
    equal(sql(`select legacy_create_deadline = timestamptz ${quote(CAP)} from public.care_service_coverage_compat`), 't', 'a rejected extension leaves the cap in place');
    clock.set(LEGACY_BEFORE_CAP);
    {
      const rolled = JSON.parse(sql(asOwner(submit(randomUUID(), legacy))).split('\n')[0]);
      equal(rolled.replayed, false, 'before the cap a legacy create still succeeds inside its transaction');
      equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'rolling that create back leaves the count unchanged');
    }
    for (const at of [CAP, LEGACY_AFTER_CAP]) {
      clock.set(at);
      fails(asOwner(submit(randomUUID(), legacy)), 'VALIDATION_FAILED', `legacy create is closed at ${at}`);
      equal(JSON.parse(sql(asOwner(submit(key, legacy))).split('\n')[0]).request.id, created.request.id, `legacy replay survives ${at}`);
      equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'boundary probes leave no telemetry');
    }
  } finally { clock.restore(); }
  console.log(`PASS: ${checks} legacy-create proofs (pre-fix bypass without a deadline, then fail-closed expiry, replay, boundary and cap).`);
}

// Two sessions. One holds the audit singleton across a deadline and across an
// early-close. The creator must already be waiting on that row before the
// change, then fail closed with no count. A postcode create must not take the lock.
export async function verifyLegacyAuditLockWait({ sql, quote, garageCreate, result, clock }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const owner = randomUUID();
  sql(`insert into auth.users(id) values (${quote(owner)});`);
  const vehicle = garageCreate(owner, randomUUID(), 'Audit wait');
  const other = garageCreate(owner, randomUUID(), 'Audit wait other');
  const legacy = JSON.stringify({
    vehicle_id: vehicle.id, service: 'repair', description: 'Scratch on rear bumper', preferred_window: 'flexible',
  });
  const five = JSON.stringify({
    vehicle_id: other.id, service: 'repair', description: 'Scratch on rear bumper', preferred_window: 'flexible', postcode: '5000',
  });
  const count = () => sql('select create_count from public.care_legacy_create_audit');
  const restore = () => sql(`update public.care_service_coverage_compat set accept_legacy_create = true, legacy_create_deadline = timestamptz ${quote(CAP)}`);
  const sleeping = tag => sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and query like ${quote(`%${tag}%`)} and wait_event = 'PgSleep'`);
  const locking = tag => sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and query like ${quote(`%${tag}%`)} and wait_event_type = 'Lock'`);
  const until = async (predicate, label) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(label);
  };
  const refused = (outcome, label) => {
    assert.equal(outcome.error !== undefined, true, label);
    assert.match(outcome.output, /VALIDATION_FAILED/, label);
    assert.doesNotMatch(outcome.output, /"replayed"/, label);
    checks += 1;
  };

  const pending = [];
  const start = statement => { const promise = result(statement); pending.push(promise); return promise; };
  const traces = () => sql(`select (select count(*) from public.care_requests)||','||(select count(*) from public.care_request_commands)
    ||','||(select count(*) from public.care_request_events)||','||(select count(*) from public.care_notification_outbox)
    ||','||(select count(*) from public.audit_events)`);
  try {
    // First exercise an earlier stored deadline, then the real immutable hard cap.
    // Advance only once pg_stat_activity proves the creator reached the audit lock.
    for (const [label, deadline] of [['stored deadline', '2026-11-20 14:00:00+00'], ['hard cap', CAP]]) {
      restore();
      clock.set(LEGACY_OPEN_AT);
      sql(`update public.care_service_coverage_compat set legacy_create_deadline = timestamptz ${quote(deadline)}`);
      const holdCap = `hold-cap-${randomUUID()}`;
      const holderCap = start(`begin; select 1 from public.care_legacy_create_audit where singleton for update; select pg_sleep(8), ${quote(holdCap)}; commit;`);
      await until(() => sleeping(holdCap) === '1', `${label} holder did not keep the audit row`);
      const beforeCap = count();
      const beforeTraces = traces();
      const waitCap = `wait-cap-${randomUUID()}`;
      const keyCap = randomUUID();
      const blockedCap = start(`begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; select public.care_submit_request(${quote(keyCap)}::uuid, ${quote(legacy)}::jsonb), ${quote(waitCap)}; rollback;`);
      await until(() => locking(waitCap) === '1', `creator did not wait on the audit row before ${label}`);
      clock.set(deadline);
      equal(sql(`select ${clock.now} = timestamptz ${quote(deadline)}`), 't', `controlled clock reaches exact ${label}`);
      equal(sleeping(holdCap), '1', `the audit row is still held at ${label}`);
      assert.equal((await holderCap).error, undefined);
      refused(await blockedCap, `waiting across ${label} fails closed`);
      equal(count(), beforeCap, `a create that waited across ${label} is not counted`);
      equal(traces(), beforeTraces, `${label} rejection rolls back request, command, event, outbox and audit rows`);
      equal(sql(`select count(*) from public.care_request_commands where idempotency_key = ${quote(keyCap)}::uuid`), '0', 'that create stored no command');
    }

    restore();
    clock.set(LEGACY_OPEN_AT);
    const holdClose = `hold-close-${randomUUID()}`;
    const holderClose = start(`begin; select 1 from public.care_legacy_create_audit where singleton for update; select pg_sleep(5), ${quote(holdClose)}; commit;`);
    await until(() => sleeping(holdClose) === '1', 'early-close holder did not keep the audit row');
    const waitClose = `wait-close-${randomUUID()}`;
    const keyClose = randomUUID();
    const blockedClose = start(`begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; select public.care_submit_request(${quote(keyClose)}::uuid, ${quote(legacy)}::jsonb), ${quote(waitClose)}; rollback;`);
    await until(() => locking(waitClose) === '1', 'creator did not wait before the early-close');
    const fiveStarted = Date.now();
    const fiveCreated = JSON.parse(sql(`begin; set local statement_timeout = '1000ms'; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; select public.care_submit_request(${quote(randomUUID())}::uuid, ${quote(five)}::jsonb); commit;`).split('\n')[0]);
    equal(fiveCreated.replayed, false, 'a postcode create does not take the legacy audit lock');
    assert.ok(Date.now() - fiveStarted < 1000, 'the postcode create did not wait out the audit holder');
    checks += 1;
    const closeStarted = Date.now();
    // The unchanged STABLE predicate must see this independently committed update
    // from its new post-lock SQL statement, not the creator's earlier snapshot.
    sql('update public.care_service_coverage_compat set accept_legacy_create = false');
    assert.ok(Date.now() - closeStarted < 1000, 'early-close does not wait on the audit row');
    checks += 1;
    equal(sleeping(holdClose), '1', 'early-close finished while the audit row was still held');
    const beforeClose = count();
    assert.equal((await holderClose).error, undefined);
    refused(await blockedClose, 'an early-close that commits during the audit wait fails the waiter closed');
    equal(count(), beforeClose, 'early-close during the wait does not count');
    equal(sql(`select count(*) from public.care_request_commands where idempotency_key = ${quote(keyClose)}::uuid`), '0', 'the early-closed create stored no command');
  } finally {
    // Do not restore the function/clock while a failed probe still has a session.
    await Promise.all(pending);
    restore();
    clock.set(LEGACY_OPEN_AT);
  }
  equal(sql(`select accept_legacy_create::text || ',' || (legacy_create_deadline = timestamptz ${quote(CAP)})::text from public.care_service_coverage_compat`), 'true,true', 'the wait regression restores the cap and the boolean');
  console.log(`PASS: ${checks} legacy-create audit-lock regressions (stored deadline and hard cap crossed while waiting, committed early-close visible after waiting, postcode create does not take that lock).`);
}

export async function verifyCoverageEnforcement(context) {
  const clock = installLegacySunsetTestClock(context);
  try { await verifyCoverageWithClock({ ...context, clock }); }
  finally { clock.restore(); }
}

async function verifyCoverageWithClock({ sql, auth, quote, garageCreate, result, clock }) {
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
  equal(sql("select position('care_legacy_create_open' in pg_get_functiondef('public.care_submit_request(uuid,jsonb)'::regprocedure)) > 0"), 't', 'the sunset migration replaced care_submit_request');
  equal(sql("select position('care_legacy_create_open(sampled.at)' in pg_get_functiondef('public.care_submit_request(uuid,jsonb)'::regprocedure)) > 0"), 't', 'the installed increment rechecks the clock after the locks');
  equal(sql(`select public.care_legacy_create_open(timestamptz ${quote(CAP)})`), 'f', 'installed predicate is closed at the cap');
  await verifyLegacyAuditLockWait({ sql, quote, garageCreate, result, clock });

  // 1. One list: the table is the JSON, not a second copy that can drift.
  const rows = sql('select service||\':\'||postcode from public.care_service_coverage order by 1').split('\n');
  const expectedRows = [...index].flatMap(([service, codes]) => [...codes].map(code => `${service}:${code}`)).sort();
  equal(rows, expectedRows, 'database coverage rows equal the JSON-derived index');
  equal(sql('select area_id||\'|\'||version||\'|\'||(select count(*) from public.care_service_coverage_meta) from public.care_service_coverage_meta'), `${data.areaId}|${data.version}|1`, 'metadata identifies the same area and version');

  // 2. Nobody can read or edit the list over the API; only the definer functions read it.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    fails(`begin; set local role ${role}; select ${clock.now}`, 'permission denied', `${role} cannot call the test clock`);
    fails(`begin; set local role ${role}; update legacy_sunset_test.clock set at = timestamptz ${quote(LEGACY_OPEN_AT)}`, 'permission denied', `${role} cannot control the test clock`);
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
  let legacyCreates = 0;
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
  //     - creates only while care_legacy_create_open(clock) is true (boolean still true, clock strictly before the cap);
  //     - never makes the 5-key path weaker: a postcode that is present is always checked.
  equal(sql('select accept_legacy_create from public.care_service_coverage_compat'), 't', 'the boolean stays true; the cap is what closes the window');
  equal(sql(`select legacy_create_deadline = timestamptz ${quote(CAP)} from public.care_service_coverage_compat`), 't', 'the stored deadline is the cap');
  equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'postcode creates are not legacy telemetry');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    fails(`begin; set local role ${role}; select * from public.care_service_coverage_compat`, 'permission denied');
    fails(`begin; set local role ${role}; update public.care_service_coverage_compat set accept_legacy_create = false`, 'permission denied');
    fails(`begin; set local role ${role}; update public.care_service_coverage_compat set legacy_create_deadline = timestamptz ${quote(CAP)} - interval '1 day'`, 'permission denied', `${role} cannot move the deadline`);
    fails(`begin; set local role ${role}; select * from public.care_legacy_create_audit`, 'permission denied', `${role} cannot read legacy telemetry`);
    fails(`begin; set local role ${role}; update public.care_legacy_create_audit set create_count = create_count + 1`, 'permission denied', `${role} cannot write legacy telemetry`);
    fails(`begin; set local role ${role}; select public.care_legacy_create_open(clock_timestamp())`, 'permission denied', `${role} cannot call the legacy-create predicate`);
  }
  equal(sql("select relrowsecurity from pg_class where oid = 'public.care_service_coverage_compat'::regclass"), 't', 'RLS enabled on the switch');
  equal(sql("select relrowsecurity::text || ',' || relforcerowsecurity::text from pg_class where oid = 'public.care_legacy_create_audit'::regclass"), 'true,false', 'audit RLS is on and not forced');
  equal(sql("select count(*) from information_schema.role_table_grants where table_name='care_legacy_create_audit' and grantee in ('PUBLIC','public','anon','authenticated','service_role')"), '0', 'no API role is granted the audit table');
  equal(sql("select count(*) from pg_class where relname like 'care_legacy_create_audit%' and relkind = 'S'"), '0', 'the counter has no sequence');
  equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('care_legacy_create_open','care_legacy_create_audit_guard') and p.proconfig @> array['search_path=\"\"']"), '2', 'sunset functions keep an empty search_path');
  equal(sql("select prosecdef::text from pg_proc where proname='care_legacy_create_open'"), 'true', 'the predicate is definer so it can read the revoked switch');
  equal(sql("select prosecdef::text from pg_proc where proname='care_legacy_create_audit_guard'"), 'false', 'the audit guard is not a definer RPC');
  fails('begin; update public.care_legacy_create_audit set create_count = 0; commit;', 'LEGACY_CREATE_AUDIT_TAMPER', 'a privileged update cannot reset the count');
  fails('begin; delete from public.care_legacy_create_audit; commit;', 'LEGACY_CREATE_AUDIT_TAMPER', 'the audit row cannot be deleted');
  fails('begin; truncate public.care_legacy_create_audit; commit;', 'LEGACY_CREATE_AUDIT_TAMPER', 'the audit row cannot be truncated');
  equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'rejected tamper leaves the zero row');
  fails(`begin; alter table public.care_legacy_create_audit disable trigger care_legacy_create_audit_guard; delete from public.care_legacy_create_audit; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; ${submit(randomUUID(), legacyBody())}; rollback;`, 'VALIDATION_FAILED', 'a missing audit row fails a legacy create closed');
  equal(JSON.parse(sql(`begin; alter table public.care_legacy_create_audit disable trigger care_legacy_create_audit_guard; delete from public.care_legacy_create_audit; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)}; ${submit(randomUUID(), payload())}; rollback;`).split('\n')[0]).replayed, false, 'a postcode create does not need the audit row');
  equal([sql('select count(*) from public.care_legacy_create_audit'), sql('select create_count from public.care_legacy_create_audit')], ['1', '0'], 'the missing-row probe rolls back the audit row');
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
  const pastDeadline = `update public.care_service_coverage_compat set legacy_create_deadline = least(${clock.now} - interval '1 microsecond', timestamptz ${quote(CAP)});`;
  fails(asOwner(submit(randomUUID(), legacyBody()), pastDeadline), 'VALIDATION_FAILED', 'legacy create fails closed when the deadline is already past');
  equal(sql('select create_count from public.care_legacy_create_audit'), '0', 'an expired legacy create is not counted');
  equal(sql(`select legacy_create_deadline = timestamptz ${quote(CAP)} from public.care_service_coverage_compat`), 't', 'the past-deadline probe rolls back');
  // 11c. Before the cap, and only then, a legacy create still stores a command without a postcode.
  // The boolean is not sufficient once the clock reaches the cap.
  clock.set(LEGACY_BEFORE_CAP);
  {
    const legacyKey = randomUUID();
    const legacyCreated = JSON.parse(sql(auth(owner, submit(legacyKey, legacyBody()))).split('\n')[0]); persisted += 1;
    equal([legacyCreated.replayed, Object.keys(legacyCreated.request).includes('postcode')], [false, false], 'legacy create works before the cap');
    equal(sql(`select payload ? 'postcode' from public.care_request_commands where idempotency_key = ${quote(legacyKey)}::uuid`), 'f', 'the stored command has no invented postcode');
    const legacyReplay = JSON.parse(sql(auth(owner, submit(legacyKey, payload({ postcode: outside[0] })))).split('\n')[0]);
    equal([legacyReplay.replayed, legacyReplay.request.id], [true, legacyCreated.request.id], 'five-key replay of a legacy create');
    equal(sql('select create_count from public.care_legacy_create_audit'), '1', 'that committed legacy create is counted once');
    equal(JSON.parse(sql(auth(owner, submit(legacyKey, legacyBody()))).split('\n')[0]).replayed, true, 'legacy replay after the count');
    equal(sql('select create_count from public.care_legacy_create_audit'), '1', 'replay does not count again');
    legacyCreates = 1;
  }
  for (const at of [CAP, LEGACY_AFTER_CAP]) {
    clock.set(at);
    fails(auth(owner, submit(randomUUID(), legacyBody())), 'VALIDATION_FAILED', `a true boolean does not allow a legacy create at ${at}`);
    equal(sql('select create_count from public.care_legacy_create_audit'), '1', 'the expired create is not counted');
    equal(JSON.parse(sql(asOwner(submit(oldKey, legacyBody()))).split('\n')[0]).replayed, true, 'legacy replay survives the cap');
    equal(JSON.parse(sql(asOwner(submit(randomUUID(), payload()))).split('\n')[0]).replayed, false, 'postcode create survives the cap');
    fails(asOwner(submit(randomUUID(), payload({ postcode: outside[0] }))), 'OUT_OF_AREA', 'postcode coverage still applies after the cap');
  }
  clock.set(LEGACY_BEFORE_CAP);
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
  equal(sql('select create_count from public.care_legacy_create_audit'), String(legacyCreates), 'a refused legacy create does not change the count');

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
  const lockedLegacy = await result(asOwner(submit(randomUUID(), legacyBody()), `update public.care_service_coverage_compat set legacy_create_deadline = least(${clock.now} - interval '1 microsecond', timestamptz ${quote(CAP)}); set local lock_timeout='400ms';`));
  assert.match(lockedLegacy.output, /VALIDATION_FAILED/); assert.doesNotMatch(lockedLegacy.output, /lock timeout/); checks += 2;
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
  equal(sql('select create_count from public.care_legacy_create_audit'), String(legacyCreates), 'guest intake does not change legacy telemetry');

  console.log(`PASS: ${checks} server-side coverage enforcement assertions (authenticated and guest bypass, legacy-create expiry, telemetry, replay, fail-closed, lock order; disposable database).`);
}
