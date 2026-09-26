import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI_VERSION,
  dumpPlan,
  encryptBundle,
  prepareDumpScript,
  runQuiet,
} from './backup.mjs';
import { decryptBundle } from './decrypt.mjs';
import {
  RECOVERY_MANIFEST_SQL,
  RECOVERY_ORACLE_NAME,
  canonical,
  createRecoveryOracle,
  parseManifest,
  parseRecoveryOracle,
  prepareRecoveryPlan,
  sha256,
  verifyRecoveredState,
} from './recovery-contract.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(scriptRoot, 'node_modules/.bin/supabase');

function databaseEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ''),
    PGSSLMODE: process.env.SKYCAR_RECOVERY_PGSSLMODE || 'disable',
    PGOPTIONS: '-c statement_timeout=180000',
  };
}

function query(databaseUrl, sql) {
  return runQuiet('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    env: databaseEnv(databaseUrl),
  }).trim();
}

export function databaseManifest(databaseUrl) {
  return parseManifest(query(databaseUrl, RECOVERY_MANIFEST_SQL));
}

function writeManifest(databaseUrl, output) {
  const value = databaseManifest(databaseUrl);
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${sha256(Buffer.from(JSON.stringify(value)))}\n`);
}

function addFixture(databaseUrl) {
  const note = 'synthetic Supabase compatibility sentinel';
  const digest = sha256(Buffer.from(note));
  const steps = [
    ['ROLE', 'CREATE ROLE skycar_recovery_fixture NOLOGIN;'],
    ['GRANT', 'GRANT skycar_recovery_fixture TO postgres;'],
    ['SCHEMA', 'CREATE SCHEMA skycar_recovery_fixture AUTHORIZATION skycar_recovery_fixture;'],
    ['TABLE', 'CREATE TABLE skycar_recovery_fixture.sentinel (id integer PRIMARY KEY, note text NOT NULL, digest text NOT NULL);'],
    ['OWNER', 'ALTER TABLE skycar_recovery_fixture.sentinel OWNER TO skycar_recovery_fixture;'],
    ['INSERT', `INSERT INTO skycar_recovery_fixture.sentinel (id, note, digest) VALUES (7, '${note}', '${digest}');`],
    ['REVOKE', 'REVOKE skycar_recovery_fixture FROM postgres;'],
  ];
  for (const [label, sql] of steps) {
    try { query(databaseUrl, sql); } catch { throw new Error(`FIXTURE_${label}_FAILED`); }
  }
}

function sentinel(databaseUrl) {
  return query(databaseUrl, "SELECT note || '|' || digest FROM skycar_recovery_fixture.sentinel WHERE id = 7;");
}

function rawFiles(directory) {
  return Object.fromEntries(['roles.sql', 'schema.sql', 'data.sql', RECOVERY_ORACLE_NAME]
    .map(name => [name, readFileSync(join(directory, name)).toString('base64')]));
}

function captureTest(databaseUrl, sourceBaselinePath, outputDirectory) {
  if (runQuiet(cli, ['--version']).trim() !== CLI_VERSION) throw new Error('CLI_VERSION_MISMATCH');
  const env = { ...databaseEnv(databaseUrl), CI: 'true', SUPABASE_TELEMETRY_DISABLED: 'true' };
  const sourceBaseline = parseManifest(JSON.parse(readFileSync(sourceBaselinePath, 'utf8')));
  const files = {};
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  for (const [name, args] of dumpPlan('postgresql://postgres:unused@localhost:5432/postgres')) {
    const script = prepareDumpScript(runQuiet(cli, args, { env }));
    const sql = runQuiet('bash', ['--noprofile', '--norc'], { input: script, env, cwd: outputDirectory });
    if (!sql.trim()) throw new Error(`EMPTY_${name}`);
    files[name] = Buffer.from(sql).toString('base64');
  }
  const dumpHashes = Object.entries(files).map(([name, value]) => ({ name, sha256: sha256(Buffer.from(value, 'base64')) }));
  const expectedState = databaseManifest(databaseUrl);
  const expectedSentinel = sentinel(databaseUrl);
  const pgDumpVersion = runQuiet('pg_dump', ['--version'], { env }).trim();
  const psqlVersion = runQuiet('psql', ['--version'], { env }).trim();
  const oracle = createRecoveryOracle({
    sourceBaseline,
    expectedState,
    expectedSentinel,
    dumpHashes,
    toolchain: { cliVersion: CLI_VERSION, pgDumpVersion, psqlVersion, serverVersion: sourceBaseline.serverVersion },
  });
  files[RECOVERY_ORACLE_NAME] = Buffer.from(`${JSON.stringify(oracle)}\n`).toString('base64');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const metadata = { files: Object.entries(files).map(([name, value]) => ({ name, sha256: sha256(Buffer.from(value, 'base64')) })) };
  const recovered = decryptBundle(encryptBundle(files, publicKey, metadata), privateKey);
  for (const [name, value] of Object.entries(recovered)) {
    writeFileSync(join(outputDirectory, name), Buffer.from(value, 'base64'), { mode: 0o600, flag: 'wx' });
  }
}

function prepare(recoveredDirectory, targetBaselinePath, outputDirectory) {
  const files = rawFiles(recoveredDirectory);
  const target = parseManifest(JSON.parse(readFileSync(targetBaselinePath, 'utf8')));
  const plan = prepareRecoveryPlan(files, target);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(outputDirectory, 'roles.restore.sql'), plan.rolesSql, { mode: 0o600, flag: 'wx' });
  writeFileSync(join(outputDirectory, 'owners.grant.sql'), plan.grantSql || '-- no temporary owner memberships\n', { mode: 0o600, flag: 'wx' });
  writeFileSync(join(outputDirectory, 'owners.revoke.sql'), plan.revokeSql || '-- no temporary owner memberships\n', { mode: 0o600, flag: 'wx' });
  writeFileSync(join(outputDirectory, 'plan.json'), `${JSON.stringify({
    recoveryContractVersion: plan.oracle.recoveryContractVersion,
    customOwners: plan.customOwners,
    terminalResetCount: plan.terminalResetCount,
    redundantParameterGrantCount: plan.redundantParameterGrantCount,
    sourceServerVersion: plan.oracle.sourceBaseline.serverVersion,
    targetServerVersion: target.serverVersion,
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ customOwnerCount: plan.customOwners.length,
    terminalResetCount: plan.terminalResetCount,
    redundantParameterGrantCount: plan.redundantParameterGrantCount })}\n`);
}

function verify(databaseUrl, recoveredDirectory, targetAfterPath) {
  const files = rawFiles(recoveredDirectory);
  const oracle = parseRecoveryOracle(files[RECOVERY_ORACLE_NAME], files);
  const target = databaseManifest(databaseUrl);
  verifyRecoveredState(oracle, target, oracle.expectedSentinel === null ? null : sentinel(databaseUrl));
  writeFileSync(targetAfterPath, `${JSON.stringify(target, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write(`${sha256(Buffer.from(JSON.stringify(canonical(target))))}\n`);
}

export function restoreLocal(databaseUrl, recoveredDirectory) {
  const url = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('RECOVERY_TARGET_NOT_LOOPBACK');
  const files = rawFiles(recoveredDirectory);
  const targetBefore = databaseManifest(databaseUrl);
  const plan = prepareRecoveryPlan(files, targetBefore);
  const env = databaseEnv(databaseUrl);
  const apply = sql => {
    if (!sql.trim() || /^-- no temporary owner memberships/.test(sql)) return;
    runQuiet('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, env });
  };
  apply(plan.rolesSql);
  let granted = false;
  let primaryError;
  try {
    granted = plan.customOwners.length > 0;
    apply(plan.grantSql);
    apply(Buffer.from(files['schema.sql'], 'base64').toString('utf8'));
    apply(Buffer.from(files['data.sql'], 'base64').toString('utf8'));
  } catch (error) {
    primaryError = error;
  } finally {
    if (granted) {
      try { apply(plan.revokeSql); } catch { throw new Error('RECOVERY_OWNER_MEMBERSHIP_REVOKE_FAILED'); }
    }
  }
  if (primaryError) throw primaryError;
  const targetAfter = databaseManifest(databaseUrl);
  verifyRecoveredState(plan.oracle, targetAfter, plan.oracle.expectedSentinel === null ? null : sentinel(databaseUrl));
  return {
    targetHash: sha256(Buffer.from(JSON.stringify(canonical(targetAfter)))),
    customOwnerCount: plan.customOwners.length,
    terminalResetCount: plan.terminalResetCount,
    redundantParameterGrantCount: plan.redundantParameterGrantCount,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'status-db') {
    const value = JSON.parse(readFileSync(args[0], 'utf8'));
    const url = value.DB_URL || value.db_url || value.database_url;
    if (!url || !/^postgresql?:\/\//.test(url)) throw new Error('LOCAL_DB_URL_MISSING');
    process.stdout.write(url);
  } else if (command === 'manifest') writeManifest(args[0], args[1]);
  else if (command === 'fixture') addFixture(args[0]);
  else if (command === 'capture-test') captureTest(args[0], args[1], args[2]);
  else if (command === 'prepare') prepare(args[0], args[1], args[2]);
  else if (command === 'verify') verify(args[0], args[1], args[2]);
  else if (command === 'restore-local') process.stdout.write(`${JSON.stringify(restoreLocal(args[0], args[1]))}\n`);
  else throw new Error('UNKNOWN_RECOVERY_COMMAND');
}
