import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_SHA, CLI_VERSION, EMPTY_TARGET_SQL, validateGate, validateConfig, dumpPlan, prepareDumpScript, encryptBundle, capture, runQuiet, formatFailure, classifyPsqlFailure } from '../../ops/staging-backup/backup.mjs';
import { decryptBundle } from '../../ops/staging-backup/decrypt.mjs';
import { RECOVERY_MANIFEST_SQL, RECOVERY_ORACLE_NAME, createRecoveryOracle } from '../../ops/staging-backup/recovery-contract.mjs';

// Public synthetic CA only; its generated private key was discarded. Never a hosted CA.
const syntheticCA = `-----BEGIN CERTIFICATE-----
MIIBpjCCAUugAwIBAgIUeTKIAMg/Jrtjosxx3gMlOs8DldMwCgYIKoZIzj0EAwIw
KDEmMCQGA1UEAwwdU2t5Y2FyIHN5bnRoZXRpYyB0ZXN0IENBIG9ubHkwHhcNMjYw
OTI4MTM1MzUyWhcNMzYwOTI1MTM1MzUyWjAoMSYwJAYDVQQDDB1Ta3ljYXIgc3lu
dGhldGljIHRlc3QgQ0Egb25seTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMf9
kFoXbqiKHiW7Z+C1LX++OS+/Vb6VD+9VglZz53cFMDcW+iXtuMnhDuCCRSA69CyL
HWjddNmfglYqqGm4k+qjUzBRMB0GA1UdDgQWBBRcuBdp+9af8s8agEpqn54emzJo
hDAfBgNVHSMEGDAWgBRcuBdp+9af8s8agEpqn54emzJohDAPBgNVHRMBAf8EBTAD
AQH/MAoGCCqGSM49BAMCA0kAMEYCIQDHNo+Hlui5R/KXoDyLfvhqC58hor8gKcbf
xGBYObCOXQIhAOmvaybNpBERw9cnprUcALtqfLrqvFKwLv+FbSoZxwse
-----END CERTIFICATE-----
`;
const caBase64 = Buffer.from(syntheticCA).toString('base64');
const caFingerprint = createHash('sha256').update(new X509Certificate(syntheticCA).raw).digest('hex');

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
function environment() {
  return {
    GITHUB_REPOSITORY: 'jimmoq-hopsup-Hoqde6/skycar-site', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/fix/phone-test-delivery',
    GITHUB_SHA: 'a'.repeat(40), GITHUB_WORKFLOW_SHA: 'a'.repeat(40),
    STAGING_BACKUP_APPROVED_WORKFLOW_SHA: 'a'.repeat(40),
    ISOLATION_CONFIRMATION: 'ISOLATED-STAGING-BACKUP-ONLY', STAGING_ISOLATION_MARKER: 'skycar-v2-isolated-staging',
    REQUESTED_REVISION: APPLICATION_SHA, STAGING_APPROVED_REVISION: APPLICATION_SHA,
    STAGING_SUPABASE_PROJECT_REF: 'a'.repeat(20),
    STAGING_SUPABASE_DB_HOST: 'aws-0-ap-southeast-2.pooler.supabase.com',
    STAGING_SUPABASE_DB_USER: `postgres.${'a'.repeat(20)}`, STAGING_SUPABASE_DB_PORT: '5432',
    STAGING_SUPABASE_DB_PASSWORD: 'synthetic /:#?%@ quote\'"& password',
    STAGING_BACKUP_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
    STAGING_BACKUP_KEY_SHA256: fingerprint,
    STAGING_SUPABASE_DB_CA_CERT_B64: caBase64,
    STAGING_SUPABASE_DB_CA_SHA256: caFingerprint,
  };
}

test('valid approved dispatch and target; URL safely encodes password without shell', () => {
  const e = environment();
  validateGate(e);
  const u = new URL(validateConfig(e).url);
  assert.equal(decodeURIComponent(u.password), e.STAGING_SUPABASE_DB_PASSWORD);
  assert.equal(u.hostname, e.STAGING_SUPABASE_DB_HOST);
  assert.equal(u.pathname, '/postgres');
  assert.equal(u.port, '5432');
});

const invalidCAs = [
  ['missing', undefined], ['null', null], ['non-string', {}], ['empty', ''],
  ['malformed base64', '!private-certificate-sentinel!'],
  ['whitespace', `${caBase64}\n`], ['extra padding', `${caBase64}=`],
  ['oversized', 'A'.repeat(32772)],
  ['not PEM', Buffer.from('private-certificate-sentinel').toString('base64')],
  ['DER instead of PEM', new X509Certificate(syntheticCA).raw.toString('base64')],
  ['two certificates', Buffer.from(syntheticCA + syntheticCA).toString('base64')],
  ['leading text', Buffer.from('private-certificate-sentinel\n' + syntheticCA).toString('base64')],
  ['trailing text', Buffer.from(syntheticCA + 'private-certificate-sentinel').toString('base64')],
  ['noncanonical PEM', Buffer.from(syntheticCA.replaceAll('\n', '\r\n')).toString('base64')],
  ['invalid certificate', Buffer.from('-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n').toString('base64')],
];
for (const [label, value] of invalidCAs) {
  test(`CA ${label} rejects before any subprocess or output directory`, () => {
    let calls = 0; let error;
    try { capture({ ...environment(), STAGING_SUPABASE_DB_CA_CERT_B64: value }, () => { calls++; }); }
    catch (caught) { error = caught; }
    assert.equal(calls, 0);
    assert.equal(formatFailure(error), 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation');
  });
}

test('CA pin is required, canonical lowercase DER SHA-256, and must match', () => {
  for (const value of [undefined, null, {}, '', '0'.repeat(64), caFingerprint.toUpperCase(), `${caFingerprint}\n`,
    createHash('sha256').update(syntheticCA).digest('hex')]) {
    let calls = 0; let error;
    try { capture({ ...environment(), STAGING_SUPABASE_DB_CA_SHA256: value }, () => { calls++; }); }
    catch (caught) { error = caught; }
    assert.equal(calls, 0);
    assert.equal(formatFailure(error), 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation');
  }
});

test('invalid private CA content is never printed by the capture CLI', () => {
  const helper = fileURLToPath(new URL('../../ops/staging-backup/backup.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [helper, '--capture'], {
    env: { ...environment(), STAGING_SUPABASE_DB_CA_CERT_B64: Buffer.from('private-certificate-sentinel').toString('base64') },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation\n');
});

for (const [name, value] of Object.entries({
  GITHUB_REPOSITORY: 'other/repo', GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'b'.repeat(40), GITHUB_WORKFLOW_SHA: 'b'.repeat(40),
  STAGING_BACKUP_APPROVED_WORKFLOW_SHA: 'main', REQUESTED_REVISION: 'b'.repeat(40),
  STAGING_APPROVED_REVISION: 'b'.repeat(40), ISOLATION_CONFIRMATION: '', STAGING_ISOLATION_MARKER: 'production',
  RUNNER_DEBUG: '1', ACTIONS_STEP_DEBUG: 'true', ACTIONS_RUNNER_DEBUG: 'true',
  STAGING_SUPABASE_PROJECT_REF: 'production', STAGING_SUPABASE_DB_HOST: 'attacker.example',
  STAGING_SUPABASE_DB_USER: 'postgres.other', STAGING_SUPABASE_DB_PORT: '6543',
  STAGING_SUPABASE_DB_PASSWORD: '', STAGING_BACKUP_PUBLIC_KEY: '', STAGING_BACKUP_KEY_SHA256: '0'.repeat(64),
})) {
  test(`reject ${name} before invoking commands`, () => {
    let calls = 0;
    let error;
    try { capture({ ...environment(), [name]: value }, () => { calls++; }); } catch (caught) { error = caught; }
    assert.equal(formatFailure(error), 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation');
    assert.equal(calls, 0);
  });
}

test('reject host suffix spoofing, newline password and weak or non-RSA keys', () => {
  for (const host of ['aws-0-x.pooler.supabase.com.attacker.example', 'db.example.supabase.co', '127.0.0.1']) {
    assert.throws(() => validateConfig({ ...environment(), STAGING_SUPABASE_DB_HOST: host }));
  }
  assert.throws(() => validateConfig({ ...environment(), STAGING_SUPABASE_DB_PASSWORD: 'x\nCOMMAND' }));
  const weak = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => validateConfig({ ...environment(), STAGING_BACKUP_PUBLIC_KEY: weak }));
});

test('only reviewed read-only dump inventory; no linked project or migration commands', () => {
  const plan = dumpPlan('synthetic-url');
  assert.deepEqual(plan.map(([name]) => name), ['roles.sql', 'schema.sql', 'data.sql']);
  assert.deepEqual(plan[0][1], ['db', 'dump', '--db-url', 'synthetic-url', '--role-only', '--dry-run']);
  assert.deepEqual(plan[2][1].slice(4), ['--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes', '--dry-run']);
  assert.ok(plan.every(([, args]) => args.at(-1) === '--dry-run'));
});

function fixture() {
  const files = Object.fromEntries(['roles.sql', 'schema.sql', 'data.sql'].map(name => [name, Buffer.from(`private synthetic ${name}`).toString('base64')]));
  const manifest = {
    serverVersion: '17.6', roles: [], memberships: [], schemas: [], extensions: [],
    parameterPrivileges: [], providerObjects: [], customObjects: [],
    postgres17Boundary: { ltreeIndexes: 0, btreeGistFloatIndexes: 0, customEstimatorOperators: 0 },
  };
  const dumpHashes = Object.entries(files).map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex') }));
  const oracle = createRecoveryOracle({ sourceBaseline: manifest, expectedState: manifest, dumpHashes,
    toolchain: { cliVersion: CLI_VERSION, pgDumpVersion: 'pg_dump (PostgreSQL) 17.6', psqlVersion: 'psql (PostgreSQL) 17.6', serverVersion: '17.6' } });
  files[RECOVERY_ORACLE_NAME] = Buffer.from(JSON.stringify(oracle)).toString('base64');
  const metadata = { files: Object.entries(files).map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex') })) };
  return { files, metadata };
}

test('v2 capture rejects the previous unauthenticated three-file recovery packet', () => {
  const { files, metadata } = fixture();
  delete files[RECOVERY_ORACLE_NAME];
  assert.throws(() => encryptBundle(files, publicKey, metadata), /RECOVERY_ORACLE_MISSING/);
});

test('encrypted export round-trips with owner key and rejects tampering', () => {
  const { files, metadata } = fixture();
  const envelope = encryptBundle(files, publicKey, metadata);
  assert.deepEqual(decryptBundle(envelope, privateKey), files);
  assert.ok(!JSON.stringify(envelope).includes('private synthetic'));
  for (const field of ['ciphertext', 'tag', 'iv', 'wrappedKey']) {
    const damaged = structuredClone(envelope);
    const bytes = Buffer.from(damaged[field], 'base64'); bytes[0] ^= 1; damaged[field] = bytes.toString('base64');
    assert.throws(() => decryptBundle(damaged, privateKey));
  }
  const modifiedHeader = structuredClone(envelope); modifiedHeader.header.extra = 'changed';
  assert.throws(() => decryptBundle(modifiedHeader, privateKey));
  const wrong = generateKeyPairSync('rsa', { modulusLength: 3072 }).privateKey;
  assert.throws(() => decryptBundle(envelope, wrong));
});

test('recovery rejects wrong hashes and unexpected file inventory', () => {
  const { files, metadata } = fixture();
  metadata.files[0].sha256 = '0'.repeat(64);
  assert.throws(() => decryptBundle(encryptBundle(files, publicKey, metadata), privateKey), /checksum/);
  const legacy = structuredClone(encryptBundle(files, publicKey, metadata));
  legacy.header.format = 'skycar-backup-v1';
  legacy.header.recoveryContractVersion = undefined;
  assert.throws(() => decryptBundle(legacy, privateKey), /format/);
});

const invalidTagSizes = [...Array(16).keys(), 17, 32];
function tagWithLength(envelope, length) {
  const original = Buffer.from(envelope.tag, 'base64');
  return (length <= original.length ? original.subarray(0, length) : Buffer.concat([original, Buffer.alloc(length - original.length)])).toString('base64');
}

for (const length of invalidTagSizes) {
  test(`F1: recovery rejects ${length}-byte authentication tag`, () => {
    const { files, metadata } = fixture();
    const envelope = encryptBundle(files, publicKey, metadata);
    assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
    envelope.tag = tagWithLength(envelope, length);
    assert.throws(() => decryptBundle(envelope, privateKey));
  });
}

function malformedTags(envelope) {
  return [undefined, null, 16, {}, [], 'not-base64!', `${envelope.tag}\n`,
    envelope.tag.replace(/=+$/, ''), `${envelope.tag}!`, `${envelope.tag}====`];
}

test('F1: recovery rejects malformed/noncanonical authentication-tag fields', () => {
  const { files, metadata } = fixture();
  const envelope = encryptBundle(files, publicKey, metadata);
  for (const tag of malformedTags(envelope)) {
    assert.throws(() => decryptBundle({ ...envelope, tag }, privateKey));
  }
});

test('F1: offline CLI rejects invalid tags before creating any plaintext; full tag recovers', () => {
  const temp = mkdtempSync(join(tmpdir(), 'backup-tag-cli-test-'));
  try {
    const { files, metadata } = fixture();
    const envelope = encryptBundle(files, publicKey, metadata);
    const archive = join(temp, 'synthetic.enc.json');
    const keyFile = join(temp, 'synthetic-key.pem');
    const output = join(temp, 'recovered');
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const helper = fileURLToPath(new URL('../../ops/staging-backup/decrypt.mjs', import.meta.url));
    for (const tag of [...invalidTagSizes.map(length => tagWithLength(envelope, length)), ...malformedTags(envelope)]) {
      writeFileSync(archive, JSON.stringify({ ...envelope, tag }), { mode: 0o600 });
      const result = spawnSync(process.execPath, [helper, archive, keyFile, output], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Private backup recovery failed.\n');
      assert.equal(existsSync(output), false);
      assert.deepEqual(readdirSync(temp).sort(), ['synthetic-key.pem', 'synthetic.enc.json']);
    }
    writeFileSync(archive, JSON.stringify(envelope), { mode: 0o600 });
    const result = spawnSync(process.execPath, [helper, archive, keyFile, output], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    for (const [name, bytes] of Object.entries(files)) assert.equal(readFileSync(join(output, name)).toString('base64'), bytes);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

function fakeCommand(command, args, options) {
  assert.equal(options.env.PGSSLROOTCERT, join(options.env.HOME, 'database-ca.pem'));
  assert.equal(readFileSync(options.env.PGSSLROOTCERT, 'utf8'), syntheticCA);
  if (args[0] === '--version') {
    if (command === 'pg_dump') return 'pg_dump (PostgreSQL) 17.6';
    if (command === 'psql') return 'psql (PostgreSQL) 17.6';
    return CLI_VERSION;
  }
  assert.equal(options.env.PGSSLMODE, 'verify-full');
  assert.equal(options.env.PGSSLROOTCERT, join(options.env.HOME, 'database-ca.pem'));
  assert.equal(readFileSync(options.env.PGSSLROOTCERT, 'utf8'), syntheticCA);
  assert.equal(statSync(options.env.PGSSLROOTCERT).mode & 0o777, 0o600);
  assert.equal(statSync(options.env.HOME).mode & 0o777, 0o700);
  assert.ok(!('STAGING_SUPABASE_DB_CA_CERT_B64' in options.env));
  assert.ok(!('STAGING_SUPABASE_DB_CA_SHA256' in options.env));
  assert.ok(!args.join(' ').includes(syntheticCA));
  assert.match(options.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.ok(!('STAGING_SUPABASE_DB_PASSWORD' in options.env));
  if (command === 'psql') {
    assert.equal(options.env.PGPASSWORD, environment().STAGING_SUPABASE_DB_PASSWORD);
    assert.ok(!args.includes(options.env.PGPASSWORD));
    if (options.input === RECOVERY_MANIFEST_SQL) return `${JSON.stringify({
      serverVersion: '17.6', roles: [], memberships: [], schemas: [], extensions: [],
      parameterPrivileges: [], providerObjects: [], customObjects: [],
      postgres17Boundary: { ltreeIndexes: 0, btreeGistFloatIndexes: 0, customEstimatorOperators: 0 },
    })}\n`;
    return 'EMPTY_STAGING_CONFIRMED\n';
  }
  if (command === 'bash') {
    assert.doesNotMatch(options.input, /export PG/);
    assert.ok(!options.input.includes(environment().STAGING_SUPABASE_DB_PASSWORD));
    assert.equal(options.env.PGPASSWORD, environment().STAGING_SUPABASE_DB_PASSWORD);
    return '-- private synthetic dump\nSELECT 1;\n';
  }
  assert.ok(!args.join(' ').includes(environment().STAGING_SUPABASE_DB_PASSWORD));
  return '#!/bin/bash\nexport PGHOST="localhost"\nexport PGPORT="5432"\nexport PGUSER="postgres"\nexport PGPASSWORD="unused"\nexport PGDATABASE="postgres"\npg_dump';
}

test('generated script must have exactly the pinned placeholder exports', () => {
  assert.throws(() => prepareDumpScript('export PGPASSWORD="unknown"\npg_dump'));
  assert.throws(() => prepareDumpScript('pg_dump'));
});

test('capture writes only encrypted artifact, decrypts all dumps, and cleans plaintext', () => {
  const temp = mkdtempSync(join(tmpdir(), 'backup-test-'));
  let workingDirectory;
  try {
    const output = capture({ ...environment(), RUNNER_TEMP: temp }, (command, args, options) => {
      workingDirectory = options.env.HOME;
      return fakeCommand(command, args, options);
    });
    assert.deepEqual(readdirSync(output), ['backup.enc.json']);
    assert.equal(existsSync(workingDirectory), false);
    const bytes = readFileSync(join(output, 'backup.enc.json'), 'utf8');
    assert.ok(!bytes.includes('SELECT 1'));
    const envelope = JSON.parse(bytes);
    assert.equal(envelope.header.restoreStatus, 'NOT_RUN');
    assert.equal(envelope.header.storageObjects, 'NOT_INCLUDED');
    assert.equal(Object.keys(decryptBundle(envelope, privateKey)).length, 4);
    assert.ok(!bytes.includes('serverVersion'));
    assert.ok(!bytes.includes(syntheticCA));
    assert.ok(!bytes.includes(caBase64));
    assert.ok(!bytes.includes(caFingerprint));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const failure of ['roles', 'schema', 'data', 'empty', 'version', 'nonempty-before', 'nonempty-after']) {
  test(`failure ${failure} publishes nothing and removes temporary SQL`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'backup-test-'));
    let dump = 0; let work; let probes = 0;
    try {
      assert.throws(() => capture({ ...environment(), RUNNER_TEMP: temp }, (command, args, options) => {
        work = options.env.HOME;
        if (failure === 'version' && args[0] === '--version') return 'unexpected-version';
        if (command === 'psql') {
          probes++;
          if ((failure === 'nonempty-before' && probes === 1) || (failure === 'nonempty-after' && probes === 2)) return 'unexpected-baseline';
        }
        if (command === 'bash') {
          dump++;
          if (['roles', 'schema', 'data'].indexOf(failure) + 1 === dump) throw new Error('private failure');
          if (failure === 'empty') return '';
        }
        return fakeCommand(command, args, options);
      }));
      assert.deepEqual(readdirSync(temp), []);
      if (work) assert.equal(existsSync(work), false);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
}

test('subprocess failures expose only allowlisted phase/category tokens', () => {
  let commandError; let spawnError;
  try { runQuiet(process.execPath, ['-e', "console.error('private-sentinel'); process.exit(1)"], {}, 'roles-export'); } catch (error) { commandError = error; }
  try { runQuiet('/nonexistent-skycar-review-binary', [], {}, 'schema-export'); } catch (error) { spawnError = error; }
  assert.equal(formatFailure(commandError), 'SKYCAR_BACKUP_FAILURE phase=roles-export category=command');
  assert.equal(formatFailure(spawnError), 'SKYCAR_BACKUP_FAILURE phase=schema-export category=spawn');
  assert.doesNotMatch(`${formatFailure(commandError)}${formatFailure(spawnError)}`, /private-sentinel|nonexistent-skycar-review-binary/);
});

const diagnosticSentinel = 'private-SQL-password-key-path-sentinel';
const connectionPrefix = 'psql: error: connection to server at "' + diagnosticSentinel + '" (192.0.2.1), port 5432 failed: ';
const tlsDiagnostic = connectionPrefix + 'SSL error: certificate verify failed\n';
const authDiagnostic = connectionPrefix + 'FATAL:  password authentication failed for user "' + diagnosticSentinel + '"\n';
const baselineDiagnostic = 'ERROR:  Unexpected staging baseline\nCONTEXT:  PL/pgSQL function inline_code_block line 10 at RAISE\n';
const diagnosticCases = [
  ['certificate verification', 2, tlsDiagnostic, 'tls'],
  ['hostname mismatch', 2, connectionPrefix + 'server certificate for "' + diagnosticSentinel + '" does not match host name "synthetic.invalid"\n', 'tls'],
  ['password rejection', 2, authDiagnostic, 'authentication'],
  ['missing password', 2, connectionPrefix + 'fe_sendauth: no password supplied\n', 'authentication'],
  ['connection refused', 2, connectionPrefix + 'Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?\n', 'connection'],
  ['network unreachable', 2, connectionPrefix + 'Network is unreachable\n\tIs the server running on that host and accepting\n\tTCP/IP connections?\n', 'connection'],
  ['no route', 2, connectionPrefix + 'No route to host\n', 'connection'],
  ['connection timeout', 2, connectionPrefix + 'Connection timed out\n', 'connection'],
  ['libpq timeout', 2, connectionPrefix + 'timeout expired\n', 'connection'],
  ['DNS failure', 2, 'psql: error: could not translate host name "' + diagnosticSentinel + '" to address: Name or service not known\n', 'connection'],
  ['temporary DNS failure', 2, 'psql: error: could not translate host name "' + diagnosticSentinel + '" to address: Temporary failure in name resolution\n', 'connection'],
  ['baseline command rejection', 1, baselineDiagnostic, 'baseline'],
  ['baseline script rejection', 3, baselineDiagnostic, 'baseline'],
  ['migration baseline rejection', 1, 'ERROR:  Unexpected migration history\n', 'baseline'],
  ['unknown server error', 3, 'ERROR:  permission denied for table ' + diagnosticSentinel + '\n', 'command'],
  ['unknown connection error', 2, connectionPrefix + diagnosticSentinel + '\n', 'command'],
  ['ambiguous attempts', 2, tlsDiagnostic + authDiagnostic, 'command'],
  ['repeated attempts', 2, tlsDiagnostic + tlsDiagnostic, 'command'],
  ['recognised error plus unknown detail', 2, tlsDiagnostic + diagnosticSentinel, 'command'],
  ['recognised error with extra suffix', 2, tlsDiagnostic.trimEnd() + ' ' + diagnosticSentinel, 'command'],
  ['misleading hostname', 2, 'psql: error: connection to server at "certificate verify failed" (192.0.2.1), port 5432 failed: ' + diagnosticSentinel, 'command'],
  ['misleading error text', 2, diagnosticSentinel + ' password authentication failed', 'command'],
  ['baseline plus unknown detail', 1, baselineDiagnostic + diagnosticSentinel, 'command'],
  ['baseline text in unrelated SQL', 3, 'ERROR:  syntax error at or near "Unexpected staging baseline"\n', 'command'],
  ['baseline with connection status', 2, baselineDiagnostic, 'command'],
  ['TLS with query status', 3, tlsDiagnostic, 'command'],
  ['unknown exit status', 42, tlsDiagnostic, 'command'],
  ['localized output', 2, 'psql: Fehler: ' + diagnosticSentinel, 'command'],
  ['empty output', 2, '', 'command'],
];

for (const [label, status, stderr, category] of diagnosticCases) {
  test('baseline diagnostics: ' + label + ' emits only the fixed token', () => {
    assert.equal(classifyPsqlFailure({ status, stderr }), category);
    const helper = new URL('../../ops/staging-backup/backup.mjs', import.meta.url).href;
    const child = 'process.stdout.write(' + JSON.stringify(diagnosticSentinel) + '); process.stderr.write(' + JSON.stringify(stderr) + '); process.exit(' + status + ')';
    // Exercise the real subprocess wrapper and public formatter in a separate
    // process: neither captured channel may escape, even on unknown failures.
    const harness = 'import {runQuiet,formatFailure,classifyPsqlFailure} from ' + JSON.stringify(helper) + ';' +
      'try { runQuiet(process.execPath,["-e",' + JSON.stringify(child) + '],{},"baseline-before",classifyPsqlFailure); }' +
      'catch(error) { console.error(formatFailure(error)); process.exitCode=1; }';
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', harness], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'SKYCAR_BACKUP_FAILURE phase=baseline-before category=' + category + '\n');
  });
}

test('malformed, oversized and successful results never imply a failure class', () => {
  for (const result of [null, {}, { status: 2, stderr: null }, { status: 2, stderr: Buffer.from(tlsDiagnostic) },
    { status: 2, stderr: tlsDiagnostic + ' '.repeat(16385) }, { status: 0, stderr: tlsDiagnostic },
    { status: null, stderr: tlsDiagnostic }]) {
    assert.equal(classifyPsqlFailure(result), 'command');
  }
});

test('classifier errors and non-allowlisted results remain generic and redacted', () => {
  for (const classifier of [() => diagnosticSentinel, () => { throw new Error(diagnosticSentinel); }]) {
    let error;
    try { runQuiet(process.execPath, ['-e', 'process.exit(2)'], {}, 'baseline-before', classifier); }
    catch (caught) { error = caught; }
    assert.equal(formatFailure(error), 'SKYCAR_BACKUP_FAILURE phase=baseline-before category=command');
  }
});

for (const phase of ['baseline-before', 'baseline-after']) {
  for (const [label, status, stderr, category] of diagnosticCases) {
    test(phase + ' ' + label + ' stops capture, publishes nothing and removes private files', () => {
      const temp = mkdtempSync(join(tmpdir(), 'backup-diagnostic-test-'));
      let work; let error; const calls = [];
      try {
        try {
          capture({ ...environment(), RUNNER_TEMP: temp }, (command, args, options, actualPhase, classifier) => {
            work = options.env.HOME;
            calls.push(actualPhase);
            const value = fakeCommand(command, args, options); // Also checks TLS/CA/read-only invariants.
            if (actualPhase.startsWith('baseline-')) assert.equal(classifier, classifyPsqlFailure);
            else assert.equal(classifier, undefined);
            if (actualPhase === phase) {
              assert.ok(args.includes(EMPTY_TARGET_SQL));
              const child = 'process.stdout.write(' + JSON.stringify(diagnosticSentinel) + '); process.stderr.write(' + JSON.stringify(stderr) + '); process.exit(' + status + ')';
              return runQuiet(process.execPath, ['-e', child], {}, actualPhase, classifier);
            }
            return value;
          });
        } catch (caught) { error = caught; }
        assert.equal(formatFailure(error), 'SKYCAR_BACKUP_FAILURE phase=' + phase + ' category=' + category);
        assert.equal(calls.at(-1), phase);
        assert.deepEqual(readdirSync(temp), []);
        assert.equal(existsSync(work), false);
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
}

function classifiedCapture({ mutateEnvironment, intercept, internal } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'backup-classification-test-'));
  let error;
  try {
    const e = { ...environment(), RUNNER_TEMP: temp };
    if (mutateEnvironment) mutateEnvironment(e);
    capture(e, (command, args, options, phase) => {
      if (intercept) {
        const value = intercept({ command, args, options, phase });
        if (value !== undefined) return value;
      }
      return fakeCommand(command, args, options);
    }, internal);
  } catch (caught) { error = caught; }
  const token = formatFailure(error);
  assert.deepEqual(readdirSync(temp), []);
  rmSync(temp, { recursive: true, force: true });
  return token;
}

test('representative capture failures are precisely classified without private values', () => {
  const privateSentinel = 'private-host password SQL key path sentinel';
  const results = [];
  results.push(classifiedCapture({ mutateEnvironment: e => { e.STAGING_SUPABASE_DB_HOST = privateSentinel; } }));
  results.push(classifiedCapture({ intercept: ({ phase }) => phase === 'toolchain' ? 'unexpected-version' : undefined }));
  let baselines = 0;
  results.push(classifiedCapture({ intercept: ({ args, phase }) => {
    if (phase.startsWith('baseline-') && args.includes(EMPTY_TARGET_SQL) && ++baselines === 1) return privateSentinel;
  } }));
  results.push(classifiedCapture({ intercept: ({ phase }) => phase === 'roles-script' ? privateSentinel : undefined }));
  results.push(classifiedCapture({ intercept: ({ phase }) => {
    if (phase === 'schema-export') throw new Error(privateSentinel);
  } }));
  results.push(classifiedCapture({ internal: { createRecoveryOracle: () => { throw new Error(privateSentinel); } } }));
  results.push(classifiedCapture({ internal: { encryptBundle: () => { throw new Error(privateSentinel); } } }));
  results.push(classifiedCapture({ internal: { writeOutput: () => { throw new Error(privateSentinel); } } }));
  assert.deepEqual(results, [
    'SKYCAR_BACKUP_FAILURE phase=configuration category=validation',
    'SKYCAR_BACKUP_FAILURE phase=toolchain category=validation',
    'SKYCAR_BACKUP_FAILURE phase=baseline-before category=validation',
    'SKYCAR_BACKUP_FAILURE phase=roles-script category=validation',
    'SKYCAR_BACKUP_FAILURE phase=schema-export category=unknown',
    'SKYCAR_BACKUP_FAILURE phase=oracle category=unknown',
    'SKYCAR_BACKUP_FAILURE phase=encryption category=unknown',
    'SKYCAR_BACKUP_FAILURE phase=output category=unknown',
  ]);
  assert.doesNotMatch(results.join('\n'), /private-host|password|SQL|key|path|sentinel/);
});

test('unknown exceptions collapse to the fixed unknown token and CLI emits no raw error', () => {
  assert.equal(formatFailure(new Error('private-sentinel')), 'SKYCAR_BACKUP_FAILURE phase=unknown category=unknown');
  const helper = fileURLToPath(new URL('../../ops/staging-backup/backup.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [helper, '--unsupported'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'SKYCAR_BACKUP_FAILURE phase=configuration category=validation\n');
});

test('workflow contract: manual protected backup, no raw artifact, secretless PR tests', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/staging-backup.yml', import.meta.url), 'utf8');
  const checks = readFileSync(new URL('../../.github/workflows/staging-backup-tests.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|workflow_run|repository_dispatch|contents: write/);
  assert.match(workflow, /environment: skycar-staging/);
  assert.match(workflow, /refs\/heads\/fix\/phone-test-delivery/);
  assert.match(workflow, /backup\.enc\.json/);
  const [beforeCapture, captureStep] = workflow.split('      - name: Capture encrypted read-only export');
  assert.doesNotMatch(beforeCapture, /STAGING_SUPABASE_DB_CA/);
  for (const name of ['STAGING_SUPABASE_DB_CA_CERT_B64', 'STAGING_SUPABASE_DB_CA_SHA256']) {
    assert.ok(captureStep.includes(name + ': ${{ secrets.' + name + ' }}'));
  }
  assert.doesNotMatch(workflow, /path:.*(\.sql|\*|\.log)/);
  assert.doesNotMatch(checks, /secrets\.|environment:/);
  assert.match(checks, /revision: \[head, integration\]/);
  for (const match of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(match[1], /@[a-f0-9]{40} /);
});
