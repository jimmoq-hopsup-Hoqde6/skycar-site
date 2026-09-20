// Run after garage.postgres.mjs against the same disposable local PostgreSQL server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const url = new URL(process.env.GARAGE_TEST_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/garage_test') throw new Error('Only a disposable local garage_test database is allowed.');
const pg = await import(pathToFileURL(process.env.GARAGE_PG_MODULE).href);
const { Client } = pg.default ?? pg;
const connections = [];
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function connect(actor) {
  const client = new Client({ connectionString: url.toString() });
  await client.connect(); connections.push(client);
  await client.query("set statement_timeout = '10s'");
  if (actor) {
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await client.query('set role authenticated');
  }
  return client;
}
async function mutate(client, command, id, payload, key = randomUUID()) {
  const result = await client.query('select public.garage_mutate_vehicle($1,$2,$3::jsonb,$4,$5) as result', [command, id, JSON.stringify(payload), key, randomUUID()]);
  return result.rows[0].result;
}
try {
  const root = await connect();
  const owner = randomUUID(), other = randomUUID();
  await root.query('insert into auth.users(id) values ($1),($2)', [owner, other]);
  const first = await connect(owner), second = await connect(owner), stranger = await connect(other);
  const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
  async function waitForLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await root.query("select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting", [secondPid]);
      if (result.rows[0].waiting) { checks++; return; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Expected the competing connection to wait for a database lock.');
  }
  const input = { make: 'Toyota', model: 'Corolla', variant: null, year: 2020, registration: null, registration_state: null };
  const key = randomUUID();
  await first.query('begin');
  const original = await mutate(first, 'create', null, input, key);
  const retry = mutate(second, 'create', null, input, key).then(result => ({ result }), error => ({ error }));
  await waitForLock(); await first.query('commit');
  const retried = await retry;
  check(!retried.error && retried.result.id === original.id, 'concurrent create replays the same vehicle');
  check((await root.query('select count(*)::int as n from public.vehicles where owner_id=$1', [owner])).rows[0].n === 1, 'concurrent create commits once');

  await first.query('begin');
  const updated = await mutate(first, 'update', original.id, { ...input, model: 'Winner', expected_revision: 1 });
  const stale = mutate(second, 'update', original.id, { ...input, model: 'Loser', expected_revision: 1 }).then(result => ({ result }), error => ({ error }));
  await waitForLock(); await first.query('commit');
  check((await stale).error?.message === 'REVISION_CONFLICT', 'simultaneous stale update rejected after lock release');
  check(updated.revision === 2 && (await first.query('select model from public.vehicles where id=$1', [original.id])).rows[0].model === 'Winner', 'successful update is not overwritten');

  await first.query('begin');
  await mutate(first, 'archive', original.id, { expected_revision: 2 });
  const lateEdit = mutate(second, 'update', original.id, { ...input, expected_revision: 2 }).then(result => ({ result }), error => ({ error }));
  await waitForLock(); await first.query('commit');
  check((await lateEdit).error?.message === 'VEHICLE_ARCHIVED', 'archive wins over a concurrent edit');
  await assert.rejects(() => mutate(stranger, 'archive', original.id, { expected_revision: 3 }), error => error.message === 'NOT_FOUND'); checks++;
  check((await root.query('select count(*)::int as n from public.vehicle_history where vehicle_id=$1', [original.id])).rows[0].n === 3, 'only committed create/update/archive write history');
  check((await root.query('select count(*)::int as n from public.audit_events where resource_id=$1', [original.id])).rows[0].n === 3, 'failed concurrent mutations do not write audit records');
  console.log(`PASS: ${checks} independent-session PostgreSQL concurrency checks. Auth/storage are test stubs, not live Supabase.`);
} finally {
  // Roll back holders before closing competing clients if an assertion failed.
  for (const client of connections) { try { await client.query('rollback'); } catch { /* connection may already be closed */ } }
  await Promise.all(connections.map(client => client.end()));
}
