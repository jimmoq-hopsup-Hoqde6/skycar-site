import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { promisify } from "node:util";

const database = process.env.GARAGE_CARE_TEST_DATABASE_URL;
if (!database) {
  throw new Error("GARAGE_CARE_TEST_DATABASE_URL is required; use a fresh disposable PostgreSQL database.");
}
const url = new URL(database);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/skycar_integration_test') {
  throw new Error('Refusing database tests: only local disposable skycar_integration_test is permitted.');
}

const psqlArgs = [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = statement => execFileSync('psql', [...psqlArgs, '-c', statement], { encoding: 'utf8' }).trim();
const run = async statement => (await promisify(execFile)('psql', [...psqlArgs, '-c', statement], { encoding: 'utf8' })).stdout.trim();
const file = path => execFileSync('psql', [...psqlArgs, '-f', path], { encoding: 'utf8' });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stranger = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let checks = 0;

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function auth(actor, statement) {
  return `begin; set local role authenticated; set local request.jwt.claim.sub = ${quote(actor)}; ${statement}; commit;`;
}

function garagePayload(model, revision) {
  const value = {
    make: 'Toyota', model, variant: null, year: 2022,
    registration: null, registration_state: null,
  };
  if (revision !== undefined) value.expected_revision = revision;
  return JSON.stringify(value);
}

function carePayload(vehicleId, service = 'repair') {
  return JSON.stringify({
    vehicle_id: vehicleId,
    service,
    description: service === 'repair' ? 'Scratch on rear bumper' : 'Interior cleaning request',
    preferred_window: 'flexible',
  });
}

function garageCreate(actor, key, model) {
  return JSON.parse(sql(auth(actor,
    `select public.garage_mutate_vehicle('create',null,${quote(garagePayload(model))}::jsonb,${quote(key)}::uuid,gen_random_uuid())`,
  )).split('\n')[0]);
}

function expectSqlError(statement, expected) {
  assert.throws(() => sql(statement), error => {
    const output = `${error.message}\n${error.stderr ?? ''}\n${error.stdout ?? ''}`;
    return output.includes(expected);
  }, `expected PostgreSQL error ${expected}`);
  checks++;
}

async function result(statement) {
  try { return { value: await run(statement) }; }
  catch (error) { return { error, output: `${error.message}\n${error.stderr ?? ''}\n${error.stdout ?? ''}` }; }
}

async function waitForQuery(tag) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql(`select count(*) from pg_stat_activity where pid <> pg_backend_pid() and query like ${quote(`%${tag}%`)}`) !== '0') {
      checks++;
      return;
    }
    await wait(20);
  }
  throw new Error(`Timed out waiting for transaction ${tag}`);
}

before(() => {
  assert.equal(sql("select count(*) from information_schema.tables where table_schema='public'"), '0', 'must be an empty database');
  file('tests/integration/bootstrap.sql');
  const migrations = readdirSync('supabase/migrations')
    .filter(name => name.endsWith('.sql'))
    .sort();
  assert.deepEqual(migrations, [
    '202609200001_foundation.sql',
    '202609200002_care_requests.sql',
    '202609200003_care_my_jobs.sql',
    '202609200100_garage_mutations.sql',
  ], 'combined verification must include every public migration in filename order');
  for (const migration of migrations) file(`supabase/migrations/${migration}`);
  sql(`insert into auth.users(id) values (${quote(owner)}),(${quote(stranger)}); insert into public.care_response_policy values (true,60,30);`);
});

test('combined Garage and Care migrations preserve ownership, history, retries, races and atomic writes', async () => {
  const vehicleKey = '10000000-0000-4000-8000-000000000001';
  const careKey = '20000000-0000-4000-8000-000000000001';
  const vehicle = garageCreate(owner, vehicleKey, 'Primary');
  assert.equal(vehicle.revision, 1); checks++;
  assert.equal(sql(auth(stranger, `select count(*) from public.vehicles where id=${quote(vehicle.id)}::uuid`)).split('\n')[0], '0'); checks++;
  expectSqlError(auth(stranger,
    `select public.garage_mutate_vehicle('update',${quote(vehicle.id)}::uuid,${quote(garagePayload('Stolen', 1))}::jsonb,gen_random_uuid(),gen_random_uuid())`,
  ), 'NOT_FOUND');

  const submitted = JSON.parse(sql(auth(owner,
    `select public.care_submit_request(${quote(careKey)}::uuid,${quote(carePayload(vehicle.id))}::jsonb)`,
  )).split('\n')[0]);
  const requestId = submitted.request.id;
  assert.equal(submitted.replayed, false); checks++;
  assert.equal(submitted.request.customer_stage, 'request_received'); checks++;
  const detail = JSON.parse(sql(auth(owner, `select public.care_get_request(${quote(requestId)}::uuid)`)).split('\n')[0]);
  const list = JSON.parse(sql(auth(owner, 'select public.care_list_requests()')).split('\n')[0]);
  assert.equal(detail.id, requestId); checks++;
  assert.equal(list.items[0].id, requestId); checks++;
  assert.equal(list.items[0].vehicle_archived, false); checks++;
  assert.equal(sql(`select count(*) from public.vehicle_history where vehicle_id=${quote(vehicle.id)}::uuid`), '1'); checks++;
  assert.equal(sql(`select count(*) from public.care_request_events where request_id=${quote(requestId)}::uuid`), '1'); checks++;
  assert.equal(sql(`select count(*) from public.care_notification_outbox where request_id=${quote(requestId)}::uuid`), '1'); checks++;
  assert.equal(sql(`select count(*) from public.audit_events where resource_id in (${quote(vehicle.id)},${quote(requestId)})`), '2'); checks++;

  const replay = JSON.parse(sql(auth(owner,
    `select public.care_submit_request(${quote(careKey)}::uuid,${quote(carePayload(vehicle.id))}::jsonb)`,
  )).split('\n')[0]);
  assert.equal(replay.replayed, true); checks++;
  assert.equal(replay.request.id, requestId); checks++;
  assert.equal(sql(`select count(*) from public.care_request_events where request_id=${quote(requestId)}::uuid`), '1'); checks++;
  expectSqlError(auth(owner,
    `select public.care_submit_request(${quote(careKey)}::uuid,${quote(carePayload(vehicle.id, 'cleaning'))}::jsonb)`,
  ), 'IDEMPOTENCY_CONFLICT');

  expectSqlError(auth(owner, `update public.vehicles set model='Bypass' where id=${quote(vehicle.id)}::uuid`), 'permission denied');
  expectSqlError(auth(owner, `insert into public.vehicle_history(vehicle_id,event_type,occurred_at,source) values (${quote(vehicle.id)}::uuid,'forged',now(),'client')`), 'permission denied');
  expectSqlError(auth(owner, `update public.care_requests set customer_stage='no_match' where id=${quote(requestId)}::uuid`), 'permission denied');
  expectSqlError(auth(owner, `insert into public.care_request_events(request_id,sequence,type,occurred_at) values (${quote(requestId)}::uuid,2,'no_match',now())`), 'permission denied');
  expectSqlError(auth(stranger, `select public.care_get_request(${quote(requestId)}::uuid)`), 'NOT_FOUND');
  const strangerList = JSON.parse(sql(auth(stranger, 'select public.care_list_requests()')).split('\n')[0]);
  assert.deepEqual(strangerList.items, []); checks++;

  const archiveKey = '10000000-0000-4000-8000-000000000002';
  const archived = JSON.parse(sql(auth(owner,
    `select public.garage_mutate_vehicle('archive',${quote(vehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,${quote(archiveKey)}::uuid,gen_random_uuid())`,
  )).split('\n')[0]);
  assert.equal(archived.revision, 2); checks++;
  assert.ok(archived.archived_at); checks++;
  assert.equal(JSON.parse(sql(auth(owner, 'select public.care_list_requests()')).split('\n')[0]).items[0].vehicle_archived, true); checks++;
  assert.equal(JSON.parse(sql(auth(owner, `select public.care_get_request(${quote(requestId)}::uuid)`)).split('\n')[0]).id, requestId); checks++;
  assert.equal(JSON.parse(sql(auth(owner,
    `select public.care_submit_request(${quote(careKey)}::uuid,${quote(carePayload(vehicle.id))}::jsonb)`,
  )).split('\n')[0]).replayed, true); checks++;
  expectSqlError(auth(owner,
    `select public.care_submit_request(gen_random_uuid(),${quote(carePayload(vehicle.id))}::jsonb)`,
  ), 'NOT_FOUND');

  const vehicleCount = Number(sql('select count(*) from public.vehicles'));
  const historyCount = Number(sql('select count(*) from public.vehicle_history'));
  const garageCommandCount = Number(sql('select count(*) from public.garage_mutations'));
  sql("create function public.test_combined_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end $$; create trigger test_combined_audit_failure before insert on public.audit_events for each row execute function public.test_combined_audit_failure();");
  expectSqlError(auth(owner,
    `select public.garage_mutate_vehicle('create',null,${quote(garagePayload('Rollback'))}::jsonb,gen_random_uuid(),gen_random_uuid())`,
  ), 'TEST_AUDIT_FAILURE');
  assert.equal(Number(sql('select count(*) from public.vehicles')), vehicleCount); checks++;
  assert.equal(Number(sql('select count(*) from public.vehicle_history')), historyCount); checks++;
  assert.equal(Number(sql('select count(*) from public.garage_mutations')), garageCommandCount); checks++;
  sql('drop trigger test_combined_audit_failure on public.audit_events; drop function public.test_combined_audit_failure();');

  const outboxVehicle = garageCreate(owner, '10000000-0000-4000-8000-000000000003', 'Outbox rollback');
  const requestCount = Number(sql('select count(*) from public.care_requests'));
  const careCommandCount = Number(sql('select count(*) from public.care_request_commands'));
  const careAuditCount = Number(sql("select count(*) from public.audit_events where action like 'care.%'"));
  sql("create function public.test_combined_outbox_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_OUTBOX_FAILURE'; end $$; create trigger test_combined_outbox_failure before insert on public.care_notification_outbox for each row execute function public.test_combined_outbox_failure();");
  expectSqlError(auth(owner,
    `select public.care_submit_request(gen_random_uuid(),${quote(carePayload(outboxVehicle.id, 'cleaning'))}::jsonb)`,
  ), 'TEST_OUTBOX_FAILURE');
  assert.equal(Number(sql('select count(*) from public.care_requests')), requestCount); checks++;
  assert.equal(Number(sql('select count(*) from public.care_request_commands')), careCommandCount); checks++;
  assert.equal(Number(sql("select count(*) from public.audit_events where action like 'care.%'")), careAuditCount); checks++;
  sql('drop trigger test_combined_outbox_failure on public.care_notification_outbox; drop function public.test_combined_outbox_failure();');

  const careFirstVehicle = garageCreate(owner, '10000000-0000-4000-8000-000000000004', 'Care first');
  const careFirstTag = 'combined_care_first_holds_vehicle';
  const careFirst = result(auth(owner,
    `select public.care_submit_request('20000000-0000-4000-8000-000000000004',${quote(carePayload(careFirstVehicle.id))}::jsonb); select pg_sleep(1); /* ${careFirstTag} */`,
  ));
  await waitForQuery(careFirstTag);
  const archiveAfterCare = result(auth(owner,
    `select public.garage_mutate_vehicle('archive',${quote(careFirstVehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,gen_random_uuid(),gen_random_uuid())`,
  ));
  const [careFirstResult, archiveAfterCareResult] = await Promise.all([careFirst, archiveAfterCare]);
  assert.equal(careFirstResult.error, undefined); checks++;
  assert.equal(archiveAfterCareResult.error, undefined); checks++;
  assert.equal(sql(`select count(*) from public.care_requests where vehicle_id=${quote(careFirstVehicle.id)}::uuid`), '1'); checks++;
  assert.equal(sql(`select archived_at is not null from public.vehicles where id=${quote(careFirstVehicle.id)}::uuid`), 't'); checks++;

  const archiveFirstVehicle = garageCreate(owner, '10000000-0000-4000-8000-000000000005', 'Archive first');
  const archiveFirstTag = 'combined_archive_first_holds_vehicle';
  const archiveFirst = result(auth(owner,
    `select public.garage_mutate_vehicle('archive',${quote(archiveFirstVehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,gen_random_uuid(),gen_random_uuid()); select pg_sleep(1); /* ${archiveFirstTag} */`,
  ));
  await waitForQuery(archiveFirstTag);
  const intakeAfterArchive = result(auth(owner,
    `select public.care_submit_request('20000000-0000-4000-8000-000000000005',${quote(carePayload(archiveFirstVehicle.id))}::jsonb)`,
  ));
  const [archiveFirstResult, intakeAfterArchiveResult] = await Promise.all([archiveFirst, intakeAfterArchive]);
  assert.equal(archiveFirstResult.error, undefined); checks++;
  assert.ok(intakeAfterArchiveResult.output?.includes('NOT_FOUND')); checks++;
  assert.equal(sql(`select count(*) from public.care_requests where vehicle_id=${quote(archiveFirstVehicle.id)}::uuid`), '0'); checks++;

  const retryFirstVehicle = garageCreate(owner, '10000000-0000-4000-8000-000000000006', 'Retry first');
  const retryFirstRequest = JSON.parse(sql(auth(owner,
    `select public.care_submit_request('20000000-0000-4000-8000-000000000006',${quote(carePayload(retryFirstVehicle.id))}::jsonb)`,
  )).split('\n')[0]).request.id;
  sql(`update public.care_requests set customer_stage='no_match',next_action='choose_recovery',responsible_role='customer',next_update_at=null where id=${quote(retryFirstRequest)}::uuid`);
  const retryFirstTag = 'combined_retry_first_holds_vehicle';
  const retryFirst = result(auth(owner,
    `select public.care_retry_request(${quote(retryFirstRequest)}::uuid,'30000000-0000-4000-8000-000000000006'); select pg_sleep(1); /* ${retryFirstTag} */`,
  ));
  await waitForQuery(retryFirstTag);
  const archiveAfterRetry = result(auth(owner,
    `select public.garage_mutate_vehicle('archive',${quote(retryFirstVehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,gen_random_uuid(),gen_random_uuid())`,
  ));
  const [retryFirstResult, archiveAfterRetryResult] = await Promise.all([retryFirst, archiveAfterRetry]);
  assert.equal(retryFirstResult.error, undefined); checks++;
  assert.equal(archiveAfterRetryResult.error, undefined); checks++;
  assert.equal(sql(`select count(*) from public.care_request_events where request_id=${quote(retryFirstRequest)}::uuid and type='request_reopened'`), '1'); checks++;

  const retryBlockedVehicle = garageCreate(owner, '10000000-0000-4000-8000-000000000007', 'Retry blocked');
  const retryBlockedRequest = JSON.parse(sql(auth(owner,
    `select public.care_submit_request('20000000-0000-4000-8000-000000000007',${quote(carePayload(retryBlockedVehicle.id))}::jsonb)`,
  )).split('\n')[0]).request.id;
  sql(`update public.care_requests set customer_stage='no_match',next_action='choose_recovery',responsible_role='customer',next_update_at=null where id=${quote(retryBlockedRequest)}::uuid`);
  const retryArchiveFirstTag = 'combined_archive_blocks_retry';
  const retryArchiveFirst = result(auth(owner,
    `select public.garage_mutate_vehicle('archive',${quote(retryBlockedVehicle.id)}::uuid,'{"expected_revision":1}'::jsonb,gen_random_uuid(),gen_random_uuid()); select pg_sleep(1); /* ${retryArchiveFirstTag} */`,
  ));
  await waitForQuery(retryArchiveFirstTag);
  const retryAfterArchive = result(auth(owner,
    `select public.care_retry_request(${quote(retryBlockedRequest)}::uuid,'30000000-0000-4000-8000-000000000007')`,
  ));
  const [retryArchiveFirstResult, retryAfterArchiveResult] = await Promise.all([retryArchiveFirst, retryAfterArchive]);
  assert.equal(retryArchiveFirstResult.error, undefined); checks++;
  assert.ok(retryAfterArchiveResult.output?.includes('NOT_FOUND')); checks++;
  assert.equal(sql(`select count(*) from public.care_request_events where request_id=${quote(retryBlockedRequest)}::uuid and type='request_reopened'`), '0'); checks++;
  assert.equal(sql(`select count(*) from public.care_request_commands where request_id=${quote(retryBlockedRequest)}::uuid and operation='retry'`), '0'); checks++;

  console.log(`PASS: ${checks} combined Garage/Care migration, ownership, atomicity and race checks (auth/storage stubs; not hosted Supabase).`);
});
