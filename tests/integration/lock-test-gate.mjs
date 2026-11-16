// Shared, test-only lock barrier for the concurrency probes (no production function or migration changes).
//
// A session that must "hold its locks while the test looks" calls lock_test.hold(tag, max_seconds) AFTER it has
// taken them. hold() first publishes application_name = 'lock_test_holding' (transaction-local), which is the
// holder's signal that its locks are taken, then polls for its release row. It never returns on time alone: the
// test inserts the tag into lock_test.release, or the hold raises LOCK_TEST_HOLD_TIMEOUT after max_seconds.
// Every waitFor() bound (WAIT_MS) is longer than the longest hold (HOLD_SECONDS), and every statement_timeout
// used around a hold (STATEMENT_TIMEOUT) is longer than both, so no barrier can give up while a hold is still
// legitimately in place and no hold can be cut short by a timeout.
// Lock evidence is taken from the server, never from timing: pg_blocking_pids(waiter) must contain the
// holder's backend pid.
export const HOLD_SECONDS = 30;
export const WAIT_MS = 45000;
export const STATEMENT_TIMEOUT = '90s';
export const GATE_SETUP = `create schema if not exists lock_test;
 create table if not exists lock_test.release(tag text primary key);
 create or replace function lock_test.hold(p_tag text, p_max_seconds numeric) returns void language plpgsql set search_path = '' as $hold$
 declare deadline timestamptz;
 begin
  if p_tag is null or p_tag = '' or coalesce(p_max_seconds, 0) <= 0 then return; end if;
  deadline := clock_timestamp() + make_interval(secs => p_max_seconds::double precision);
  perform pg_catalog.set_config('application_name', 'lock_test_holding', true);
  loop
   exit when exists (select 1 from lock_test.release r where r.tag = p_tag);
   if clock_timestamp() > deadline then
    raise exception 'LOCK_TEST_HOLD_TIMEOUT: % was never released', p_tag;
   end if;
   perform pg_catalog.pg_sleep(0.01);
  end loop;
 end $hold$;
 grant usage on schema lock_test to public; grant select on lock_test.release to public;
 grant execute on function lock_test.hold(text, numeric) to public;`;
export const GATE_TEARDOWN = 'drop schema if exists lock_test cascade';

// exec(sql) may be synchronous (returns a string) or asynchronous (returns a promise of a string).
export function lockGate({exec, quote}) {
 const like = label => quote(`%${label}%`);
 const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
 const gate = {
  setup: () => exec(GATE_SETUP),
  teardown: () => exec(GATE_TEARDOWN),
  holdCall: (label, seconds = HOLD_SECONDS) => `select lock_test.hold(${quote(label)}, ${seconds})`,
  // The holder has taken its locks and is inside hold() (its own signal, set after the locks).
  holding: label => `select count(*) from pg_stat_activity where pid<>pg_backend_pid() and application_name='lock_test_holding' and query like ${like(label)}`,
  holderPid: async label => String(await exec(`select coalesce(min(pid)::text,'') from pg_stat_activity where pid<>pg_backend_pid() and application_name='lock_test_holding' and query like ${like(label)}`)),
  // The waiter is blocked, and the server names the holder as (one of) its blockers.
  blockedBy: (waiterLabel, holderLabel) => `select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid = any(pg_blocking_pids(w.pid))
    where w.pid<>pg_backend_pid() and h.pid<>pg_backend_pid() and w.query like ${like(waiterLabel)} and h.query like ${like(holderLabel)}`,
  blockedByPid: (waiterLabel, pid) => `select count(*) from pg_stat_activity w where w.pid<>pg_backend_pid() and w.query like ${like(waiterLabel)} and ${Number(pid)} = any(pg_blocking_pids(w.pid))`,
  release: label => exec(`insert into lock_test.release(tag) values(${quote(label)}) on conflict do nothing`),
  waitFor: async (predicate, what, ms = WAIT_MS) => {
   const deadline = Date.now() + ms;
   for (;;) {
    if (String(await exec(predicate)) !== '0') return;
    if (Date.now() > deadline) throw new Error(`Lock barrier not observed within ${ms} ms: ${what}`);
    await sleep(20);
   }
  },
 };
 return gate;
}
