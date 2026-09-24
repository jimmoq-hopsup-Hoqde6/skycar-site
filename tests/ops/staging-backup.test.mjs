import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPLICATION_SHA, CLI_VERSION, validateGate, validateConfig, dumpPlan, prepareDumpScript, encryptBundle, capture, runQuiet } from '../../ops/staging-backup/backup.mjs';
import { decryptBundle } from '../../ops/staging-backup/decrypt.mjs';

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
    assert.throws(() => capture({ ...environment(), [name]: value }, () => { calls++; }), /BACKUP_GATE_REJECTED/);
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
  const metadata = { files: Object.entries(files).map(([name, bytes]) => ({ name, sha256: createHash('sha256').update(Buffer.from(bytes, 'base64')).digest('hex') })) };
  return { files, metadata };
}

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
  assert.throws(() => decryptBundle(encryptBundle({ '../escape': 'eA==' }, publicKey, {}), privateKey), /inventory/);
});

function fakeCommand(command, args, options) {
  if (args[0] === '--version') return command === 'pg_dump' ? 'pg_dump (PostgreSQL) 17.6' : CLI_VERSION;
  assert.equal(options.env.PGSSLMODE, 'verify-full');
  assert.equal(options.env.PGSSLROOTCERT, '/etc/ssl/certs/ca-certificates.crt');
  assert.match(options.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.ok(!('STAGING_SUPABASE_DB_PASSWORD' in options.env));
  if (command === 'psql') {
    assert.equal(options.env.PGPASSWORD, environment().STAGING_SUPABASE_DB_PASSWORD);
    assert.ok(!args.includes(options.env.PGPASSWORD));
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
      workingDirectory = options.cwd || workingDirectory;
      return fakeCommand(command, args, options);
    });
    assert.deepEqual(readdirSync(output), ['backup.enc.json']);
    assert.equal(existsSync(workingDirectory), false);
    const bytes = readFileSync(join(output, 'backup.enc.json'), 'utf8');
    assert.ok(!bytes.includes('SELECT 1'));
    const envelope = JSON.parse(bytes);
    assert.equal(envelope.header.restoreStatus, 'NOT_RUN');
    assert.equal(envelope.header.storageObjects, 'NOT_INCLUDED');
    assert.equal(Object.keys(decryptBundle(envelope, privateKey)).length, 3);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

for (const failure of ['roles', 'schema', 'data', 'empty', 'version', 'nonempty-before', 'nonempty-after']) {
  test(`failure ${failure} publishes nothing and removes temporary SQL`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'backup-test-'));
    let dump = 0; let work; let probes = 0;
    try {
      assert.throws(() => capture({ ...environment(), RUNNER_TEMP: temp }, (command, args, options) => {
        work = options.cwd || work;
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

test('command errors never return child diagnostics', () => {
  assert.throws(() => runQuiet(process.execPath, ['-e', "console.error('private-sentinel'); process.exit(1)"]), /^Error: BACKUP_COMMAND_FAILED$/);
});

test('workflow contract: manual protected backup, no raw artifact, secretless PR tests', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/staging-backup.yml', import.meta.url), 'utf8');
  const checks = readFileSync(new URL('../../.github/workflows/staging-backup-tests.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request|workflow_run|repository_dispatch|contents: write/);
  assert.match(workflow, /environment: skycar-staging/);
  assert.match(workflow, /refs\/heads\/fix\/phone-test-delivery/);
  assert.match(workflow, /backup\.enc\.json/);
  assert.doesNotMatch(workflow, /path:.*(\.sql|\*|\.log)/);
  assert.doesNotMatch(checks, /secrets\.|environment:/);
  assert.match(checks, /revision: \[head, integration\]/);
  for (const match of workflow.matchAll(/uses: ([^\n]+)/g)) assert.match(match[1], /@[a-f0-9]{40} /);
});
