// Shared, test-only lock barrier for the concurrency probes (no production function or migration changes).
//
// A session that must "hold its locks while the test looks" calls lock_test.hold(tag, max_seconds) AFTER it has
// taken them. hold() first publishes application_name = 'lock_test_holding' (transaction-local), which is the
// holder's signal that its locks are taken, then polls for its release row. It never returns on time alone: the
// test inserts the tag into lock_test.release, or the hold raises LOCK_TEST_HOLD_TIMEOUT after max_seconds.
// Bounds, strictly ordered and checked below at import: every waitFor() bound (WAIT_MS) is shorter than a hold
// (HOLD_SECONDS), and every statement_timeout used around a hold (STATEMENT_TIMEOUT) is longer than the hold.
// So a barrier always gives up (and fails the test) while the hold it is watching is still in place: a hold can
// never expire underneath a waiting barrier and let it observe post-hold state. And no hold is cut short by a
// statement timeout; a hold that is never released ends only by its own LOCK_TEST_HOLD_TIMEOUT.
// Barriers also stop at once when the session they depend on has already ended (abort / track() below).
// Lock evidence is taken from the server, never from timing: pg_blocking_pids(waiter) must contain the
// holder's backend pid.
export const HOLD_SECONDS = 60;
export const WAIT_MS = 45000;
export const STATEMENT_TIMEOUT = '90s';
if (!(WAIT_MS < HOLD_SECONDS * 1000 && HOLD_SECONDS < Number.parseInt(STATEMENT_TIMEOUT, 10))) {
 throw new Error(`lock-test-gate bounds must satisfy WAIT_MS < HOLD_SECONDS < STATEMENT_TIMEOUT (got ${WAIT_MS} ms, ${HOLD_SECONDS} s, ${STATEMENT_TIMEOUT})`);
}
export const GATE_SETUP = `create schema if not exists lock_test;
 create table if not exists lock_test.release(tag text primary key);
 create or replace function lock_test.hold(p_tag text, p_max_seconds numeric) returns void language plpgsql set search_path = '' as $hold$
 declare deadline timestamptz;
 begin
  if p_tag is null or p_tag = '' or coalesce(p_max_seconds, 0) <= 0 then return; end if;
  deadline := clock_timestamp() + make_interval(secs => p_max_seconds::double precision);
  -- Marks the holder by its exact tag in pg_locks (two-int advisory key space, shared: never blocks anything and
  -- cannot collide with the product's bigint advisory keys), so detection does not depend on the query text, which
  -- pg_stat_activity truncates at track_activity_query_size.
  perform pg_catalog.pg_advisory_xact_lock_shared(20261116, pg_catalog.hashtext(p_tag));
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
 // Backends holding the gate's marker lock for exactly this tag (see GATE_SETUP).
 const tagged = label => `(select l.pid from pg_locks l where l.locktype='advisory' and l.objsubid=2 and l.granted
    and l.classid=20261116::oid and l.objid::bigint = (pg_catalog.hashtext(${quote(label)})::bigint & 4294967295))`;
 const holderMatch = (alias, label) => `(${alias}.query like ${like(label)} or ${alias}.pid in ${tagged(label)})`;
 const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
 const gate = {
  setup: () => exec(GATE_SETUP),
  teardown: () => exec(GATE_TEARDOWN),
  holdCall: (label, seconds = HOLD_SECONDS) => `select lock_test.hold(${quote(label)}, ${seconds})`,
  // The holder has taken its locks and is inside hold() (its own signal, set after the locks).
  holding: label => `select count(*) from pg_stat_activity a where a.pid<>pg_backend_pid() and a.application_name='lock_test_holding' and ${holderMatch('a', label)}`,
  holderPid: async label => String(await exec(`select coalesce(min(a.pid)::text,'') from pg_stat_activity a where a.pid<>pg_backend_pid() and a.application_name='lock_test_holding' and ${holderMatch('a', label)}`)),
  // The waiter is blocked, and the server names the holder as (one of) its blockers.
  blockedBy: (waiterLabel, holderLabel) => `select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid = any(pg_blocking_pids(w.pid))
    where w.pid<>pg_backend_pid() and h.pid<>pg_backend_pid() and w.query like ${like(waiterLabel)} and ${holderMatch('h', holderLabel)}`,
  // Some session (the racing second one, which needs no tag) is blocked, and the server names the holder as its blocker.
  blockedByHolder: holderLabel => `select count(*) from pg_stat_activity w join pg_stat_activity h on h.pid = any(pg_blocking_pids(w.pid))
    where w.pid<>pg_backend_pid() and h.application_name='lock_test_holding' and ${holderMatch('h', holderLabel)}`,
  isHolding: async label => String(await exec(gate.holding(label))) !== '0',
  blockedByPid: (waiterLabel, pid) => `select count(*) from pg_stat_activity w where w.pid<>pg_backend_pid() and w.query like ${like(waiterLabel)} and ${Number(pid)} = any(pg_blocking_pids(w.pid))`,
  // Diagnostic snapshot of every other client backend, attached to a barrier timeout.
  activity: async () => {
   try {
    return 'pg_stat_activity at timeout:\n' + String(await exec(`select coalesce(string_agg(format('  pid=%s state=%s wait=%s/%s app=%s blockers=%s xact_age=%s q=%s',
      pid, state, wait_event_type, wait_event, application_name, pg_blocking_pids(pid), date_trunc('second', clock_timestamp()-xact_start),
      left(regexp_replace(query, '\\s+', ' ', 'g'), 160)), chr(10) order by pid), '  (none)')
      from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()`));
   } catch (error) { return `pg_stat_activity snapshot failed: ${error.message}`; }
  },
  release: label => exec(`insert into lock_test.release(tag) values(${quote(label)}) on conflict do nothing`),
  // abort(): optional; returns an error message when waiting can no longer succeed (e.g. the holder already ended).
  waitFor: async (predicate, what, ms = WAIT_MS, abort = () => undefined) => {
   const deadline = Date.now() + ms;
   for (;;) {
    if (String(await exec(predicate)) !== '0') return;
    const aborted = abort();
    if (aborted) throw new Error(`Lock barrier cannot be reached: ${what}: ${aborted}`);
    if (Date.now() > deadline) throw new Error(`Lock barrier not observed within ${ms} ms: ${what}\n${await gate.activity()}`);
    await sleep(20);
   }
  },
 };
 return gate;
}

// Tracks a result() promise so a barrier can fail fast if that session ended (it can then never hold or block).
export const track = promise => {
 const state = { done: undefined };
 promise.then(value => { state.done = value ?? {}; }, error => { state.done = { error, output: String(error) }; });
 return () => {
  if (!state.done) return undefined;
  const out = String(state.done.output ?? state.done.value ?? '');
  const errors = out.match(/(ERROR|FATAL):[^\n]*/g);
  return `session already finished: ${errors ? errors.join(' | ') : out.slice(-500)}`;
 };
};

// Ordered race: `first` must call gate.holdCall(label) after taking its locks. Waits until it holds, starts `second`,
// requires the server to report a session blocked BY the holder (pg_blocking_pids), then releases. No timing.
export async function heldRace(gate, result, { first, label, second, what = label }) {
 const one = result(first);
 const oneEnded = track(one);
 let two;
 try {
  await gate.waitFor(gate.holding(label), `${what}: first holding its locks`, WAIT_MS, oneEnded);
  two = result(second);
  const twoEnded = track(two);
  await gate.waitFor(gate.blockedByHolder(label), `${what}: second blocked by the holder (pg_blocking_pids)`, WAIT_MS, () => oneEnded() || twoEnded());
 } finally {
  await gate.release(label);
 }
 return [await one, two === undefined ? undefined : await two];
}

// Non-blocking proof: `first` holds its locks (gate.holdCall(label)); check() runs and returns while the holder is
// provably still holding, so check() cannot have waited on those locks. Replaces wall-clock "< N ms" assertions.
export async function whileHolding(gate, result, { first, label, what = label }, check) {
 const one = result(first);
 const oneEnded = track(one);
 let value;
 try {
  await gate.waitFor(gate.holding(label), `${what}: holder holding its locks`, WAIT_MS, oneEnded);
  value = await check();
  if (!(await gate.isHolding(label))) throw new Error(`${what}: holder no longer holding when the check returned (the check waited on its locks)`);
 } finally {
  await gate.release(label);
 }
 return { held: await one, value };
}
