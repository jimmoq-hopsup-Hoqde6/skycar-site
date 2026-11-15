import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyTechnicianAvailability({ sql, quote, result, waitForQuery }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const run = statement => Promise.resolve().then(() => sql(statement));
  const json = async statement => JSON.parse((await run(statement)).split('\n')[0]);
  const fail = async (statement, code) => {
    await assert.rejects(() => run(statement), error => `${error.message}\n${error.stderr || ''}`.includes(code), code);
    checks += 1;
  };
  const service = statement => `begin; set local role service_role; ${statement}; commit;`;
  const auth = (actor, statement) => `begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(actor)}; ${statement}; commit;`;
  const tech = randomUUID();
  const customer = randomUUID();
  const expert = randomUUID();
  const guest = randomUUID();
  const journeyStarts = '2030-01-02T00:00:00Z';
  const journeyEnds = '2030-01-02T02:00:00Z';
  await run(`insert into auth.users(id) values (${quote(tech)}),(${quote(customer)});
    insert into public.user_roles(user_id, role) values (${quote(tech)},'technician');
    insert into public.care_experts(id, business_name, description, services, postcodes, insurance_valid_until)
      values (${quote(expert)},'Synthetic expert','Disposable availability fixture',array['repair'],array['5000'],'2030-12-31');
    insert into public.care_technician_accounts(expert_id, user_id) values (${quote(expert)},${quote(tech)});
    insert into public.care_guest_requests(id, idempotency_key, fingerprint, payload) values (${quote(guest)}, gen_random_uuid(), ${quote('b'.repeat(64))},
      '{"name":"Synthetic","email":"synthetic@example.test","phone":"0400000000","suburb":"Adelaide","postcode":"5000","vehicle":"Toyota Corolla","service":"repair","description":"Bumper scratch","preferred_window":"flexible","consent":true}'::jsonb);
    insert into public.care_journeys(id, guest_request_id, state, expert_id, starts_at, ends_at)
      values (${quote(guest)}, ${quote(guest)}, 'scheduled', ${quote(expert)}, ${quote(journeyStarts)}, ${quote(journeyEnds)});`);
  const payload = (windows = [{ weekday: 1, starts_at: '09:00', ends_at: '17:00' }], exceptions = []) => JSON.stringify({
    timezone: 'Australia/Adelaide', weekly_windows: windows, exceptions,
  });
  const replace = (body, actor = tech, revision = 0, key = randomUUID()) => service(
    `select public.care_technician_replace_availability(${quote(actor)}::uuid, ${quote(key)}::uuid, ${revision}, ${quote(body)}::jsonb)`,
  );
  const read = (actor = tech) => service(`select public.care_technician_availability_read(${quote(actor)}::uuid)`);
  const before = await run(`select state || '|' || starts_at::text || '|' || ends_at::text from public.care_journeys where id=${quote(guest)}::uuid`);
  const journeyCommands = await run('select count(*) from public.care_journey_commands');
  await fail(auth(tech, `select public.care_technician_availability_read(${quote(tech)}::uuid)`), 'permission denied');
  await fail(auth(tech, 'select * from public.care_technician_availability'), 'permission denied');
  await fail(read(customer), 'FORBIDDEN');
  const empty = await json(read());
  equal(empty.revision, 0);
  equal(empty.timezone, 'Australia/Adelaide');
  equal(empty.weekly_windows, []);
  equal(empty.exceptions, []);
  const saveKey = randomUUID();
  equal((await json(replace(payload(), tech, 0, saveKey))).replayed, false);
  equal((await json(replace(payload(), tech, 0, saveKey))).replayed, true);
  await fail(replace(payload([{ weekday: 1, starts_at: '10:00', ends_at: '12:00' }]), tech, 0, saveKey), 'IDEMPOTENCY_CONFLICT');
  await fail(replace(payload(), tech, 0), 'REVISION_CONFLICT');
  equal((await json(read())).revision, 1);
  equal((await json(read())).weekly_windows, [{ weekday: 1, starts_at: '09:00', ends_at: '17:00' }]);
  await fail(replace(payload([{ weekday: 1, starts_at: '09:00', ends_at: '12:00' }, { weekday: 1, starts_at: '12:00', ends_at: '17:00' }]), tech, 1), 'VALIDATION_FAILED');
  await fail(replace(payload([{ weekday: 1, starts_at: '22:00', ends_at: '02:00' }]), tech, 1), 'VALIDATION_FAILED');
  const today = await run(`select (clock_timestamp() at time zone 'Australia/Adelaide')::date`);
  const absent = await run(`select d::date from generate_series(${quote(today)}::date, ${quote(today)}::date + interval '17 months', interval '1 day') d
    where not public.care_technician_availability_boundary_ok(d::date, 150, '+10:30')
      and not public.care_technician_availability_boundary_ok(d::date, 150, '+09:30') limit 1`);
  const ambiguous = await run(`select d::date from generate_series(${quote(today)}::date, ${quote(today)}::date + interval '17 months', interval '1 day') d
    where public.care_technician_availability_boundary_ok(d::date, 150, '+10:30')
      and public.care_technician_availability_boundary_ok(d::date, 150, '+09:30') limit 1`);
  assert.ok(absent && ambiguous, 'expected an Adelaide missing time and an ambiguous time inside 17 months');
  checks += 1;
  const badOffset = payload([], [{ date: absent, windows: [{ starts_at: '02:30', starts_at_offset: '+10:30', ends_at: '04:00', ends_at_offset: '+10:30' }] }]);
  await fail(replace(badOffset, tech, 1), 'VALIDATION_FAILED');
  const bothOffsets = payload([], [{ date: ambiguous, windows: [{ starts_at: '02:30', starts_at_offset: '+09:30', ends_at: '04:00', ends_at_offset: '+09:30' }] }]);
  equal((await json(replace(bothOffsets, tech, 1))).revision, 2);
  equal((await json(read())).exceptions[0].date, ambiguous);
  const closed = payload([], [{ date: today, windows: [] }]);
  equal((await json(replace(closed, tech, 2))).revision, 3);
  equal((await json(read())).weekly_windows, []);
  equal((await json(read())).exceptions, [{ date: today, windows: [] }]);
  await run(`create function public.availability_test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_AUDIT_FAILURE'; end $$;
    create trigger availability_test_audit_failure before insert on public.audit_events for each row execute function public.availability_test_audit_failure()`);
  const failedKey = randomUUID();
  await fail(replace(payload(), tech, 3, failedKey), 'SYNTHETIC_AUDIT_FAILURE');
  equal(await run(`select count(*) from public.care_technician_availability_commands where idempotency_key=${quote(failedKey)}::uuid`), '0');
  equal(await run(`select revision::text from public.care_technician_availability where expert_id=${quote(expert)}::uuid`), '3');
  await run('drop trigger availability_test_audit_failure on public.audit_events; drop function public.availability_test_audit_failure()');
  const tag = 'availability_does_not_wait_on_journey_lock';
  const held = result(`begin; select id from public.care_journeys where id=${quote(guest)}::uuid for update; select pg_sleep(2); /* ${tag} */ commit;`);
  await waitForQuery(tag);
  const started = Date.now();
  const duringLock = await result(replace(payload(), tech, 3));
  const elapsed = Date.now() - started;
  assert.equal(duringLock.error, undefined, duringLock.output);
  assert.ok(elapsed < 1500, `availability waited on the journey lock for ${elapsed}ms`);
  checks += 2;
  await held;
  equal(await run(`select state || '|' || starts_at::text || '|' || ends_at::text from public.care_journeys where id=${quote(guest)}::uuid`), before, 'schedule writes do not change the booking');
  equal(await run('select count(*) from public.care_journey_commands'), journeyCommands, 'schedule writes do not append journey commands');
  await run(`update public.care_technician_accounts set active=false where expert_id=${quote(expert)}::uuid`);
  await fail(read(), 'NOT_FOUND');
  console.log(`PASS: ${checks} technician availability permission, revision, DST and booking-lock isolation assertions (disposable database).`);
}
