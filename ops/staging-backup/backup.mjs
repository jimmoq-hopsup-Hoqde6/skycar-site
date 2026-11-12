import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants, X509Certificate } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  ARCHIVE_FORMAT,
  RECOVERY_CONTRACT_VERSION,
  RECOVERY_MANIFEST_SQL,
  RECOVERY_ORACLE_NAME,
  createRecoveryOracle,
  parseManifest,
} from './recovery-contract.mjs';

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
const FAILURE_PHASES = new Set([
  'configuration', 'toolchain', 'baseline-before', 'manifest-before',
  'roles-script', 'roles-export', 'schema-script', 'schema-export',
  'data-script', 'data-export', 'baseline-after', 'manifest-after',
  'oracle', 'encryption', 'output', 'unknown',
]);
const FAILURE_CATEGORIES = new Set([
  'validation', 'spawn', 'command', 'tls', 'authentication', 'connection', 'baseline', 'unknown',
]);
// Match whole English PostgreSQL/libpq diagnostics, not substrings that could
// occur in a private identifier. Unrecognised detail or multiple attempts fall
// back to command; captured text is never returned or included in an exception.
const CONNECTION_PREFIX = String.raw`psql: error: connection to server at "[^"\r\n]+"(?: \([^()\r\n]+\))?, port [0-9]+ failed: `;
const CONNECTION_HINT = String.raw`(?:\n\tIs the server running on that host and accepting TCP/IP connections\?|\n\tIs the server running on that host and accepting\n\tTCP/IP connections\?)?`;
const PSQL_FAILURE_SIGNATURES = [
  ['tls', new RegExp('^' + CONNECTION_PREFIX + String.raw`SSL error: certificate verify failed$`)],
  ['tls', new RegExp('^' + CONNECTION_PREFIX + String.raw`server certificate for "[^"\r\n]+" does not match host name "[^"\r\n]+"$`)],
  ['authentication', new RegExp('^' + CONNECTION_PREFIX + String.raw`FATAL: +password authentication failed for user "[^"\r\n]+"$`)],
  ['authentication', new RegExp('^' + CONNECTION_PREFIX + String.raw`fe_sendauth: no password supplied$`)],
  ['connection', new RegExp('^' + CONNECTION_PREFIX + '(?:Connection refused|Network is unreachable|No route to host|Connection timed out)' + CONNECTION_HINT + '$')],
  ['connection', new RegExp('^' + CONNECTION_PREFIX + 'timeout expired$')],
  ['connection', /^psql: error: could not translate host name "[^"\r\n]+" to address: (?:Name or service not known|Temporary failure in name resolution)$/],
];

// Used only for the existing fixed baseline psql commands. Exit status alone
// cannot distinguish a rejected baseline from permissions or other SQL errors.
export function classifyPsqlFailure(result) {
  if (typeof result?.stderr !== 'string' || result.stderr.length > 16384) return 'command';
  const diagnostic = result.stderr.replace(/\r\n/g, '\n').trimEnd();
  if ([1, 3].includes(result.status)) {
    return /^ERROR: +Unexpected (?:staging baseline|migration history)(?:\nCONTEXT: +PL\/pgSQL function inline_code_block line [0-9]+ at RAISE)?$/.test(diagnostic)
      ? 'baseline' : 'command';
  }
  if (result.status !== 2) return 'command';
  const matches = PSQL_FAILURE_SIGNATURES.filter(([, signature]) => signature.test(diagnostic));
  return matches.length === 1 ? matches[0][0] : 'command';
}

class BackupFailure extends Error {
  constructor(phase, category) {
    super('SAFE_BACKUP_FAILURE');
    this.phase = FAILURE_PHASES.has(phase) ? phase : 'unknown';
    this.category = FAILURE_CATEGORIES.has(category) ? category : 'unknown';
  }
}

function failure(phase, category) { throw new BackupFailure(phase, category); }

function withPhase(phase, action, validationCodes = []) {
  try { return action(); } catch (error) {
    if (error instanceof BackupFailure) throw error;
    if (validationCodes.includes(error?.message)) failure(phase, 'validation');
    failure(phase, 'unknown');
  }
}

export function formatFailure(error) {
  if (error instanceof BackupFailure) {
    return `SKYCAR_BACKUP_FAILURE phase=${error.phase} category=${error.category}`;
  }
  if (error?.message === 'BACKUP_GATE_REJECTED') {
    return 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation';
  }
  return 'SKYCAR_BACKUP_FAILURE phase=unknown category=unknown';
}

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
  const ca = validateDatabaseCA(e);
  const url = new URL('postgresql://localhost/postgres');
  url.hostname = host;
  url.port = '5432';
  url.username = `postgres.${ref}`;
  url.password = encodeURIComponent(e.STAGING_SUPABASE_DB_PASSWORD);
  return { url: url.href, key, ca };
}

function validateDatabaseCA(e) {
  // Pin one canonical PEM certificate, not the runner's ambient trust store.
  // Node's base64 and X509 parsers are permissive: round-trip both encodings
  // to reject ignored bytes, multiple PEM blocks and trailing data.
  try {
    const encoded = e.STAGING_SUPABASE_DB_CA_CERT_B64;
    const fingerprint = e.STAGING_SUPABASE_DB_CA_SHA256;
    if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 32768 ||
        typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) reject();
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) reject();
    const certificate = new X509Certificate(bytes);
    const pem = certificate.toString();
    if (!bytes.equals(Buffer.from(pem, 'utf8')) || !certificate.ca ||
        hash(certificate.raw) !== fingerprint) reject();
    return pem;
  } catch { reject(); }
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
  const names = Object.keys(files).sort();
  if (names.join(',') !== ['data.sql', RECOVERY_ORACLE_NAME, 'roles.sql', 'schema.sql'].sort().join(',')) {
    throw new Error('RECOVERY_ORACLE_MISSING');
  }
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const header = { format: ARCHIVE_FORMAT, recoveryContractVersion: RECOVERY_CONTRACT_VERSION,
    cipher: 'AES-256-GCM', wrapping: 'RSA-OAEP-SHA256', ...metadata };
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
export function runQuiet(command, args, options = {}, failurePhase = 'toolchain', classifyFailure) {
  let result;
  try {
    result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000, ...options });
  } catch { failure(failurePhase, 'spawn'); }
  if (result.error) failure(failurePhase, 'spawn');
  if (result.status !== 0) {
    let category = 'command';
    try {
      const candidate = classifyFailure?.({ status: result.status, stderr: result.stderr });
      if (FAILURE_CATEGORIES.has(candidate)) category = candidate;
    } catch { /* Classifier errors must not expose subprocess data. */ }
    failure(failurePhase, category);
  }
  return result.stdout;
}

export function capture(e, run = runQuiet, internal = {}) {
  const { key, ca } = withPhase('configuration', () => validateConfig(e), ['BACKUP_GATE_REJECTED']);
  const makeOracle = internal.createRecoveryOracle || createRecoveryOracle;
  const encrypt = internal.encryptBundle || encryptBundle;
  const writeOutput = internal.writeOutput || ((path, value) =>
    writeFileSync(path, value, { mode: 0o600, flag: 'wx' }));
  const cli = fileURLToPath(new URL('./node_modules/.bin/supabase', import.meta.url));
  const output = join(e.RUNNER_TEMP, 'skycar-backup-encrypted');
  // A fresh output directory prevents upload of a stale/partial prior attempt.
  withPhase('output', () => mkdirSync(output, { mode: 0o700 }));
  let work;
  let succeeded = false;
  try {
    work = mkdtempSync(join(tmpdir(), 'skycar-backup-'));
    const caPath = join(work, 'database-ca.pem');
    withPhase('configuration', () => writeFileSync(caPath, ca, { mode: 0o600, flag: 'wx' }));
    const runPhase = (phase, command, args, options, classifier) => {
      try { return run(command, args, options, phase, classifier); } catch (error) {
        if (error instanceof BackupFailure) throw error;
        failure(phase, 'unknown');
      }
    };
    const childEnv = {
      PATH: e.PATH, HOME: work, TMPDIR: work,
      PGSSLMODE: 'verify-full', PGSSLROOTCERT: caPath,
      PGCONNECT_TIMEOUT: '15', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=180000',
      CI: 'true', SUPABASE_TELEMETRY_DISABLED: 'true',
    };
    const cliVersion = runPhase('toolchain', cli, ['--version'], { env: childEnv }).trim();
    const pgDumpVersion = runPhase('toolchain', 'pg_dump', ['--version'], { env: childEnv }).trim();
    const psqlVersion = runPhase('toolchain', 'psql', ['--version'], { env: childEnv }).trim();
    if (cliVersion !== CLI_VERSION) failure('toolchain', 'validation');
    if (!/^pg_dump \(PostgreSQL\) 17\./.test(pgDumpVersion) || !/^psql \(PostgreSQL\) 17\./.test(psqlVersion)) {
      failure('toolchain', 'validation');
    }
    const databaseEnv = { ...childEnv, PGHOST: e.STAGING_SUPABASE_DB_HOST, PGPORT: '5432',
      PGUSER: e.STAGING_SUPABASE_DB_USER, PGPASSWORD: e.STAGING_SUPABASE_DB_PASSWORD, PGDATABASE: 'postgres' };
    const verifyEmpty = phase => {
      const result = runPhase(phase, 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', EMPTY_TARGET_SQL], {
        env: databaseEnv,
      }, classifyPsqlFailure);
      if (result.trim() !== 'EMPTY_STAGING_CONFIRMED') failure(phase, 'validation');
    };
    verifyEmpty('baseline-before');
    const readManifest = phase => {
      const value = runPhase(phase, 'psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
        input: RECOVERY_MANIFEST_SQL, env: databaseEnv,
      }).trim();
      try { return parseManifest(value); } catch { failure(phase, 'validation'); }
    };
    const sourceBaseline = readManifest('manifest-before');
    const files = {};
    for (const [name, args] of dumpPlan('postgresql://postgres:unused@localhost:5432/postgres')) {
      const stem = name.slice(0, -4);
      // The pinned CLI generates its documented pg_dump filters. Execute locally so
      // libpq TLS/read-only settings are explicit, not lost at a Docker boundary.
      const scriptValue = runPhase(`${stem}-script`, cli, args, { env: childEnv });
      const script = withPhase(`${stem}-script`, () => prepareDumpScript(scriptValue), ['BACKUP_GATE_REJECTED']);
      const sql = runPhase(`${stem}-export`, 'bash', ['--noprofile', '--norc'], { input: script, env: databaseEnv, cwd: work });
      withPhase(`${stem}-export`, () => {
        if (!sql?.trim()) failure(`${stem}-export`, 'validation');
        const path = join(work, name);
        writeFileSync(path, sql, { mode: 0o600, flag: 'wx' });
        if (statSync(path).size > 32 * 1024 * 1024) failure(`${stem}-export`, 'validation');
        files[name] = readFileSync(path).toString('base64');
      });
    }
    verifyEmpty('baseline-after');
    const expectedState = readManifest('manifest-after');
    if (JSON.stringify(sourceBaseline) !== JSON.stringify(expectedState)) failure('manifest-after', 'validation');
    const dumpHashes = Object.entries(files).map(([name, bytes]) => ({ name, sha256: hash(Buffer.from(bytes, 'base64')) }));
    const oracle = withPhase('oracle', () => makeOracle({
      sourceBaseline,
      expectedState,
      toolchain: { cliVersion, pgDumpVersion, psqlVersion, serverVersion: sourceBaseline.serverVersion },
      dumpHashes,
    }), ['RECOVERY_MANIFEST_INVALID', 'RECOVERY_TOOLCHAIN_INVALID', 'RECOVERY_DUMP_HASHES_INVALID']);
    files[RECOVERY_ORACLE_NAME] = Buffer.from(`${JSON.stringify(oracle)}\n`).toString('base64');
    const manifest = {
      applicationSha: APPLICATION_SHA, workflowSha: e.GITHUB_SHA,
      createdAt: new Date().toISOString(), cliVersion: CLI_VERSION,
      keyFingerprint: e.STAGING_BACKUP_KEY_SHA256,
      files: Object.entries(files).map(([name, bytes]) => ({ name, sha256: hash(Buffer.from(bytes, 'base64')) })),
      recoveryContractVersion: RECOVERY_CONTRACT_VERSION,
      restoreStatus: 'NOT_RUN', storageObjects: 'NOT_INCLUDED',
    };
    const envelope = withPhase('encryption', () => encrypt(files, key, manifest), ['RECOVERY_ORACLE_MISSING']);
    withPhase('output', () => writeOutput(join(output, 'backup.enc.json'), JSON.stringify(envelope)));
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
  } catch (error) {
    console.error(formatFailure(error));
    process.exitCode = 1;
  }
}
