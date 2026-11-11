import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalIntegrationDatabase } from '../integration/local-integration-database.mjs';
import { installLegacySunsetTestClock } from '../integration/legacy-sunset-test-clock.mjs';

const local = 'postgresql://postgres:disposable@127.0.0.1:5432/skycar_integration_test';
const refuses = (database, env = {}) => assert.throws(() => assertLocalIntegrationDatabase(database, env), /Refusing database tests/);

test('the disposable-database guard accepts explicit local PostgreSQL client URLs', () => {
  for (const database of [local, local.replace('127.0.0.1', 'localhost'), local.replace('postgresql:', 'postgres:')]) {
    assert.equal(assertLocalIntegrationDatabase(database, {}), database);
  }
});

test('the disposable-database guard rejects missing, remote, wrong-database and non-PostgreSQL URLs', () => {
  for (const database of [undefined, '', 'not a URL', local.replace('127.0.0.1', 'db.example.com'),
    local.replace('127.0.0.1', '172.18.0.2'), local.replace('skycar_integration_test', 'production'),
    local.replace('postgresql:', 'https:'), `${local}#fragment`]) refuses(database);
});

test('a local-looking URI cannot override libpq routing or the disposable database', () => {
  for (const query of ['host=db.example.com', 'hostaddr=203.0.113.1', 'dbname=production', 'service=production',
    'host=127.0.0.1&host=db.example.com', 'sslmode=disable']) refuses(`${local}?${query}`);
  refuses(local, { PGHOSTADDR: '203.0.113.1' });
  refuses(local, { PGSERVICE: 'production' });
});

test('the clock seam allows a forwarded local connection without requiring a loopback server interface', () => {
  const reachedDefinition = new Error('reached function verification');
  const statements = [];
  const sql = statement => {
    statements.push(statement);
    if (statement === 'select current_database()') return 'skycar_integration_test';
    // Docker's non-loopback server address caused the old guard to fail here.
    if (statement.includes('inet_server_addr()')) return 'f';
    throw reachedDefinition;
  };
  assert.throws(() => installLegacySunsetTestClock({ database: local, sql, quote: value => `'${value}'` }), error => error === reachedDefinition);
  assert.equal(statements.length, 2);
  assert.match(statements[1], /pg_get_functiondef/);
});

test('the clock seam refuses an unsafe URL before any SQL and verifies the actual database name', () => {
  assert.throws(() => installLegacySunsetTestClock({ database: local.replace('127.0.0.1', 'db.example.com'),
    sql: () => assert.fail('unsafe URL must be rejected before SQL'), quote: String }), /Refusing database tests/);
  const statements = [];
  assert.throws(() => installLegacySunsetTestClock({ database: local,
    sql: statement => { statements.push(statement); return 'production'; }, quote: String }), /test seam requires the disposable integration database/);
  assert.deepEqual(statements, ['select current_database()']);
});
