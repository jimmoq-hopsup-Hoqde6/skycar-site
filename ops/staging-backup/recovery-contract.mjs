import { createHash } from 'node:crypto';

export const ARCHIVE_FORMAT = 'skycar-backup-v2';
export const RECOVERY_CONTRACT_VERSION = 2;
export const RECOVERY_ORACLE_VERSION = 1;
export const RECOVERY_ORACLE_NAME = 'recovery-oracle.json';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export const RECOVERY_MANIFEST_SQL = String.raw`
SELECT jsonb_build_object(
  'serverVersion', current_setting('server_version'),
  'roles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'name', rolname, 'login', rolcanlogin, 'super', rolsuper,
    'replication', rolreplication, 'bypassRls', rolbypassrls
  ) ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'), '[]'::jsonb),
  'memberships', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'role', role_name.rolname, 'member', member_name.rolname,
    'grantor', grantor_name.rolname, 'admin', m.admin_option,
    'inherit', m.inherit_option, 'set', m.set_option
  ) ORDER BY role_name.rolname, member_name.rolname, grantor_name.rolname)
    FROM pg_auth_members m
    JOIN pg_roles role_name ON role_name.oid = m.roleid
    JOIN pg_roles member_name ON member_name.oid = m.member
    JOIN pg_roles grantor_name ON grantor_name.oid = m.grantor), '[]'::jsonb),
  'schemas', COALESCE((SELECT jsonb_agg(nspname ORDER BY nspname)
    FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'), '[]'::jsonb),
  'extensions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'name', e.extname, 'version', e.extversion, 'schema', n.nspname
  ) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace), '[]'::jsonb),
  'parameterPrivileges', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'parameter', p.parname, 'grantee', grantee.rolname,
    'grantor', grantor.rolname, 'privilege', acl.privilege_type,
    'grantable', acl.is_grantable
  ) ORDER BY p.parname, grantee.rolname, grantor.rolname, acl.privilege_type)
    FROM pg_parameter_acl p
    CROSS JOIN LATERAL aclexplode(p.paracl) acl
    JOIN pg_roles grantee ON grantee.oid = acl.grantee
    JOIN pg_roles grantor ON grantor.oid = acl.grantor), '[]'::jsonb),
  'providerObjects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'kind', c.relkind
  ) ORDER BY n.nspname, c.relname, c.relkind)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('auth', 'storage', 'realtime')), '[]'::jsonb),
  'customObjects', COALESCE((SELECT jsonb_agg(value ORDER BY value::text) FROM (
    SELECT jsonb_build_object('kind', 'schema', 'schema', n.nspname,
      'name', n.nspname, 'owner', pg_get_userbyid(n.nspowner)) AS value
    FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN
      ('information_schema', 'auth', 'storage', 'realtime', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer', 'pgsodium', 'pgsodium_masks', 'realtime', 'supabase_functions', 'vault')
    UNION ALL
    SELECT jsonb_build_object('kind', c.relkind, 'schema', n.nspname,
      'name', c.relname, 'owner', pg_get_userbyid(c.relowner)) AS value
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN
      ('information_schema', 'auth', 'storage', 'realtime', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer', 'pgsodium', 'pgsodium_masks', 'supabase_functions', 'vault')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) custom), '[]'::jsonb),
  'postgres17Boundary', jsonb_build_object(
    'ltreeIndexes', (SELECT count(*) FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL unnest(i.indclass::oid[]) opclass ON true
      JOIN pg_opclass oc ON oc.oid = opclass
      JOIN pg_type t ON t.oid = oc.opcintype
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND t.typname IN ('ltree', '_ltree')),
    'btreeGistFloatIndexes', (SELECT count(*) FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_am am ON am.oid = c.relam
      JOIN LATERAL unnest(i.indclass::oid[]) opclass ON true
      JOIN pg_opclass oc ON oc.oid = opclass
      JOIN pg_type t ON t.oid = oc.opcintype
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND am.amname = 'gist' AND t.typname IN ('float4', 'float8')),
    'customEstimatorOperators', (SELECT count(*) FROM pg_operator o
      JOIN pg_namespace n ON n.oid = o.oprnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND ((o.oprrest <> 0 AND o.oprrest::oid >= 10000)
          OR (o.oprjoin <> 0 AND o.oprjoin::oid >= 10000))
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_operator'::regclass AND d.objid = o.oid AND d.deptype = 'e'))
  )
);`;

const requiredManifestArrays = ['roles', 'memberships', 'schemas', 'extensions', 'parameterPrivileges', 'providerObjects', 'customObjects'];

export function parseManifest(value) {
  const manifest = canonical(typeof value === 'string' ? JSON.parse(value) : value);
  if (!manifest || typeof manifest.serverVersion !== 'string' || !manifest.postgres17Boundary) throw new Error('RECOVERY_MANIFEST_INVALID');
  for (const field of requiredManifestArrays) if (!Array.isArray(manifest[field])) throw new Error('RECOVERY_MANIFEST_INVALID');
  for (const field of ['ltreeIndexes', 'btreeGistFloatIndexes', 'customEstimatorOperators']) {
    if (!Number.isInteger(Number(manifest.postgres17Boundary[field]))) throw new Error('RECOVERY_MANIFEST_INVALID');
  }
  return manifest;
}

function hashesMatch(files, hashes) {
  if (!Array.isArray(hashes) || hashes.length !== 3) return false;
  const expected = new Map(hashes.map(item => [item.name, item.sha256]));
  return ['roles.sql', 'schema.sql', 'data.sql'].every(name =>
    typeof files[name] === 'string' && expected.get(name) === sha256(Buffer.from(files[name], 'base64')));
}

export function createRecoveryOracle({ sourceBaseline, expectedState, toolchain, dumpHashes, expectedSentinel = null }) {
  const baseline = parseManifest(sourceBaseline);
  const expected = parseManifest(expectedState);
  if (!toolchain || !/^2\.117\.0$/.test(toolchain.cliVersion || '') ||
      !/^pg_dump \(PostgreSQL\) 17\./.test(toolchain.pgDumpVersion || '') ||
      !/^psql \(PostgreSQL\) 17\./.test(toolchain.psqlVersion || '') ||
      typeof toolchain.serverVersion !== 'string') throw new Error('RECOVERY_TOOLCHAIN_INVALID');
  if (!Array.isArray(dumpHashes) || dumpHashes.length !== 3) throw new Error('RECOVERY_DUMP_HASHES_INVALID');
  return canonical({
    oracleVersion: RECOVERY_ORACLE_VERSION,
    recoveryContractVersion: RECOVERY_CONTRACT_VERSION,
    sourceBaseline: baseline,
    expectedState: expected,
    toolchain,
    dumpHashes,
    expectedSentinel,
    postgres17Boundary: 'Supabase 2026-09-25 PostgreSQL 17.11 extension/operator checks required; version or baseline mismatch stops recovery',
  });
}

export function parseRecoveryOracle(bytes, files) {
  let oracle;
  try { oracle = JSON.parse(Buffer.from(bytes, 'base64').toString('utf8')); } catch { throw new Error('RECOVERY_ORACLE_INVALID'); }
  if (oracle?.oracleVersion !== RECOVERY_ORACLE_VERSION || oracle?.recoveryContractVersion !== RECOVERY_CONTRACT_VERSION) throw new Error('RECOVERY_ORACLE_VERSION_UNSUPPORTED');
  oracle.sourceBaseline = parseManifest(oracle.sourceBaseline);
  oracle.expectedState = parseManifest(oracle.expectedState);
  if (!hashesMatch(files, oracle.dumpHashes)) throw new Error('RECOVERY_RAW_DUMP_HASH_MISMATCH');
  if (typeof oracle.postgres17Boundary !== 'string' || !oracle.postgres17Boundary.includes('17.11')) throw new Error('RECOVERY_BOUNDARY_MISSING');
  return canonical(oracle);
}

function decodeIdentifier(value) { return value.replaceAll('""', '"'); }
function quoteIdentifier(value) { return `"${value.replaceAll('"', '""')}"`; }

export function adaptRoles(raw, sourceValue, targetValue) {
  const source = parseManifest(sourceValue);
  const target = parseManifest(targetValue);
  if (JSON.stringify(source) !== JSON.stringify(target)) throw new Error('FRESH_BASELINES_DIFFER');
  const baseline = new Set(target.parameterPrivileges.map(item => JSON.stringify([
    item.parameter, item.grantee, item.privilege, item.grantable,
  ])));
  const lines = raw.split(/\r?\n/);
  let terminalResetCount = 0;
  let redundantParameterGrantCount = 0;
  const restored = [];
  for (const [index, line] of lines.entries()) {
    if (/^RESET ALL;$/.test(line)) {
      if (index !== lines.length - 2 || lines.at(-1) !== '') throw new Error('ROLES_RESET_NOT_TERMINAL');
      terminalResetCount += 1;
      continue;
    }
    const grant = line.match(/^GRANT SET ON PARAMETER "((?:[^"]|"")+)" TO "((?:[^"]|"")+)"( WITH GRANT OPTION)?;$/);
    if (grant) {
      const key = JSON.stringify([decodeIdentifier(grant[1]), decodeIdentifier(grant[2]), 'SET', Boolean(grant[3])]);
      if (baseline.has(key)) { redundantParameterGrantCount += 1; continue; }
    }
    restored.push(line);
  }
  if (terminalResetCount !== 1 || redundantParameterGrantCount < 1) throw new Error('ROLES_MANAGED_ADAPTATION_CONTRACT_CHANGED');
  return { sql: restored.join('\n'), terminalResetCount, redundantParameterGrantCount };
}

function schemaOwners(schemaSql) {
  const values = new Set();
  for (const match of schemaSql.matchAll(/\b(?:AUTHORIZATION|OWNER TO)\s+"((?:[^"]|"")+)"\s*;/g)) values.add(decodeIdentifier(match[1]));
  return [...values].sort();
}

export function prepareRecoveryPlan(files, targetValue, recoveryRole = 'postgres') {
  const oracle = parseRecoveryOracle(files[RECOVERY_ORACLE_NAME], files);
  const target = parseManifest(targetValue);
  const roles = adaptRoles(Buffer.from(files['roles.sql'], 'base64').toString('utf8'), oracle.sourceBaseline, target);
  const schemaSql = Buffer.from(files['schema.sql'], 'base64').toString('utf8');
  const baselineRoles = new Set(target.roles.map(item => item.name));
  const expectedRoles = new Set(oracle.expectedState.roles.map(item => item.name));
  const customOwners = schemaOwners(schemaSql).filter(owner => owner !== recoveryRole && !baselineRoles.has(owner));
  for (const owner of customOwners) if (!expectedRoles.has(owner)) throw new Error('RECOVERY_OWNER_NOT_IN_ORACLE');
  const grantSql = customOwners.map(owner => `GRANT ${quoteIdentifier(owner)} TO ${quoteIdentifier(recoveryRole)};`).join('\n');
  const revokeSql = [...customOwners].reverse().map(owner => `REVOKE ${quoteIdentifier(owner)} FROM ${quoteIdentifier(recoveryRole)};`).join('\n');
  return { oracle, rolesSql: roles.sql, grantSql: `${grantSql}${grantSql ? '\n' : ''}`, revokeSql: `${revokeSql}${revokeSql ? '\n' : ''}`, customOwners,
    terminalResetCount: roles.terminalResetCount, redundantParameterGrantCount: roles.redundantParameterGrantCount };
}

export function verifyRecoveredState(oracleValue, targetValue, sentinelValue = null) {
  const oracle = canonical(oracleValue);
  const target = parseManifest(targetValue);
  if (JSON.stringify(oracle.expectedState) !== JSON.stringify(target)) throw new Error('RECOVERED_STATE_MISMATCH');
  if (oracle.expectedSentinel !== null && oracle.expectedSentinel !== sentinelValue) throw new Error('RECOVERED_SENTINEL_MISMATCH');
  return target;
}
