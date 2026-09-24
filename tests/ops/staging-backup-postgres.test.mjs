import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EMPTY_TARGET_SQL, CLI_VERSION, dumpPlan, prepareDumpScript, runQuiet, encryptBundle } from '../../ops/staging-backup/backup.mjs';
import { decryptBundle } from '../../ops/staging-backup/decrypt.mjs';

// Disposable loopback-only CI fixture. No hosted environment or credential access.
test('real PostgreSQL dump, encrypted round-trip and disposable restore', { skip: process.env.SKYCAR_BACKUP_POSTGRES_TEST !== '1' }, () => {
  const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres',
    PGPASSWORD: 'synthetic-ci-only', PGDATABASE: 'postgres', PGSSLMODE: 'disable' };
  const sql = (query, extra = {}) => runQuiet('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: query, env: { ...env, ...extra } }).trim();
  sql('CREATE DATABASE skycar_fixture; CREATE DATABASE skycar_restore;');
  env.PGDATABASE = 'skycar_fixture';
  const managed = 'CREATE SCHEMA auth; CREATE TABLE auth.users (id integer); CREATE SCHEMA storage; CREATE TABLE storage.buckets (id text); CREATE TABLE storage.objects (id text);';
  sql(managed);
  const readOnly = { PGOPTIONS: '-c default_transaction_read_only=on' };
  assert.equal(sql(EMPTY_TARGET_SQL, readOnly), 'EMPTY_STAGING_CONFIRMED');
  sql("INSERT INTO auth.users VALUES (1);");
  assert.throws(() => sql(EMPTY_TARGET_SQL, readOnly));
  sql('DELETE FROM auth.users; CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text);');
  assert.equal(sql(EMPTY_TARGET_SQL, readOnly), 'EMPTY_STAGING_CONFIRMED');
  sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('fixture');");
  assert.throws(() => sql(EMPTY_TARGET_SQL, readOnly));
  sql("DELETE FROM supabase_migrations.schema_migrations; CREATE TABLE public.fixture (id integer primary key, note text); INSERT INTO public.fixture VALUES (7, 'synthetic recovery sentinel');");
  assert.throws(() => sql(EMPTY_TARGET_SQL, readOnly));
  const cli = fileURLToPath(new URL('../../ops/staging-backup/node_modules/.bin/supabase', import.meta.url));
  assert.equal(runQuiet(cli, ['--version']).trim(), CLI_VERSION);
  const files = {};
  for (const [name, args] of dumpPlan('postgresql://postgres:unused@localhost:5432/postgres')) {
    const script = prepareDumpScript(runQuiet(cli, args, { env }));
    const dump = runQuiet('bash', ['--noprofile', '--norc'], { input: script, env: { ...env, ...readOnly } });
    assert.ok(dump.trim());
    files[name] = Buffer.from(dump).toString('base64');
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const metadata = { files: Object.entries(files).map(([name, value]) => ({ name, sha256: createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex') })) };
  const recovered = decryptBundle(encryptBundle(files, publicKey, metadata), privateKey);
  assert.deepEqual(recovered, files);
  env.PGDATABASE = 'skycar_restore';
  sql(managed);
  for (const name of ['roles.sql', 'schema.sql', 'data.sql']) sql(Buffer.from(recovered[name], 'base64').toString());
  assert.equal(sql('SELECT note FROM public.fixture WHERE id = 7;'), 'synthetic recovery sentinel');
  // This verifies fixture recovery only, never a hosted Supabase restore point.
});
