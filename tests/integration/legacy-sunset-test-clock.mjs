import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const LEGACY_CAP = '2026-11-21 13:30:00+00';
export const LEGACY_OPEN_AT = '2026-11-20 13:30:00+00';
export const LEGACY_BEFORE_CAP = '2026-11-21 13:29:59.999999+00';
export const LEGACY_AFTER_CAP = '2026-11-21 13:30:00.000001+00';
const SCHEMA = 'legacy_sunset_test';
const CLOCK = `${SCHEMA}.clock_timestamp()`;
const SUBMIT = 'public.care_submit_request(uuid,jsonb)';
const PREDICATE = 'public.care_legacy_create_open(timestamp with time zone)';
const migration = readFileSync(new URL('../../supabase/migrations/20261108120000_care_legacy_create_sunset.sql', import.meta.url), 'utf8');

// Change exactly the two decision samples, never the predicate, cap, constraints,
// locks, volatility, or request/event timestamps. Fail if either site drifts.
export function substituteSunsetClock(definition) {
  const sites = [
    ['public.care_legacy_create_open(clock_timestamp())', `public.care_legacy_create_open(${CLOCK})`],
    ['from (select clock_timestamp() as at) as sampled', `from (select ${CLOCK} as at) as sampled`],
  ];
  let modified = definition;
  assert.ok(!definition.includes(SCHEMA), 'the original must not contain a test seam');
  for (const [original, replacement] of sites) {
    assert.equal(modified.split(original).length - 1, 1, `expected exactly one clock site: ${original}`);
    modified = modified.replace(original, replacement);
  }
  assert.equal(modified.split(CLOCK).length - 1, 2, 'exactly two clock substitutions');
  assert.equal(modified.replaceAll(CLOCK, 'clock_timestamp()'), definition, 'only the two clock expressions changed');
  return modified;
}

export function installLegacySunsetTestClock({ sql, quote }) {
  assert.equal(sql('select current_database()'), 'skycar_integration_test', 'test seam requires the disposable integration database');
  assert.equal(sql("select inet_server_addr() in (inet '127.0.0.1', inet '::1')"), 't', 'test seam requires a loopback database');
  const definition = signature => sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`);
  const metadata = () => sql(`select jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef,'volatility',provolatile) from pg_proc where oid=${quote(SUBMIT)}::regprocedure`);
  const constraint = () => sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.care_service_coverage_compat'::regclass and conname='care_service_coverage_compat_deadline_cap'");
  const original = definition(SUBMIT);
  const predicate = definition(PREDICATE);
  const originalMetadata = metadata();
  const originalConstraint = constraint();
  // Compare installed bodies with the actual migration, not a test rewrite of its
  // logic. The predicate and CHECK stay completely unmodified throughout.
  const submitBody = migration.match(/create or replace function public\.care_submit_request\([^]*?as \$\$([^]*?)\$\$;/)?.[1];
  const predicateBody = migration.match(/create function public\.care_legacy_create_open\([^]*?as \$open\$([^]*?)\$open\$;/)?.[1];
  assert.ok(submitBody && predicateBody, 'production migration bodies are present');
  assert.equal(sql(`select prosrc from pg_proc where oid=${quote(SUBMIT)}::regprocedure`), submitBody.trim(), 'installed submit body exactly matches production migration');
  assert.equal(sql(`select prosrc from pg_proc where oid=${quote(PREDICATE)}::regprocedure`), predicateBody.trim(), 'installed predicate body exactly matches production migration');
  const modified = substituteSunsetClock(original);
  sql(`begin;
    create schema ${SCHEMA};
    revoke all on schema ${SCHEMA} from public, anon, authenticated, service_role;
    create table ${SCHEMA}.clock (singleton boolean primary key check (singleton), at timestamptz not null);
    insert into ${SCHEMA}.clock values (true, timestamptz ${quote(LEGACY_OPEN_AT)});
    create function ${CLOCK} returns timestamptz language sql volatile security invoker set search_path = ''
      as 'select at from ${SCHEMA}.clock where singleton';
    revoke all on table ${SCHEMA}.clock from public, anon, authenticated, service_role;
    revoke all on function ${CLOCK} from public, anon, authenticated, service_role;
    ${modified};
    commit;`);
  const verifyUnchanged = () => {
    assert.equal(metadata(), originalMetadata, 'submit security metadata is unchanged');
    assert.equal(definition(PREDICATE), predicate, 'production predicate is unchanged');
    assert.equal(constraint(), originalConstraint, 'hard-cap CHECK is unchanged');
  };
  try {
    verifyUnchanged();
    assert.equal(definition(SUBMIT), modified, 'installed definition has exactly the two substitutions');
  } catch (error) {
    sql(`begin; ${original}; drop function ${CLOCK}; drop table ${SCHEMA}.clock; drop schema ${SCHEMA}; commit;`);
    throw error;
  }
  return {
    now: CLOCK,
    set(at) { sql(`update ${SCHEMA}.clock set at = timestamptz ${quote(at)} where singleton`); },
    restore() {
      let changed;
      try { verifyUnchanged(); } catch (error) { changed = error; }
      sql(`begin; ${original}; drop function ${CLOCK}; drop table ${SCHEMA}.clock; drop schema ${SCHEMA}; commit;`);
      assert.equal(definition(SUBMIT), original, 'original submit definition is restored byte for byte');
      verifyUnchanged();
      assert.equal(sql(`select to_regnamespace(${quote(SCHEMA)}) is null`), 't', 'test clock is removed');
      assert.equal(sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and position(${quote(SCHEMA)} in prosrc)>0`), '0', 'no public function retains the test seam');
      if (changed) throw changed;
    },
  };
}
