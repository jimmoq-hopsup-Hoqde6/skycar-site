import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 20261101133000_revoke_public_sequence_grants.sql on a disposable database:
// no anon/authenticated/PUBLIC privilege on any public sequence, service_role identity inserts still work.
export function verifySequenceGrantRevoke({ sql, quote }) {
  let checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const migration = 'supabase/migrations/20261101133000_revoke_public_sequence_grants.sql';

  // Catch-all over every sequence that exists, so a future identity/serial column is covered too.
  const sequences = sql(`select string_agg(relname, ',' order by relname) from pg_class where relkind='S' and relnamespace='public'::regnamespace`).split(',');
  assert.ok(sequences.includes('audit_events_id_seq') && sequences.includes('care_journey_events_id_seq'), `expected sequences, got ${sequences}`); checks += 1;
  const roleGrants = `select string_agg(c.relname||':'||coalesce(r.rolname,'PUBLIC')||':'||a.privilege_type, ',' order by c.relname, r.rolname, a.privilege_type)
    from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
    left join pg_roles r on r.oid = a.grantee
    where c.relkind='S' and c.relnamespace='public'::regnamespace`;
  const grants = sql(roleGrants).split(',');
  equal(grants.filter(grant => /:(anon|authenticated|PUBLIC):/.test(grant)), [], 'no anon, authenticated or PUBLIC ACL entry on any public sequence');
  for (const sequence of sequences) {
    for (const role of ['anon', 'authenticated']) {
      equal(sql(`select has_sequence_privilege(${quote(role)}, ${quote(`public.${sequence}`)}, 'USAGE') or has_sequence_privilege(${quote(role)}, ${quote(`public.${sequence}`)}, 'SELECT') or has_sequence_privilege(${quote(role)}, ${quote(`public.${sequence}`)}, 'UPDATE')`), 'f', `${role} has no privilege on ${sequence}`);
    }
    equal(sql(`select has_sequence_privilege('service_role', ${quote(`public.${sequence}`)}, 'USAGE') and has_sequence_privilege('service_role', ${quote(`public.${sequence}`)}, 'SELECT')`), 't', `service_role keeps USAGE and SELECT on ${sequence}`);
  }
  // A browser role cannot move an identity sequence.
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => sql(`begin; set local role ${role}; select setval('public.audit_events_id_seq', 1); commit`), error => /permission denied for sequence/.test(`${error.stderr}`)); checks += 1;
    assert.throws(() => sql(`begin; set local role ${role}; select nextval('public.care_journey_events_id_seq'); commit`), error => /permission denied for sequence/.test(`${error.stderr}`)); checks += 1;
  }

  // service_role identity inserts: normal path, and with every service_role sequence privilege stripped (identity columns need none).
  const insertAudit = `insert into public.audit_events(action, resource_type, resource_id) values ('test.sequence_grant', 'sequence', 'audit_events_id_seq') returning id`;
  const user = randomUUID(), vehicle = randomUUID(), request = randomUUID();
  const fixture = `insert into auth.users(id) values (${quote(user)});
    insert into public.vehicles(id, owner_id, make, model, year) values (${quote(vehicle)}, ${quote(user)}, 'Toyota', 'Sequence', 2020);
    insert into public.care_requests(id, customer_id, vehicle_id, service, description, preferred_window, next_update_at, escalation_minutes)
      values (${quote(request)}, ${quote(user)}, ${quote(vehicle)}, 'repair', 'Synthetic sequence fixture', 'flexible', clock_timestamp() + interval '1 hour', 30);
    insert into public.care_journeys(id, account_request_id, customer_details, state) values (${quote(request)}, ${quote(request)}, '{"postcode":"5000"}', 'booking_requested')`;
  sql(fixture);
  const insertEvent = `insert into public.care_journey_events(journey_id, type) values (${quote(request)}, 'details_updated') returning id`;
  const asService = statement => sql(`begin; set local role service_role; ${statement}; commit`).split('\n')[0];
  assert.match(asService(insertAudit), /^\d+$/); checks += 1;
  assert.match(asService(insertEvent), /^\d+$/); checks += 1;
  const stripped = statement => sql(`begin; revoke all on sequence public.audit_events_id_seq, public.care_journey_events_id_seq from service_role; set local role service_role; ${statement}; rollback`).split('\n')[0];
  assert.match(stripped(insertAudit), /^\d+$/, 'audit_events insert needs no sequence privilege'); checks += 1;
  assert.match(stripped(insertEvent), /^\d+$/, 'care_journey_events insert needs no sequence privilege'); checks += 1;
  // Browser roles still cannot write those tables at all.
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => sql(`begin; set local role ${role}; ${insertAudit}; commit`), error => /permission denied/.test(`${error.stderr}`)); checks += 1;
  }

  // Future sequences created by the migration role start without browser-role privileges.
  equal(sql(`begin; create sequence public.zz_future_seq; select coalesce(string_agg(coalesce(r.rolname,'PUBLIC'), ','), 'none') from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a left join pg_roles r on r.oid=a.grantee where c.relname='zz_future_seq' and coalesce(r.rolname,'PUBLIC') in ('anon','authenticated','PUBLIC'); rollback`).split('\n').find(line => !/^(BEGIN|CREATE|ROLLBACK)/.test(line)), 'none', 'new sequence in public has no anon/authenticated/PUBLIC privilege');

  // Re-applying is a no-op (the migration is idempotent, so a replay cannot break a rebuilt database).
  execFileSync('psql', [process.env.GARAGE_CARE_TEST_DATABASE_URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', migration], { encoding: 'utf8' });
  equal(sql(roleGrants).split(',').filter(grant => /:(anon|authenticated|PUBLIC):/.test(grant)), [], 'still no browser-role privilege after re-applying');
  assert.ok(!/^\s*(grant|revoke)[^;]*\bservice_role\b[^;]*\bupdate\b/im.test(readFileSync(migration, 'utf8').replace(/--.*$/gm, ''))); checks += 1;
  console.log(`PASS: ${checks} sequence grant assertions: no anon/authenticated/PUBLIC privilege on any public sequence, service_role identity inserts intact (disposable database).`);
}
