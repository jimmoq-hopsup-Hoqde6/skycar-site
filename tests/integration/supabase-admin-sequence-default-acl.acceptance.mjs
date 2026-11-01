import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

// Sequence default-privilege hardening after 20261101133000, on disposable databases:
//   supabase/migrations/20261101140000_revoke_supabase_admin_sequence_default_acl.sql
//     migration-safe: never touches supabase_admin, never raises for anyone else's defaults, reports instead;
//   scripts/ops/supabase-admin-sequence-default-acl.sql  (supabase_admin only, hard-failing, atomic);
//   scripts/ops/sequence-default-acl-gate.sql            (read-only go/no-go).
// Assertions use SQLSTATE (psql VERBOSITY=verbose) and the stable SKYCAR-SEQ-ACL message prefix,
// never PostgreSQL's own wording. Creates and removes the cluster roles and the scratch database it needs.
export function verifySupabaseAdminSequenceDefaultAcl({ sql, quote }) {
  let checks = 0;
  const ok = (value, label) => { assert.ok(value, label); checks += 1; };
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
  const migrationFile = 'supabase/migrations/20261101140000_revoke_supabase_admin_sequence_default_acl.sql';
  const opsFile = 'scripts/ops/supabase-admin-sequence-default-acl.sql';
  const gateFile = 'scripts/ops/sequence-default-acl-gate.sql';
  const database = process.env.GARAGE_CARE_TEST_DATABASE_URL;
  const scratchUrl = (() => { const url = new URL(database); url.pathname = '/skycar_chain_probe'; return url.toString(); })();

  // Run a file (optionally after SET ROLE) in one psql session. VERBOSITY=verbose prints SQLSTATE.
  const apply = (file, role, url = database) => {
    const result = spawnSync('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...(role ? ['-c', `set role ${role}`] : []), '-f', file], { encoding: 'utf8' });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}`, stdout: result.stdout };
  };
  const state = (code, severity) => new RegExp(`${severity}:\\s+${code}:\\s+SKYCAR-SEQ-ACL`);
  const warnings = output => output.split('\n').filter(line => /WARNING:\s+01000:\s+SKYCAR-SEQ-ACL/.test(line));
  const hasWarning = (output, text) => warnings(output).some(line => line.includes(text));

  const grantee = `case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end`;
  const browser = `(a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))`;
  const agg = (value, from, run = sql) => run(`select coalesce(string_agg(v, '|' order by v), 'none') from (select ${value} as v ${from}) t`);
  // Default ACL rows of one creator (all scopes) that name a browser role or PUBLIC.
  const browserDefaults = (who, run = sql) => agg(`coalesce(defaclnamespace::regnamespace::text,'')||'/'||${grantee}||':'||a.privilege_type`,
    `from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclobjtype='S' and pg_get_userbyid(d.defaclrole)=${quote(who)} and ${browser}`, run);
  const snapshot = (run = sql) => agg(`pg_get_userbyid(defaclrole)||':'||defaclnamespace::regnamespace::text||':'||defaclobjtype::text||':'||defaclacl::text`, 'from pg_default_acl', run);
  const sequenceAcl = (name, run = sql) => agg(`${grantee}||':'||a.privilege_type`,
    `from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a where c.relname=${quote(name)} and c.relnamespace='public'::regnamespace and ${browser}`, run);
  const simulateHosted = (run = sql) => run(`
    alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role supabase_admin in schema public grant usage on sequences to public;
    alter default privileges for role supabase_admin grant usage on sequences to anon`);
  const roles = ['sa_member', 'sa_outsider', 'sa_other', 'sa_runner', 'supabase_admin'];
  const cleanup = () => {
    sql(`drop database if exists skycar_chain_probe with (force)`);
    sql(`do $$ declare r text; begin
      foreach r in array array[${roles.map(quote).join(',')}] loop
        if exists (select 1 from pg_roles where rolname = r) then execute format('drop owned by %I', r); execute format('drop role %I', r); end if;
      end loop; end $$`);
  };
  const trip = 'drop event trigger if exists skycar_seq_acl_trip';

  // The findings query is shared by the migration report, the ops verification and the gate: keep it identical.
  const findingsBlock = file => { const text = readFileSync(file, 'utf8'); const start = text.indexOf('-- findings:begin'); const end = text.indexOf('-- findings:end'); assert.ok(start >= 0 && end > start, `${file} has the findings block`); return text.slice(start, end); };
  equal(findingsBlock(opsFile), findingsBlock(migrationFile), 'ops verification uses the same findings query as the migration');
  equal(findingsBlock(gateFile), findingsBlock(migrationFile), 'gate uses the same findings query as the migration');

  // Structural guards for the migration chain: no supabase_admin DDL, no raise except none at all.
  const migrationSql = readFileSync(migrationFile, 'utf8').replace(/--.*$/gm, '');
  ok(!/alter\s+default\s+privileges\s+for\s+role/i.test(migrationSql), 'the migration never alters another role\'s default privileges');
  ok(!/\braise\s+exception\b/i.test(migrationSql), 'the migration contains no RAISE EXCEPTION');
  ok(/^\s*begin\s*;/im.test(migrationSql) && /^\s*commit\s*;/im.test(migrationSql), 'the migration is one explicit transaction');
  ok(/begin\s+read\s+only\s*;/i.test(readFileSync(gateFile, 'utf8')), 'the gate runs in a read only transaction');

  const before = snapshot();
  cleanup();
  try {
    // ---- Migration, role supabase_admin absent (plain PostgreSQL): reports clean, never fails.
    const absent = apply(migrationFile);
    equal(absent.status, 0, `migration passes without supabase_admin: ${absent.output}`);
    ok(state('00000', 'NOTICE').test(absent.output) && /clean/.test(absent.output), 'clean state is reported as a NOTICE');
    equal(warnings(absent.output), [], 'no warning when nothing is exposed');

    // ---- Hosted-like: supabase_admin (superuser) with schema, PUBLIC and global default grants.
    sql(`create role supabase_admin superuser nologin; create role sa_outsider nologin; create role sa_member nologin; create role sa_other nologin; grant supabase_admin to sa_member`);
    simulateHosted();
    equal(browserDefaults('supabase_admin').split('|').sort(), [
      '-/anon:USAGE', 'public/PUBLIC:USAGE', 'public/anon:SELECT', 'public/anon:UPDATE', 'public/anon:USAGE',
      'public/authenticated:SELECT', 'public/authenticated:UPDATE', 'public/authenticated:USAGE'].sort(), 'simulation: supabase_admin has schema, PUBLIC and global defaults');
    const hosted = browserDefaults('supabase_admin');

    // Non-member, member and superuser runners all pass; none changes supabase_admin; each reports it.
    for (const role of ['sa_outsider', 'sa_member', null]) {
      const run = apply(migrationFile, role);
      equal(run.status, 0, `migration passes for ${role ?? 'postgres'}: ${run.output}`);
      equal(browserDefaults('supabase_admin'), hosted, `migration run by ${role ?? 'postgres'} leaves supabase_admin defaults untouched`);
      ok(hasWarning(run.output, 'creator=supabase_admin scope=public grantee=anon privilege=USAGE'), `schema-level supabase_admin default is reported as a WARNING (${role ?? 'postgres'})`);
      ok(hasWarning(run.output, 'creator=supabase_admin scope=public grantee=PUBLIC privilege=USAGE'), 'a PUBLIC default is reported');
      ok(hasWarning(run.output, 'creator=supabase_admin scope=GLOBAL(all schemas) grantee=anon privilege=USAGE'), 'a global default is reported');
      ok(/WARNING:\s+01000:\s+SKYCAR-SEQ-ACL: \d+ finding\(s\) remain/.test(run.output), 'a summary warning is raised');
    }

    // When supabase_admin itself runs it, that is the runner's OWN default ACL: schema-level grants go, the global entry stays and is reported.
    const asAdmin = apply(migrationFile, 'supabase_admin');
    equal(asAdmin.status, 0, `migration passes for supabase_admin: ${asAdmin.output}`);
    equal(browserDefaults('supabase_admin'), '-/anon:USAGE', 'run as supabase_admin: its schema-level defaults are the runner\'s own and are revoked; the global one remains');
    ok(hasWarning(asAdmin.output, 'creator=supabase_admin scope=GLOBAL(all schemas) grantee=anon privilege=USAGE') && !hasWarning(asAdmin.output, 'scope=public'), 'only the remaining global entry is reported');
    simulateHosted();

    // Other creator roles are reported too (any defaclrole).
    sql(`alter default privileges for role sa_other in schema public grant select on sequences to authenticated`);
    ok(hasWarning(apply(migrationFile, 'sa_outsider').output, 'creator=sa_other scope=public grantee=authenticated privilege=SELECT'), 'default ACLs of other creator roles are reported');
    sql(`alter default privileges for role sa_other in schema public revoke all on sequences from authenticated`);

    // ---- The running role's own work: sequences and defaults are cleaned, PUBLIC included.
    sql(`create sequence public.zz_own_seq; grant usage on sequence public.zz_own_seq to anon, authenticated, public; grant usage, select on sequence public.zz_own_seq to service_role;
         alter default privileges in schema public grant usage on sequences to anon, authenticated, public`);
    const own = apply(migrationFile);
    equal(own.status, 0, `migration passes: ${own.output}`);
    equal(sequenceAcl('zz_own_seq'), 'none', 'the runner\'s sequence loses anon, authenticated and PUBLIC grants');
    equal(sql(`select has_sequence_privilege('service_role','public.zz_own_seq','USAGE') and has_sequence_privilege('service_role','public.zz_own_seq','SELECT')`), 't', 'service_role is untouched');
    equal(browserDefaults('postgres'), 'none', 'the runner\'s own default ACL grants nothing to anon, authenticated or PUBLIC');
    sql(`drop sequence public.zz_own_seq`);
    // A non-superuser, non-member runner: cleans only what it owns, reports (not raises) the rest.
    sql(`create sequence public.zz_postgres_seq; grant usage on sequence public.zz_postgres_seq to anon; grant create, usage on schema public to sa_outsider;
         set role sa_outsider; create sequence public.zz_outsider_seq; grant usage on sequence public.zz_outsider_seq to anon, public; reset role`);
    const outsider = apply(migrationFile, 'sa_outsider');
    equal(outsider.status, 0, `non-member runner passes: ${outsider.output}`);
    equal(sequenceAcl('zz_outsider_seq'), 'none', 'a runner cleans a sequence it owns');
    equal(sequenceAcl('zz_postgres_seq'), 'anon:USAGE', 'a sequence the runner cannot act as is left alone');
    ok(/NOTICE:\s+00000:\s+SKYCAR-SEQ-ACL: skipping sequence public\.zz_postgres_seq/.test(outsider.output), 'the skip is noted');
    ok(hasWarning(outsider.output, 'sequence=public.zz_postgres_seq owner=postgres grantee=anon privilege=USAGE'), 'the skipped sequence is reported as a finding');
    sql(`drop sequence public.zz_postgres_seq, public.zz_outsider_seq; revoke all on schema public from sa_outsider`);

    // ---- Atomicity: a failure after the first statement rolls the whole migration back.
    sql(`create sequence public.zz_atomic_seq; grant usage on sequence public.zz_atomic_seq to anon;
         create function public.skycar_seq_acl_trip() returns event_trigger language plpgsql as $f$ begin raise exception 'SKYCAR-TEST-TRIP'; end $f$;
         create event trigger skycar_seq_acl_trip on ddl_command_end when tag in ('ALTER DEFAULT PRIVILEGES') execute function public.skycar_seq_acl_trip()`);
    const tripped = apply(migrationFile);
    sql(trip); sql(`drop function public.skycar_seq_acl_trip()`);
    ok(tripped.status !== 0 && /SKYCAR-TEST-TRIP/.test(tripped.output), 'an injected failure fails the migration');
    equal(sequenceAcl('zz_atomic_seq'), 'anon:USAGE', 'the migration is atomic: the earlier revoke was rolled back');
    sql(`drop sequence public.zz_atomic_seq`);

    // ---- Gate: read only, lists every finding, fails (no-go) on any.
    sql(`alter default privileges for role sa_other in schema public grant usage on sequences to authenticated;
         alter default privileges for role sa_other grant usage on sequences to public;
         create sequence public.zz_gate_seq; grant select on sequence public.zz_gate_seq to public`);
    const gateBefore = snapshot();
    const noGo = apply(gateFile);
    ok(noGo.status !== 0 && /ERROR:\s+P0001:\s+SKYCAR-SEQ-ACL: NO-GO/.test(noGo.output), `gate fails closed with a stable message: ${noGo.output}`);
    for (const finding of ['creator=supabase_admin scope=public grantee=anon', 'creator=supabase_admin scope=GLOBAL(all schemas) grantee=anon privilege=USAGE',
      'creator=sa_other scope=public grantee=authenticated privilege=USAGE', 'creator=sa_other scope=GLOBAL(all schemas) grantee=PUBLIC privilege=USAGE',
      'sequence=public.zz_gate_seq owner=postgres grantee=PUBLIC privilege=SELECT']) {
      ok(noGo.output.split('\n').some(line => /^(default_acl|sequence)\|/.test(line) && line.includes(finding)), `gate lists: ${finding}`);
      ok(hasWarning(noGo.output, finding), `gate warns: ${finding}`);
    }
    equal(snapshot(), gateBefore, 'gate changes nothing');
    // Runbook classification: rows that are not supabase_admin default ACLs are the blocking ones (docs filter).
    const doc = readFileSync('docs/SUPABASE_ADMIN_SEQUENCE_DEFAULT_ACL.md', 'utf8');
    ok(doc.includes("grep -vE '^default_acl\\|creator=supabase_admin '"), 'the runbook documents the classification filter');
    const blocking = noGo.stdout.split('\n').filter(line => /^(default_acl|sequence)\|/.test(line) && !/^default_acl\|creator=supabase_admin /.test(line));
    ok(blocking.length > 0 && blocking.every(line => !line.includes('creator=supabase_admin')) && blocking.some(line => line.startsWith('sequence|')) && blocking.some(line => line.includes('creator=sa_other')), 'the filter keeps other creators and sequences and drops supabase_admin default ACLs');
    sql(`drop sequence public.zz_gate_seq; alter default privileges for role sa_other in schema public revoke all on sequences from authenticated;
         alter default privileges for role sa_other revoke all on sequences from public`);

    // ---- Ops script: only supabase_admin (or a member). Non-member fails loudly and changes nothing.
    const hostedAll = snapshot();
    const denied = apply(opsFile, 'sa_outsider');
    ok(denied.status !== 0 && state('42501', 'ERROR').test(denied.output), `non-member fails with SQLSTATE 42501 and the stable message: ${denied.output}`);
    equal(snapshot(), hostedAll, 'the refused run changed nothing');

    // A third creator's grant, or a leaking sequence, fails the verification and rolls EVERYTHING back (atomic).
    for (const [label, setup, teardown, finding] of [
      ['another creator default ACL', `alter default privileges for role sa_other in schema public grant usage on sequences to anon`, `alter default privileges for role sa_other in schema public revoke all on sequences from anon`, 'creator=sa_other scope=public grantee=anon privilege=USAGE'],
      ['a global default ACL of another creator granting USAGE', `alter default privileges for role sa_other grant usage on sequences to authenticated`, `alter default privileges for role sa_other revoke all on sequences from authenticated`, 'creator=sa_other scope=GLOBAL(all schemas) grantee=authenticated privilege=USAGE'],
      ['an existing sequence granted to PUBLIC', `create sequence public.zz_leak_seq; grant select on sequence public.zz_leak_seq to public`, `drop sequence public.zz_leak_seq`, 'sequence=public.zz_leak_seq owner=postgres grantee=PUBLIC privilege=SELECT'],
    ]) {
      sql(setup);
      const withLeak = snapshot();
      const failed = apply(opsFile, 'supabase_admin');
      ok(failed.status !== 0 && /ERROR:\s+P0001:\s+SKYCAR-SEQ-ACL: NO-GO/.test(failed.output), `verification fails hard on ${label}: ${failed.output}`);
      ok(hasWarning(failed.output, finding), `verification names the finding for ${label}`);
      equal(snapshot(), withLeak, `failed verification rolls the revoke back (${label})`);
      sql(teardown);
    }
    // The verification half of the ops script must catch supabase_admin's own defaults without relying on the revoke half.
    const opsText = readFileSync(opsFile, 'utf8');
    const verifyOnly = '/tmp/skycar-ops-verify-only.sql';
    spawnSync('sh', ['-c', `printf 'begin;\\n' > ${verifyOnly}; sed -n '/^-- Verification:/,$p' ${opsFile} >> ${verifyOnly}`]);
    ok(opsText.includes('-- Verification:'), 'ops script has a verification section');
    const verifyAlone = apply(verifyOnly, 'supabase_admin');
    ok(verifyAlone.status !== 0 && /ERROR:\s+P0001:\s+SKYCAR-SEQ-ACL: NO-GO/.test(verifyAlone.output), `verification alone fails while supabase_admin defaults remain: ${verifyAlone.output}`);
    ok(hasWarning(verifyAlone.output, 'creator=supabase_admin scope=public grantee=anon privilege=USAGE') && hasWarning(verifyAlone.output, 'creator=supabase_admin scope=GLOBAL(all schemas) grantee=anon privilege=USAGE'), 'verification alone names the supabase_admin schema and global defaults');
    equal(snapshot(), hostedAll, 'negative controls restored the state');

    // ---- Ops script as supabase_admin: clears schema, PUBLIC and global defaults; gate then says GO.
    const applied = apply(opsFile, 'supabase_admin');
    equal(applied.status, 0, `ops script passes as supabase_admin: ${applied.output}`);
    ok(state('00000', 'NOTICE').test(applied.output) && /verified/.test(applied.output), 'verification success is reported');
    equal(browserDefaults('supabase_admin'), 'none', 'schema, PUBLIC and global defaults of supabase_admin are cleared');
    const go = apply(gateFile);
    equal(go.status, 0, `gate says GO: ${go.output}`);
    ok(/^GO$/m.test(go.stdout), 'the gate prints GO');
    equal(sql(`set role supabase_admin; create sequence public.zz_sa_after_seq; select 'done'`).includes('done'), true, 'supabase_admin can create a sequence');
    equal(sequenceAcl('zz_sa_after_seq'), 'none', 'a new supabase_admin sequence has no anon, authenticated or PUBLIC privilege');
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['USAGE', 'SELECT', 'UPDATE']) {
        equal(sql(`select has_sequence_privilege(${quote(role)}, 'public.zz_sa_after_seq', ${quote(privilege)})`), 'f', `${role} has no ${privilege} on a new supabase_admin sequence`);
      }
      assert.throws(() => sql(`begin; set local role ${role}; select nextval('public.zz_sa_after_seq'); commit`), error => /42501|permission denied/.test(`${error.stderr}`)); checks += 1;
    }
    equal(sql(`select has_sequence_privilege('service_role','public.zz_sa_after_seq','USAGE')`), 't', 'service_role default privileges are not changed');
    sql(`drop sequence public.zz_sa_after_seq`);

    // The gate cannot write: a write injected into the gate text is refused by the read only transaction.
    const writeProbe = '/tmp/skycar-gate-write-probe.sql';
    spawnSync('sh', ['-c', `sed 's/^rollback;/create table public.zz_gate_write(i int); rollback;/' ${gateFile} > ${writeProbe}`]);
    const probe = apply(writeProbe);
    ok(probe.status !== 0 && /ERROR:\s+25006:/.test(probe.output), `gate transaction is read only (SQLSTATE 25006): ${probe.output}`);
    equal(sql(`select to_regclass('public.zz_gate_write') is null`), 't', 'no table was created by the gate');

    // ---- Idempotent / clean-state re-runs (migration and ops script), as every kind of runner.
    const settled = snapshot();
    for (const [file, role] of [[opsFile, 'supabase_admin'], [opsFile, 'sa_member'], [opsFile, 'supabase_admin'], [migrationFile, 'sa_outsider'], [migrationFile, 'sa_member'], [migrationFile, null], [migrationFile, null]]) {
      const again = apply(file, role);
      equal(again.status, 0, `re-run of ${file} as ${role ?? 'postgres'} on a clean state passes: ${again.output}`);
      equal(snapshot(), settled, `re-run of ${file} as ${role ?? 'postgres'} changes nothing`);
      if (file === migrationFile) {
        equal(warnings(again.output), [], 'a clean state produces no warning');
        // A runner that cannot act as another owner also gets one skip NOTICE per such sequence; the standard runner gets exactly the clean one.
        if (role === null) equal(again.output.split('\n').filter(line => /NOTICE:\s+00000:\s+SKYCAR-SEQ-ACL/.test(line)).length, 1, 'a clean re-run as the migration runner prints exactly one SKYCAR-SEQ-ACL NOTICE');
      }
    }

    // ---- supabase_admin absent: the ops script skips the revoke, still verifies (and fails on a leak).
    sql(`drop owned by supabase_admin; drop role supabase_admin`);
    const noAdmin = apply(opsFile);
    equal(noAdmin.status, 0, `ops script without supabase_admin passes when clean: ${noAdmin.output}`);
    ok(/NOTICE:\s+00000:\s+SKYCAR-SEQ-ACL: role supabase_admin does not exist/.test(noAdmin.output), 'the absent role is noted');
    sql(`create sequence public.zz_leak_seq; grant usage on sequence public.zz_leak_seq to anon`);
    ok(apply(opsFile).status !== 0, 'verification still runs without supabase_admin');
    sql(`drop sequence public.zz_leak_seq`);

    // ---- Full chain applied by a non-superuser, non-member runner on a hosted-like scratch database.
    sql(`create role supabase_admin superuser nologin; create role sa_runner nologin`);
    sql(`drop database if exists skycar_chain_probe with (force)`); sql(`create database skycar_chain_probe`);
    const scratch = statement => spawnSync('psql', [scratchUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
    const scratchSql = statement => { const result = scratch(statement); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
    const bootstrap = readFileSync('tests/integration/bootstrap.sql', 'utf8').split('\n').filter(line => !/^create role /.test(line)).join('\n');
    const loaded = spawnSync('psql', [scratchUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', bootstrap], { encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    scratchSql(`alter schema public owner to sa_runner; alter schema auth owner to sa_runner; alter schema storage owner to sa_runner;
      do $$ declare r record; begin
        for r in select c.oid::regclass as o, c.relkind from pg_class c where c.relnamespace in ('auth'::regnamespace,'storage'::regnamespace) and c.relkind in ('r','S','v') loop
          execute format('alter %s %s owner to sa_runner', case r.relkind when 'r' then 'table' when 'S' then 'sequence' else 'view' end, r.o); end loop;
        for r in select p.oid::regprocedure as o from pg_proc p where p.pronamespace in ('auth'::regnamespace,'storage'::regnamespace) loop execute format('alter function %s owner to sa_runner', r.o); end loop;
      end $$;
      alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role`);
    scratchSql(`set role sa_runner; alter default privileges in schema public grant all on sequences to anon, authenticated, service_role; reset role`);
    simulateHosted(scratchSql);
    const chain = readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort();
    ok(chain.at(-1) === '20261101140000_revoke_supabase_admin_sequence_default_acl.sql', 'the migration is the last in the chain');
    let last;
    for (const name of chain) {
      last = apply(`supabase/migrations/${name}`, 'sa_runner', scratchUrl);
      equal(last.status, 0, `chain: ${name} applies as a non-superuser, non-member runner: ${last.output}`);
    }
    ok(hasWarning(last.output, 'creator=supabase_admin scope=public grantee=anon privilege=USAGE') && hasWarning(last.output, 'creator=supabase_admin scope=GLOBAL(all schemas) grantee=anon privilege=USAGE'), 'the chain reports the supabase_admin defaults it cannot change');
    equal(scratchSql(`select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('care_requests','care_journeys','care_journey_events')`), '3', 'the full chain created its tables');
    equal(browserDefaults('sa_runner', scratchSql), 'none', 'the runner\'s own defaults are clean after the chain');
    const chainGate = apply(gateFile, null, scratchUrl);
    ok(chainGate.status !== 0 && /NO-GO/.test(chainGate.output), 'the gate is NO-GO until supabase_admin runs the ops script');
    const chainOps = apply(opsFile, 'supabase_admin', scratchUrl);
    equal(chainOps.status, 0, `ops script on the chain database: ${chainOps.output}`);
    const chainGo = apply(gateFile, null, scratchUrl);
    equal(chainGo.status, 0, `the gate is GO afterwards: ${chainGo.output}`);
    const rerun = apply(migrationFile, 'sa_runner', scratchUrl);
    equal(rerun.status, 0, 'the migration re-runs on a clean chain database');
    equal(warnings(rerun.output), [], 'and reports nothing');
  } finally {
    sql(trip);
    sql(`drop function if exists public.skycar_seq_acl_trip()`);
    cleanup();
  }
  equal(sql(`select count(*) from pg_roles where rolname in (${roles.map(quote).join(',')})`), '0', 'test roles removed');
  equal(snapshot(), before, 'default ACLs are back to their state before the test');
  console.log(`PASS: ${checks} sequence default ACL assertions: migration-safe for any runner, hard-failing supabase_admin ops script, read-only gate (disposable databases; roles created and removed by the test).`);
}
