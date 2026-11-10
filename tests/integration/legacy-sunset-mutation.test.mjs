import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import { verifyLegacyAuditLockWait } from './coverage-enforcement.acceptance.mjs';
import { LEGACY_CAP, installLegacySunsetTestClock } from './legacy-sunset-test-clock.mjs';

// Optional negative control. Run separately from garage-care-db.test.mjs against
// a fresh database; deliberately break only its disposable installed function.
const database = process.env.GARAGE_CARE_TEST_DATABASE_URL;
if (!database) throw new Error('GARAGE_CARE_TEST_DATABASE_URL is required.');
const url = new URL(database);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/skycar_integration_test') {
  throw new Error('Refusing mutation test: only local disposable skycar_integration_test is permitted.');
}
const args = [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = statement => execFileSync('psql', [...args, '-c', statement], { encoding: 'utf8' }).trim();
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const result = async statement => {
  try { return { value: (await promisify(execFile)('psql', [...args, '-c', statement], { encoding: 'utf8' })).stdout.trim() }; }
  catch (error) { return { error, output: `${error.message}\n${error.stderr ?? ''}` }; }
};
const garageCreate = (owner, key, model) => JSON.parse(sql(`begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(owner)};
  select public.garage_mutate_vehicle('create',null,${quote(JSON.stringify({ make: 'Toyota', model, variant: null, year: 2022, registration: null, registration_state: null }))}::jsonb,${quote(key)}::uuid,gen_random_uuid()); commit;`).split('\n')[0]);

test('the audit-wait regression detects broken post-lock checks', async t => {
  assert.equal(sql("select count(*) from information_schema.tables where table_schema='public'"), '0', 'must be a fresh database');
  const files = ['tests/integration/bootstrap.sql', ...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort().map(name => `supabase/migrations/${name}`)];
  for (const file of files) execFileSync('psql', [...args, '-f', file], { encoding: 'utf8' });
  sql('insert into public.care_response_policy values (true,60,30)');
  const recheck = 'and public.care_legacy_create_open(sampled.at)';
  const mutations = [
    {
      name: 'missing post-lock recheck',
      label: 'waiting across stored deadline fails closed',
      mutate: definition => definition.replace(recheck, 'and true /* deliberate test-only missing recheck */'),
    },
    {
      name: 'cached switch from the pre-lock snapshot',
      label: 'an early-close that commits during the audit wait fails the waiter closed',
      // Keep both deadline checks but cache the boolean before waiting. This is
      // intentionally wrong and proves the early-close snapshot assertion matters.
      mutate: definition => definition.replace('  at_time timestamptz := clock_timestamp();',
        `  cached_enabled boolean := (select accept_legacy_create from public.care_service_coverage_compat where singleton);
  at_time timestamptz := clock_timestamp();`).replace(recheck,
        `and cached_enabled and sampled.at < least((select legacy_create_deadline from public.care_service_coverage_compat where singleton), timestamptz ${quote(LEGACY_CAP)})`),
    },
  ];
  for (const mutation of mutations) await t.test(mutation.name, async () => {
    const clock = installLegacySunsetTestClock({ sql, quote });
    try {
      const definition = sql("select pg_get_functiondef('public.care_submit_request(uuid,jsonb)'::regprocedure)");
      assert.equal(definition.split(recheck).length - 1, 1);
      const modified = mutation.mutate(definition);
      assert.notEqual(modified, definition);
      sql(modified);
      // Insist on the exact false-positive behavior: the waiter returned success.
      // A timeout, permission failure or unrelated audit-trigger error cannot pass.
      await assert.rejects(
        () => verifyLegacyAuditLockWait({ sql, quote, garageCreate, result, clock }),
        error => error.code === 'ERR_ASSERTION' && error.actual === false && error.expected === true
          && error.message.includes(mutation.label),
        'the regression must reject a successful create that crossed the boundary',
      );
    } finally { clock.restore(); }
  });
});
