import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// 20261101140000_revoke_supabase_admin_sequence_default_acl.sql on a disposable database.
// Simulates a hosted project (supabase_admin with default grants to anon/authenticated) and
// checks the revoke, the loud failure without rights, the local no-supabase_admin skip, the
// post-condition assertions and idempotency. Creates and removes the cluster roles it needs.
export function verifySupabaseAdminSequenceDefaultAcl({ sql, quote }) {
  let checks = 0;
  const ok = (value, label) => { assert.ok(value, label); checks += 1; };
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const migration = 'supabase/migrations/20261101140000_revoke_supabase_admin_sequence_default_acl.sql';
  const database = process.env.GARAGE_CARE_TEST_DATABASE_URL;

  // Apply the migration file in one psql session, optionally after SET ROLE. Returns status and output.
  const apply = role => {
    const result = spawnSync('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', ...(role ? ['-c', `set role ${role}`] : []), '-f', migration], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  };
  const grantee = `case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end`;
  const browserGrantee = `(a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))`;
  const agg = (value, from) => sql(`select coalesce(string_agg(v, ${quote(from.sep ?? ',')} order by v), 'none') from (select ${value} as v ${from.sql}) t`);
  const defaultAcls = who => agg(`${grantee}||':'||a.privilege_type`, { sql: `from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
    where d.defaclobjtype='S' and d.defaclnamespace='public'::regnamespace and pg_get_userbyid(d.defaclrole)=${quote(who)} and ${browserGrantee}` });
  const snapshot = () => agg(`pg_get_userbyid(defaclrole)||':'||defaclnamespace::regnamespace::text||':'||defaclobjtype::text||':'||defaclacl::text`, { sep: '|', sql: 'from pg_default_acl' });
  const sequenceAcl = name => agg(`${grantee}||':'||a.privilege_type`, { sql: `from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
    where c.relname=${quote(name)} and c.relnamespace='public'::regnamespace and ${browserGrantee}` });
  const simulateHosted = () => sql(`alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role`);
  const cleanup = () => sql(`do $$ declare r text; begin
    foreach r in array array['sa_member','sa_outsider','supabase_admin'] loop
      if exists (select 1 from pg_roles where rolname = r) then execute format('drop owned by %I', r); execute format('drop role %I', r); end if;
    end loop; end $$`);

  const before = snapshot();
  cleanup();
  try {
    // 1. Local database without supabase_admin: notice and skip, post-condition still passes.
    const skipped = apply();
    equal(skipped.status, 0, 'applies where supabase_admin does not exist');
    ok(/role supabase_admin does not exist; skipping/.test(skipped.output), 'skip notice is raised');
    equal(snapshot(), before, 'skipping changes no default ACL');

    // 2. Simulated hosted project: supabase_admin (superuser) with default grants to anon/authenticated.
    sql(`create role supabase_admin superuser nologin; create role sa_outsider nologin; create role sa_member nologin; grant supabase_admin to sa_member`);
    simulateHosted();
    equal(defaultAcls('supabase_admin').split(',').sort(), ['authenticated:SELECT', 'authenticated:UPDATE', 'authenticated:USAGE', 'anon:SELECT', 'anon:UPDATE', 'anon:USAGE'].sort(), 'simulation: supabase_admin defaults grant anon and authenticated');
    equal(sql(`set role supabase_admin; create sequence public.zz_sa_probe_seq; select has_sequence_privilege('anon','public.zz_sa_probe_seq','USAGE'), has_sequence_privilege('authenticated','public.zz_sa_probe_seq','UPDATE'); drop sequence public.zz_sa_probe_seq`).split('\n').find(line => line.includes('|')), 't|t', 'simulation: a supabase_admin sequence is born exposed');
    const hosted = snapshot();

    // 3. Negative control: a role with no rights over supabase_admin fails loudly and changes nothing.
    const outsider = apply('sa_outsider');
    ok(outsider.status !== 0, 'role without rights over supabase_admin must fail');
    ok(/run this migration as supabase_admin or as a member of it/.test(outsider.output), `clear failure message, got: ${outsider.output}`);
    ok(/permission denied to change default privileges/.test(outsider.output), 'original error is kept in the message');
    equal(snapshot(), hosted, 'failed run leaves default ACLs untouched (transaction rolled back)');
    ok(defaultAcls('supabase_admin') !== 'none', 'defaults are still granted after the failed run');

    // 4. Applying as supabase_admin clears the defaults and passes the post-condition.
    const applied = apply('supabase_admin');
    equal(applied.status, 0, `applies as supabase_admin: ${applied.output}`);
    equal(defaultAcls('supabase_admin'), 'none', 'supabase_admin defaults no longer grant anon, authenticated or PUBLIC');

    // 5. A sequence created by supabase_admin afterwards has no browser-role privilege.
    const created = sql(`set role supabase_admin; create sequence public.zz_sa_after_seq; select 'done'`);
    ok(created.includes('done'), 'supabase_admin can create a sequence');
    equal(sequenceAcl('zz_sa_after_seq'), 'none', 'new supabase_admin sequence has no anon, authenticated or PUBLIC ACL entry');
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['USAGE', 'SELECT', 'UPDATE']) {
        equal(sql(`select has_sequence_privilege(${quote(role)}, 'public.zz_sa_after_seq', ${quote(privilege)})`), 'f', `${role} has no ${privilege} on a new supabase_admin sequence`);
      }
      assert.throws(() => sql(`begin; set local role ${role}; select nextval('public.zz_sa_after_seq'); commit`), error => /permission denied for sequence/.test(`${error.stderr}`)); checks += 1;
    }
    equal(sql(`select has_sequence_privilege('service_role','public.zz_sa_after_seq','USAGE')`), 't', 'service_role default privileges are not changed by this migration');
    sql(`drop sequence public.zz_sa_after_seq`);

    // 6. Idempotent: re-running changes nothing and still passes.
    const settled = snapshot();
    for (const role of ['supabase_admin', 'supabase_admin', null]) {
      const again = apply(role);
      equal(again.status, 0, `re-run as ${role ?? 'postgres'} passes: ${again.output}`);
      equal(snapshot(), settled, `re-run as ${role ?? 'postgres'} changes nothing`);
    }

    // 7. A member of supabase_admin (not a superuser itself) is enough.
    simulateHosted();
    const member = apply('sa_member');
    equal(member.status, 0, `applies as a member of supabase_admin: ${member.output}`);
    equal(defaultAcls('supabase_admin'), 'none', 'member run clears the supabase_admin defaults');

    // 8. Post-condition assertions fail the migration, and the negative controls restore state.
    for (const [grant, who] of [['anon', 'anon'], ['authenticated', 'authenticated'], ['public', 'PUBLIC']]) {
      sql(`create sequence public.zz_leak_seq; grant usage on sequence public.zz_leak_seq to ${grant}`);
      const leaked = apply();
      ok(leaked.status !== 0 && new RegExp(`public sequences still grant privileges to browser roles or PUBLIC: .*zz_leak_seq grants USAGE to ${who}`).test(leaked.output), `existing sequence granted to ${who} fails the assertion: ${leaked.output}`);
      sql(`drop sequence public.zz_leak_seq`);
    }
    for (const [grant, who] of [['anon', 'anon'], ['public', 'PUBLIC']]) {
      sql(`alter default privileges in schema public grant usage on sequences to ${grant}`);
      const leaked = apply();
      ok(leaked.status !== 0 && new RegExp(`pg_default_acl still grants browser roles or PUBLIC privileges on new public sequences: default ACL of postgres grants USAGE to ${who}`).test(leaked.output), `current-role default ACL granted to ${who} fails the assertion: ${leaked.output}`);
      sql(`alter default privileges in schema public revoke all on sequences from ${grant}`);
    }
    equal(snapshot(), settled, 'negative controls restored the default ACLs');
    const clean = apply();
    equal(clean.status, 0, `passes again once the leaks are removed: ${clean.output}`);

    // 9. Known limit: a global (all schemas) default ACL is not removable with IN SCHEMA, so it is reported.
    sql(`alter default privileges for role supabase_admin grant usage on sequences to anon`);
    const global = apply('supabase_admin');
    equal(global.status, 0, 'a global default ACL does not fail the migration'); 
    ok(/global \(not schema-specific\) default ACL/.test(global.output), 'a global default ACL raises a warning');
    sql(`alter default privileges for role supabase_admin revoke all on sequences from anon`);
  } finally {
    cleanup();
  }
  equal(sql(`select count(*) from pg_roles where rolname in ('supabase_admin','sa_member','sa_outsider')`), '0', 'test roles removed');
  equal(snapshot(), before, 'default ACLs are back to their state before the test');
  console.log(`PASS: ${checks} supabase_admin sequence default ACL assertions (disposable database; roles created and removed by the test).`);
}
