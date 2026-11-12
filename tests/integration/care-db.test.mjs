import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";

const database = process.env.CARE_TEST_DATABASE_URL;
if (!database) throw new Error("CARE_TEST_DATABASE_URL is required; use a fresh disposable PostgreSQL database.");
const url = new URL(database);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/skycar_test") {
  throw new Error("Refusing database tests: only local disposable skycar_test is permitted.");
}
const args = [database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = text => execFileSync("psql", [...args, "-c", text], { encoding: "utf8" }).trim();
const run = async text => (await promisify(execFile)("psql", [...args, "-c", text])).stdout.trim();
const file = path => execFileSync("psql", [...args, "-f", path], { encoding: "utf8" });
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = JSON.stringify({ vehicle_id: "11111111-1111-4111-8111-111111111111", service: "repair", description: "Scratch on rear bumper", preferred_window: "flexible" });
const session = `set local role authenticated; set local request.jwt.claim.sub = '${actor}';`;

before(() => {
  assert.equal(sql("select count(*) from information_schema.tables where table_schema='public'"), "0", "must be an empty database");
  file("tests/integration/bootstrap.sql");
  file("supabase/migrations/202609200001_foundation.sql");
  file("supabase/migrations/202609200002_care_requests.sql");
  file("supabase/migrations/202609200003_care_my_jobs.sql");
  file("tests/integration/fixtures.sql");
});

test("PostgreSQL ownership, RLS, atomic receipt, deadline, replay and recovery assertions", () => {
  file("tests/integration/care.sql");
});

test("My Jobs ownership, archived history, deadline truth and stable pagination", () => {
  file("tests/integration/care-list.sql");
});

test("concurrent identical submissions create exactly one request/event/outbox/command", async () => {
  const key = "90000000-0000-4000-8000-000000000001";
  const statements = `begin; ${session} select public.care_submit_request('${key}','${input}'); select pg_sleep(0.2); commit;`;
  const results = (await Promise.all([run(statements), run(statements), run(statements)]))
    .map(value => JSON.parse(value.split("\n")[0]));
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal(new Set(results.map(result => result.request.id)).size, 1);
  assert.equal(new Set(results.map(result => result.request.next_update_at)).size, 1);
  assert.equal(sql("select count(*) from public.care_requests"), "1");
  assert.equal(sql("select count(*) from public.care_request_events"), "1");
  assert.equal(sql("select count(*) from public.care_notification_outbox"), "1");
  assert.equal(sql("select count(*) from public.care_request_commands"), "1");
});

test("concurrent workers claim each due request once, then stop until follow-up", async () => {
  sql(`begin; ${session} select public.care_submit_request(gen_random_uuid(),'${input}') from generate_series(1,11); commit;`);
  sql("update public.care_requests set next_update_at = now() - interval '1 second'");
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => run("begin; set local role service_role; select public.care_escalate_overdue(4); select pg_sleep(0.2); commit;")));
  assert.equal(outcomes.reduce((total, result) => total + Number(result.split("\n")[0]), 0), 12);
  assert.equal(sql("select count(*) from public.care_request_events where type='response_overdue'"), "12");
  assert.equal(sql("select count(*) from public.care_notification_outbox"), "24");
  assert.equal(sql("select public.care_escalate_overdue(100)"), "0");
  sql("update public.care_requests set next_update_at = now() - interval '1 second'");
  const final = await Promise.all([run("select public.care_escalate_overdue(100)"), run("select public.care_escalate_overdue(100)")]);
  assert.equal(final.reduce((sum, value) => sum + Number(value), 0), 12);
  assert.equal(sql("select count(*) from public.care_request_events where type='no_match'"), "12");
  assert.equal(sql("select count(*) from public.care_notification_outbox"), "36");
});

test("concurrent recovery cannot reset deadlines or append duplicate events", async () => {
  const id = sql("select id from public.care_requests order by id limit 1");
  const key = "90000000-0000-4000-8000-000000000002";
  const statement = `begin; ${session} select public.care_retry_request('${id}','${key}'); select pg_sleep(0.2); commit;`;
  const results = (await Promise.all([run(statement), run(statement)])).map(value => JSON.parse(value.split("\n")[0]));
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal(new Set(results.map(result => result.request.next_update_at)).size, 1);
  assert.equal(sql(`select count(*) from public.care_request_events where request_id='${id}' and type='request_reopened'`), "1");
});
