import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_ORACLE_NAME,
  canonical,
  createRecoveryOracle,
  parseRecoveryOracle,
  prepareRecoveryPlan,
  sha256,
  verifyRecoveredState,
} from '../../ops/staging-backup/recovery-contract.mjs';

const privilege = { parameter: 'log_min_messages', grantee: 'supabase_admin', grantor: 'supabase_admin', privilege: 'SET', grantable: false };
function manifest(extra = {}) {
  return {
    serverVersion: '17.6.1', roles: [{ name: 'postgres', login: true, super: false, replication: false, bypassRls: false }],
    memberships: [], schemas: ['public'], extensions: [], parameterPrivileges: [privilege], providerObjects: [], customObjects: [],
    postgres17Boundary: { ltreeIndexes: 0, btreeGistFloatIndexes: 0, customEstimatorOperators: 0 }, ...extra,
  };
}

function fixture() {
  const raw = `SET default_transaction_read_only = off;\nCREATE ROLE "skycar_recovery_fixture";\nGRANT SET ON PARAMETER "log_min_messages" TO "supabase_admin";\nRESET ALL;\n`;
  const schema = `CREATE SCHEMA "skycar_recovery_fixture" AUTHORIZATION "skycar_recovery_fixture";\nCREATE TABLE "skycar_recovery_fixture"."sentinel" (id integer);\nALTER TABLE "skycar_recovery_fixture"."sentinel" OWNER TO "skycar_recovery_fixture";\n`;
  const files = { 'roles.sql': Buffer.from(raw).toString('base64'), 'schema.sql': Buffer.from(schema).toString('base64'), 'data.sql': Buffer.from('COPY synthetic').toString('base64') };
  const dumpHashes = Object.entries(files).map(([name, value]) => ({ name, sha256: sha256(Buffer.from(value, 'base64')) }));
  const expected = manifest({
    roles: [...manifest().roles, { name: 'skycar_recovery_fixture', login: false, super: false, replication: false, bypassRls: false }],
    schemas: ['public', 'skycar_recovery_fixture'],
    customObjects: [
      { kind: 'r', schema: 'skycar_recovery_fixture', name: 'sentinel', owner: 'skycar_recovery_fixture' },
      { kind: 'schema', schema: 'skycar_recovery_fixture', name: 'skycar_recovery_fixture', owner: 'skycar_recovery_fixture' },
    ],
  });
  const oracle = createRecoveryOracle({
    sourceBaseline: manifest(), expectedState: expected, dumpHashes,
    expectedSentinel: 'synthetic|digest',
    toolchain: { cliVersion: '2.117.0', pgDumpVersion: 'pg_dump (PostgreSQL) 17.11', psqlVersion: 'psql (PostgreSQL) 17.11', serverVersion: '17.6.1' },
  });
  files[RECOVERY_ORACLE_NAME] = Buffer.from(JSON.stringify(oracle)).toString('base64');
  return { files, oracle, expected };
}

test('previous three-file packet is rejected because recovery oracle is mandatory', () => {
  const { files } = fixture();
  delete files[RECOVERY_ORACLE_NAME];
  assert.throws(() => parseRecoveryOracle(files[RECOVERY_ORACLE_NAME], files), /RECOVERY_ORACLE_INVALID/);
});

test('plan derives only reviewed managed-role omissions and temporary exact-owner membership', () => {
  const { files } = fixture();
  const plan = prepareRecoveryPlan(files, manifest());
  assert.doesNotMatch(plan.rolesSql, /GRANT SET ON PARAMETER/);
  assert.doesNotMatch(plan.rolesSql, /RESET ALL/);
  assert.match(plan.rolesSql, /CREATE ROLE "skycar_recovery_fixture"/);
  assert.equal(plan.grantSql, 'GRANT "skycar_recovery_fixture" TO "postgres";\n');
  assert.equal(plan.revokeSql, 'REVOKE "skycar_recovery_fixture" FROM "postgres";\n');
  assert.deepEqual(plan.customOwners, ['skycar_recovery_fixture']);
});

test('plan fails closed on target version, extension or parameter baseline drift', () => {
  const { files } = fixture();
  assert.throws(() => prepareRecoveryPlan(files, manifest({ serverVersion: '17.11' })), /FRESH_BASELINES_DIFFER/);
  assert.throws(() => prepareRecoveryPlan(files, manifest({ extensions: [{ name: 'ltree', version: '1.3', schema: 'extensions' }] })), /FRESH_BASELINES_DIFFER/);
  assert.throws(() => prepareRecoveryPlan(files, manifest({ parameterPrivileges: [] })), /FRESH_BASELINES_DIFFER/);
});

test('oracle authenticates raw dumps and expected recovered state including sentinel', () => {
  const { files, oracle, expected } = fixture();
  assert.doesNotThrow(() => parseRecoveryOracle(files[RECOVERY_ORACLE_NAME], files));
  assert.deepEqual(verifyRecoveredState(oracle, expected, 'synthetic|digest'), canonical(expected));
  assert.throws(() => verifyRecoveredState(oracle, expected, 'changed'), /SENTINEL/);
  const damaged = structuredClone(files);
  damaged['data.sql'] = Buffer.from('changed').toString('base64');
  assert.throws(() => parseRecoveryOracle(damaged[RECOVERY_ORACLE_NAME], damaged), /RAW_DUMP_HASH/);
});
