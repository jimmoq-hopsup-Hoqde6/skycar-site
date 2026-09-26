import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

export const APPLICATION_SHA = '821125df9556225b4d34ff1aec4072c2d789b4cf';
export const CLI_VERSION = '2.117.0';
export const EMPTY_TARGET_SQL = `DO $$
DECLARE migration_count bigint;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
    OR EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
    OR EXISTS (SELECT 1 FROM auth.users)
    OR EXISTS (SELECT 1 FROM storage.buckets)
    OR EXISTS (SELECT 1 FROM storage.objects)
  THEN RAISE EXCEPTION 'Unexpected staging baseline'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO migration_count;
    IF migration_count <> 0 THEN RAISE EXCEPTION 'Unexpected migration history'; END IF;
  END IF;
END $$;
SELECT 'EMPTY_STAGING_CONFIRMED';`;
const SHA = /^[a-f0-9]{40}$/;
const reject = () => { throw new Error('BACKUP_GATE_REJECTED'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateGate(e) {
  if (e.GITHUB_REPOSITORY !== 'jimmoq-hopsup-Hoqde6/skycar-site' ||
      e.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      e.GITHUB_REF !== 'refs/heads/fix/phone-test-delivery' ||
      e.ISOLATION_CONFIRMATION !== 'ISOLATED-STAGING-BACKUP-ONLY' ||
      e.STAGING_ISOLATION_MARKER !== 'skycar-v2-isolated-staging' ||
      e.REQUESTED_REVISION !== APPLICATION_SHA ||
      e.STAGING_APPROVED_REVISION !== APPLICATION_SHA ||
      !SHA.test(e.STAGING_BACKUP_APPROVED_WORKFLOW_SHA || '') ||
      e.GITHUB_SHA !== e.STAGING_BACKUP_APPROVED_WORKFLOW_SHA ||
      e.GITHUB_WORKFLOW_SHA !== e.GITHUB_SHA ||
      e.RUNNER_DEBUG === '1' || e.ACTIONS_STEP_DEBUG === 'true' ||
      e.ACTIONS_RUNNER_DEBUG === 'true') reject();
}

export function validateConfig(e) {
  validateGate(e);
  const ref = e.STAGING_SUPABASE_PROJECT_REF || '';
  const host = e.STAGING_SUPABASE_DB_HOST || '';
  // Session pooler only: verified project-specific username, TLS, non-transaction port.
  // Actual values are administrator-approved environment config, never dispatch inputs.
  if (!/^[a-z]{20}$/.test(ref) ||
      !/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) ||
      e.STAGING_SUPABASE_DB_USER !== `postgres.${ref}` ||
      e.STAGING_SUPABASE_DB_PORT !== '5432' ||
      !e.STAGING_SUPABASE_DB_PASSWORD || /[\r\n\0]/.test(e.STAGING_SUPABASE_DB_PASSWORD)) reject();
  let key;
  try {
    if (!(e.STAGING_BACKUP_PUBLIC_KEY || '').startsWith('-----BEGIN PUBLIC KEY-----')) reject();
    key = createPublicKey(e.STAGING_BACKUP_PUBLIC_KEY);
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072) reject();
    const fingerprint = hash(key.export({ type: 'spki', format: 'der' }));
    if (fingerprint !== e.STAGING_BACKUP_KEY_SHA256) reject();
  } catch { reject(); }
  const url = new URL('postgresql://localhost/postgres');
  url.hostname = host;
  url.port = '5432';
  url.username = `postgres.${ref}`;
  url.password = encodeURIComponent(e.STAGING_SUPABASE_DB_PASSWORD);
  return { url: url.href, key };
}

export function dumpPlan(url) {
  return [
    ['roles.sql', ['db', 'dump', '--db-url', url, '--role-only', '--dry-run']],
    ['schema.sql', ['db', 'dump', '--db-url', url, '--dry-run']],
    ['data.sql', ['db', 'dump', '--db-url', url, '--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes', '--dry-run']],
  ];
}

export function prepareDumpScript(script) {
  // Generate using a credential-free placeholder, then supply libpq values only
  // through the child environment. No real secret is interpolated into shell.
  for (const line of ['export PGHOST="localhost"', 'export PGPORT="5432"',
    'export PGUSER="postgres"', 'export PGPASSWORD="unused"', 'export PGDATABASE="postgres"']) {
    if (script.split(line).length !== 2) reject();
    script = script.replace(`${line}\n`, '');
  }
  if (/^export PG/m.test(script)) reject();
  return script;
}

export function encryptBundle(files, publicKey, metadata) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const header = { format: 'skycar-backup-v1', cipher: 'AES-256-GCM', wrapping: 'RSA-OAEP-SHA256', ...metadata };
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const plaintext = gzipSync(Buffer.from(JSON.stringify(files)));
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      header,
      wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally { key.fill(0); plaintext.fill(0); }
}

// No subprocess output or exception is emitted: even failures can contain credentials/data.
export function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, ...options });
  if (result.error || result.status !== 0) throw new Error('BACKUP_COMMAND_FAILED');
  return result.stdout;
}

export function capture(e, run = runQuiet) {
  const { key } = validateConfig(e);
  const cli = fileURLToPath(new URL('./node_modules/.bin/supabase', import.meta.url));
  const output = join(e.RUNNER_TEMP, 'skycar-backup-encrypted');
  // A fresh output directory prevents upload of a stale/partial prior attempt.
  mkdirSync(output, { mode: 0o700 });
  let work;
  let succeeded = false;
  try {
    work = mkdtempSync(join(tmpdir(), 'skycar-backup-'));
    const childEnv = {
      PATH: e.PATH, HOME: work, TMPDIR: work,
      PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/etc/ssl/certs/ca-certificates.crt',
      PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=180000',
      CI: 'true', SUPABASE_TELEMETRY_DISABLED: 'true',
    };
    if (run(cli, ['--version'], { env: childEnv }).trim() !== CLI_VERSION) reject();
    if (!/^pg_dump \(PostgreSQL\) 17\./.test(run('pg_dump', ['--version'], { env: childEnv }))) reject();
    const databaseEnv = { ...childEnv, PGHOST: e.STAGING_SUPABASE_DB_HOST, PGPORT: '5432',
      PGUSER: e.STAGING_SUPABASE_DB_USER, PGPASSWORD: e.STAGING_SUPABASE_DB_PASSWORD, PGDATABASE: 'postgres' };
    const verifyEmpty = () => {
      const result = run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', EMPTY_TARGET_SQL], {
        env: databaseEnv,
      });
      if (result.trim() !== 'EMPTY_STAGING_CONFIRMED') reject();
    };
    verifyEmpty();
    const files = {};
    for (const [name, args] of dumpPlan('postgresql://postgres:unused@localhost:5432/postgres')) {
      // The pinned CLI generates its documented pg_dump filters. Execute locally so
      // libpq TLS/read-only settings are explicit, not lost at a Docker boundary.
      const script = prepareDumpScript(run(cli, args, { env: childEnv }));
      const sql = run('bash', ['--noprofile', '--norc'], { input: script, env: databaseEnv, cwd: work });
      if (!sql?.trim()) throw new Error('BACKUP_EMPTY_DUMP');
      const path = join(work, name);
      writeFileSync(path, sql, { mode: 0o600, flag: 'wx' });
      if (statSync(path).size > 32 * 1024 * 1024) throw new Error('BACKUP_SIZE_LIMIT');
      files[name] = readFileSync(path).toString('base64');
    }
    verifyEmpty();
    const manifest = {
      applicationSha: APPLICATION_SHA, workflowSha: e.GITHUB_SHA,
      createdAt: new Date().toISOString(), cliVersion: CLI_VERSION,
      keyFingerprint: e.STAGING_BACKUP_KEY_SHA256,
      files: Object.entries(files).map(([name, bytes]) => ({ name, sha256: hash(Buffer.from(bytes, 'base64')) })),
      restoreStatus: 'NOT_RUN', storageObjects: 'NOT_INCLUDED',
    };
    const envelope = encryptBundle(files, key, manifest);
    writeFileSync(join(output, 'backup.enc.json'), JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
    succeeded = true;
    return output;
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
    if (!succeeded) rmSync(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--gate') validateGate(process.env);
    else if (process.argv[2] === '--capture') capture(process.env);
    else reject();
    console.log(process.argv[2] === '--gate' ? 'Backup revision gate passed.' : 'Encrypted export captured. Restore verification NOT RUN.');
  } catch {
    console.error('Staging backup stopped; no raw diagnostic or backup content published. Check approved configuration and private recovery procedure.');
    process.exitCode = 1;
  }
}
