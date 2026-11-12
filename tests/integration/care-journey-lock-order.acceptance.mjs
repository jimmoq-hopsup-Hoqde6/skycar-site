import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Canonical lock order for care_journey_command (and its peers):
//   advisory(scope:key) -> vehicle FOR UPDATE -> care_requests FOR UPDATE -> care_journeys FOR UPDATE
//   -> quote/expert rows -> (confirm only) expert-capacity advisory lock.
// Two real psql sessions race on one journey. The session that goes FIRST sleeps right after it took its
// journey row lock (a GUC-driven pg_sleep injected into the function under test, nothing else changed); the
// SECOND starts once the first is observed inside pg_sleep and is observed waiting on a lock. A pre-fix
// negative control re-installs the original 20261003064126 body (same injection) and must deadlock exactly where
// an admin start/complete/cancel is first and succeeds; the candidate must never raise 40P01 and must
// match the outcome of running the same two commands serially in the same order.
const SLEEP_GUC = 'skycar.lock_test_sleep';
const SLEEP_SECONDS = '1.5';
const JOURNEY_LOCK = /^([ \t]*)select \* into journey from public\.care_journeys where id=p_id for update;$/m;
const SIGNATURES = {
 journey: 'public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)',
 techWork: 'public.care_technician_work_command(uuid,uuid,text,uuid,jsonb)',
 review: 'public.care_customer_completion_review_command(uuid,uuid,uuid,text,uuid,jsonb)',
};
const EVIDENCE = [{slot: 1, mime_type: 'image/jpeg', size_bytes: 256, sha256: 'c'.repeat(64)}];

function inject(definition) {
 assert.equal(definition.match(new RegExp(JOURNEY_LOCK.source, 'gm'))?.length, 1, 'exactly one journey row lock expected');
 return definition.replace(JOURNEY_LOCK, (line, indent) =>
  `${line}\n${indent}perform pg_sleep(coalesce(nullif(current_setting('${SLEEP_GUC}',true),''),'0')::numeric);`);
}

function preFixDefinition() {
 const migration = readFileSync('supabase/migrations/20261003064126_care_connected_journey.sql', 'utf8');
 const start = migration.indexOf('create function public.care_journey_command(');
 const end = migration.indexOf('\n$$;', start) + 4;
 assert.ok(start > 0 && end > start, 'original care_journey_command definition must be found');
 return migration.slice(start, end).replace('create function', 'create or replace function');
}

function classify(outcome) {
 if (!outcome.error) return 'ok';
 const output = outcome.output ?? '';
 if (output.includes('deadlock detected')) return '40P01';
 const match = output.match(/ERROR:\s+([A-Z_]{4,})/);
 return match ? match[1] : `OTHER:${output.split('\n')[0]}`;
}

export async function verifyCareJourneyLockOrder({sql, quote, result}) {
 const originals = Object.fromEntries(Object.entries(SIGNATURES).map(([name, signature]) =>
  [name, sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`)]));
 const priorDefinition = preFixDefinition();
 const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
 const waitFor = async (predicate, what) => {
  for (let attempt = 0; attempt < 400; attempt++) {
   if (sql(predicate) !== '0') return;
   await wait(20);
  }
  throw new Error(`Lock-order barrier not observed: ${what}`);
 };
 const installInjected = journeyDefinition => {
  sql(inject(journeyDefinition));
  sql(inject(originals.techWork));
  sql(inject(originals.review));
 };
 const restore = () => { for (const definition of Object.values(originals)) sql(definition); };

 // ---- fixtures -------------------------------------------------------------------------------------
 const adminId = randomUUID();
 sql(`insert into auth.users(id) values(${quote(adminId)}); insert into public.user_roles(user_id,role) values(${quote(adminId)},'admin') on conflict do nothing;`);
 function fixture(state) {
  const f = {customer: randomUUID(), tech: randomUUID(), expert: randomUUID(), id: randomUUID(), vehicle: randomUUID(), quoteId: randomUUID(), admin: adminId};
  const future = ['booking_requested', 'quotes_ready'].includes(state);
  const requestFulfilment = {scheduled: 'scheduled', in_progress: 'in_progress', completed: 'completed'}[state] ?? null;
  const quoteStatus = state === 'quotes_ready' ? 'issued' : 'selected';
  const startsAt = future ? "clock_timestamp()+interval '1 day'" : "clock_timestamp()-interval '1 hour'";
  const endsAt = future ? "clock_timestamp()+interval '1 day 1 hour'" : "clock_timestamp()+interval '1 hour'";
  const expiresAt = future ? "clock_timestamp()+interval '1 hour'" : "clock_timestamp()-interval '2 hours'";
  const insertState = state === 'completed' ? 'in_progress' : state;
  const hasExpert = state !== 'quotes_ready';
  sql(`insert into auth.users(id) values(${quote(f.customer)}),(${quote(f.tech)});
   insert into public.user_roles(user_id,role) values(${quote(f.customer)},'customer') on conflict do nothing;
   delete from public.user_roles where user_id=${quote(f.tech)};
   insert into public.user_roles(user_id,role) values(${quote(f.tech)},'technician');
   insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until)
    values(${quote(f.expert)},'Lock order technician','Synthetic isolated expert',array['repair'],array['5000'],current_date+30);
   insert into public.care_technician_accounts(expert_id,user_id) values(${quote(f.expert)},${quote(f.tech)});
   insert into public.vehicles(id,owner_id,make,model,year) values(${quote(f.vehicle)},${quote(f.customer)},'Toyota','Journey lock order',2020);
   insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
    values(${quote(f.id)},${quote(f.customer)},${quote(f.vehicle)},'repair','Synthetic journey lock order','flexible',clock_timestamp()+interval '1 hour',30,${requestFulfilment ? quote(requestFulfilment) : 'null'});
   insert into public.care_journeys(id,account_request_id,customer_details,state,expert_id,starts_at,ends_at,completion_evidence)
    values(${quote(f.id)},${quote(f.id)},'{"postcode":"5000"}',${quote(state === 'quotes_ready' ? 'review' : insertState)},${hasExpert ? quote(f.expert) : 'null'},${hasExpert ? startsAt : 'null'},${hasExpert ? endsAt : 'null'},
     ${state === 'completed' ? `'${JSON.stringify(EVIDENCE)}'::jsonb` : 'null'});
   insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
    values(${quote(f.quoteId)},${quote(f.id)},${quote(f.expert)},'Lock order technician','Synthetic isolated expert','Synthetic repair',10000,${quote(quoteStatus)},${expiresAt},${future ? startsAt : "clock_timestamp()-interval '1 hour'"},${future ? endsAt : "clock_timestamp()+interval '1 hour'"});
   ${hasExpert ? `update public.care_journeys set selected_quote_id=${quote(f.quoteId)} where id=${quote(f.id)};` : ''}
   ${state === 'quotes_ready' ? `update public.care_journeys set state='quotes_ready' where id=${quote(f.id)};` : ''}
   ${state === 'completed' ? `update public.care_journeys set state='completed' where id=${quote(f.id)};` : ''}`);
  return f;
 }
 function snapshot(f) {
  return sql(`select concat_ws('|',j.state,coalesce(j.completion_review_state,'-'),j.revision,coalesce(r.fulfilment_state,'-'),coalesce(r.quote_state,'-'),coalesce(r.assignment_state,'-'),
   (select coalesce(string_agg(type,',' order by id),'') from public.care_journey_events where journey_id=j.id),
   (select count(*) from public.care_journey_commands where journey_id=j.id),
   (select count(*) from public.care_technician_commands where journey_id=j.id),
   (select count(*) from public.vehicle_history where vehicle_id=r.vehicle_id and event_type='care_service_completed'),
   (select coalesce(string_agg(status,',' order by status),'') from public.care_reviewed_quotes where journey_id=j.id))
   from public.care_journeys j join public.care_requests r on r.id=j.id where j.id=${quote(f.id)}`);
 }
 const service = (label, body, sleepSeconds) =>
  `begin;/* ${label} */set local statement_timeout='20s';set local role service_role;${sleepSeconds ? `set local ${SLEEP_GUC}='${sleepSeconds}';` : ''}${body};commit;`;
 const commands = {
  admin: (action, payload = {}) => (f, key, label, sleepSeconds) => service(label,
   `select public.care_journey_command(${quote(action)},${quote(f.id)}::uuid,${quote(f.admin)}::uuid,null,${quote(key)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`, sleepSeconds),
  selectQuote: (f, key, label, sleepSeconds) => service(label,
   `select public.care_journey_command('select_quote',${quote(f.id)}::uuid,${quote(f.customer)}::uuid,null,${quote(key)}::uuid,${quote(JSON.stringify({quote_id: f.quoteId, address: '1 Lock Order Street Adelaide'}))}::jsonb)`, sleepSeconds),
  techWork: action => (f, key, label, sleepSeconds) => service(label,
   `select public.care_technician_work_command(${quote(f.tech)}::uuid,${quote(key)}::uuid,${quote(action)},${quote(f.id)}::uuid,${quote(JSON.stringify(action === 'complete' ? {evidence: EVIDENCE} : {}))}::jsonb)`, sleepSeconds),
  review: (f, key, label, sleepSeconds) => service(label,
   `select public.care_customer_completion_review_command(${quote(f.customer)}::uuid,null,${quote(key)}::uuid,'confirm_completion',${quote(f.id)}::uuid,'{}'::jsonb)`, sleepSeconds),
 };
 const cancel = commands.admin('cancel'), start = commands.admin('start');
 const complete = commands.admin('complete', {evidence: EVIDENCE}), confirm = commands.admin('confirm', {availability_confirmed: true});
 const matrix = [
  // [name, state, admin command, other command]
  ['admin cancel vs admin confirm', 'booking_requested', cancel, confirm],
  ['admin start vs admin confirm', 'scheduled', start, confirm],
  ['admin complete vs admin confirm', 'in_progress', complete, confirm],
  ['admin cancel vs customer select_quote', 'quotes_ready', cancel, commands.selectQuote],
  ['admin start vs customer select_quote', 'quotes_ready', start, commands.selectQuote],
  ['admin complete vs customer select_quote', 'quotes_ready', complete, commands.selectQuote],
  ['admin cancel vs technician start', 'scheduled', cancel, commands.techWork('start')],
  ['admin start vs technician start', 'scheduled', start, commands.techWork('start')],
  ['admin complete vs technician start', 'scheduled', complete, commands.techWork('start')],
  ['admin cancel vs technician complete', 'in_progress', cancel, commands.techWork('complete')],
  ['admin start vs technician complete', 'in_progress', start, commands.techWork('complete')],
  ['admin complete vs technician complete', 'in_progress', complete, commands.techWork('complete')],
  ['admin cancel vs customer completion review (not yet completed)', 'scheduled', cancel, commands.review],
  ['admin start vs customer completion review (not yet completed)', 'scheduled', start, commands.review],
  ['admin complete vs customer completion review (becomes reviewable)', 'in_progress', complete, commands.review],
  ['admin cancel vs customer completion review (completed)', 'completed', cancel, commands.review],
  ['admin start vs customer completion review (completed)', 'completed', start, commands.review],
  ['admin complete vs customer completion review (completed)', 'completed', complete, commands.review],
 ];
 const runSession = (builder, f, label) => result(builder(f, randomUUID(), label, label.startsWith('first_') ? SLEEP_SECONDS : null));
 async function racePair([name, state, admin, other], adminFirst) {
  const f = fixture(state), tag = `${name.replace(/[^a-z]+/gi, '_')}_${adminFirst}_${f.id}`;
  const [firstBuilder, secondBuilder] = adminFirst ? [admin, other] : [other, admin];
  const first = runSession(firstBuilder, f, `first_${tag}`);
  let second;
  try {
   await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%first_' + tag + '%')}`, `${name} first sleeping`);
   second = runSession(secondBuilder, f, `second_${tag}`);
   await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%second_' + tag + '%')}`, `${name} second waiting`);
  } catch (error) { await first; await second; throw error; }
  const outcomes = [classify(await first), classify(await second)];
  return {name, state, adminFirst, outcomes, snapshot: snapshot(f)};
 }
 async function serialPair([name, state, admin, other], adminFirst) {
  const f = fixture(state), [firstBuilder, secondBuilder] = adminFirst ? [admin, other] : [other, admin];
  const outcomes = [classify(await runSession(firstBuilder, f, `serial_a_${f.id}`)), classify(await runSession(secondBuilder, f, `serial_b_${f.id}`))];
  return {name, state, adminFirst, outcomes, snapshot: snapshot(f)};
 }
 const inBatches = async (items, size, task) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(task)));
  return out;
 };
 const cases = matrix.flatMap(entry => [[entry, true], [entry, false]]);
 const summary = {};

 try {
  installInjected(originals.journey);

  // ---- 1. serial oracle (same commands, same order, no overlap) ------------------------------------
  const oracle = new Map((await inBatches(cases, 6, ([entry, adminFirst]) => serialPair(entry, adminFirst)))
   .map(row => [`${row.name}|${row.adminFirst}`, row]));
  for (const row of oracle.values()) assert.ok(!row.outcomes.includes('40P01') && !row.outcomes.some(x => x.startsWith('OTHER:')), `serial oracle ${row.name}: ${row.outcomes}`);
  summary.oracleCases = oracle.size;

  // ---- 2. candidate: concurrent == serial, never a deadlock ----------------------------------------
  const candidate = await inBatches(cases, 6, ([entry, adminFirst]) => racePair(entry, adminFirst));
  for (const row of candidate) {
   const expected = oracle.get(`${row.name}|${row.adminFirst}`);
   assert.ok(!row.outcomes.includes('40P01'), `candidate deadlocked: ${row.name} adminFirst=${row.adminFirst}`);
   assert.deepEqual(row.outcomes, expected.outcomes, `outcome differs from serial order: ${row.name} adminFirst=${row.adminFirst}`);
   assert.equal(row.snapshot, expected.snapshot, `final state differs from serial order: ${row.name} adminFirst=${row.adminFirst}`);
   assert.ok(row.outcomes.includes('ok'), `at least one command must win: ${row.name}`);
   console.log(JSON.stringify({test: 'journey lock order', candidate: true, case: row.name, adminFirst: row.adminFirst, outcomes: row.outcomes, deadlock: false}));
  }
  const byName = (name, adminFirst) => candidate.find(row => row.name === name && row.adminFirst === adminFirst);
  // Documented serialized outcomes for the headline pairs (not only "same as serial").
  assert.deepEqual(byName('admin cancel vs admin confirm', true).outcomes, ['ok', 'INVALID_TRANSITION']);
  assert.deepEqual(byName('admin cancel vs admin confirm', false).outcomes, ['ok', 'ok']);
  assert.equal(byName('admin cancel vs admin confirm', false).snapshot.split('|')[0], 'cancelled');
  assert.deepEqual(byName('admin start vs admin confirm', true).outcomes, ['ok', 'INVALID_TRANSITION']);
  assert.deepEqual(byName('admin complete vs customer completion review (becomes reviewable)', true).outcomes, ['ok', 'ok']);
  assert.deepEqual(byName('admin complete vs customer completion review (becomes reviewable)', false).outcomes, ['INVALID_TRANSITION', 'ok']);
  assert.deepEqual(byName('admin start vs technician start', true).outcomes, ['ok', 'INVALID_TRANSITION']);
  assert.deepEqual(byName('admin complete vs technician complete', false).outcomes, ['ok', 'EVIDENCE_REQUIRED']);
  assert.deepEqual(byName('admin cancel vs customer select_quote', false).outcomes, ['ok', 'ok']);
  summary.candidateCases = candidate.length;

  // ---- 3. every action holds vehicle -> request before it waits for / holds the journey row ---------
  for (const [label, state, builder] of [
   ['admin start', 'scheduled', start], ['admin complete', 'in_progress', complete], ['admin cancel', 'booking_requested', cancel],
   ['admin confirm', 'booking_requested', confirm], ['customer select_quote', 'quotes_ready', commands.selectQuote],
   ['customer request_cancel', 'scheduled', (f, key, tag, seconds) => service(tag, `select public.care_journey_command('request_cancel',${quote(f.id)}::uuid,${quote(f.customer)}::uuid,null,${quote(key)}::uuid,'{}'::jsonb)`, seconds)],
   ['customer update_details', 'quotes_ready', (f, key, tag, seconds) => service(tag, `select public.care_journey_command('update_details',${quote(f.id)}::uuid,${quote(f.customer)}::uuid,null,${quote(key)}::uuid,'{"name":"Lock Order","phone":"0400000000","suburb":"Adelaide","postcode":"5000"}'::jsonb)`, seconds)],
  ]) {
   const f = fixture(state), tag = `holds_${label.replace(/\W+/g, '_')}_${f.id}`;
   const session = runSession(builder, f, `first_${tag}`);
   await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%first_' + tag + '%')}`, `${label} sleeping`);
   for (const [table, column, id] of [['vehicles', 'id', f.vehicle], ['care_requests', 'id', f.id], ['care_journeys', 'id', f.id]]) {
    const probe = await result(`begin; select 1 from public.${table} where ${column}=${quote(id)} for update nowait; rollback;`);
    assert.ok(probe.output?.includes('could not obtain lock'), `${label} must hold the ${table} row lock while sleeping`);
   }
   assert.equal(classify(await session), 'ok', label);
  }
  console.log(JSON.stringify({test: 'journey lock order', result: 'PASS', holdsVehicleRequestJourney: true}));

  // ---- 4. authority/source re-read after the lock wait, replay contract and archived semantics -----
  const holder = (f, body, tag) => {
   const pending = result(`begin;/* holder_${tag} */${body}; select pg_sleep(${SLEEP_SECONDS}); commit;`);
   return pending;
  };
  const holdVehicle = (f, tag) => holder(f, `select 1 from public.vehicles where id=${quote(f.vehicle)} for update`, tag);
  const waitHolder = tag => waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%holder_' + tag + '%')}`, `holder ${tag}`);
  const waitWaiting = tag => waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%waiter_' + tag + '%')}`, `waiter ${tag}`);
  async function underHolder(f, tag, builder, whileWaiting = () => {}) {
   const held = holdVehicle(f, tag);
   await waitHolder(tag);
   const key = randomUUID();
   const waiter = result(builder(f, key, `waiter_${tag}`, null));
   await waitWaiting(tag);
   whileWaiting();
   const [heldResult, outcome] = [await held, await waiter];
   assert.equal(heldResult.error, undefined);
   return {key, outcome, code: classify(outcome)};
  }
  const otherAdmin = randomUUID();
  sql(`insert into auth.users(id) values(${quote(otherAdmin)}); insert into public.user_roles(user_id,role) values(${quote(otherAdmin)},'admin') on conflict do nothing;`);
  const asAdmin = (builder, adminActor) => (f, key, tag, seconds) => builder({...f, admin: adminActor}, key, tag, seconds);

  // 4a. admin role revoked while queued behind the vehicle lock => NOT_FOUND (what a fresh non-owner call returns), nothing written.
  let f = fixture('scheduled');
  let run = await underHolder(f, `revoked_admin_${f.id}`, asAdmin(cancel, otherAdmin), () => sql(`delete from public.user_roles where user_id=${quote(otherAdmin)} and role='admin'`));
  assert.equal(run.code, 'NOT_FOUND');
  assert.equal(snapshot(f).split('|')[0], 'scheduled');
  assert.equal(sql(`select count(*) from public.care_journey_commands where idempotency_key=${quote(run.key)}`), '0');
  sql(`insert into public.user_roles(user_id,role) values(${quote(otherAdmin)},'admin')`);

  // 4b. customer role removed while queued => NOT_FOUND (same code as a fresh denied call), quote untouched.
  f = fixture('quotes_ready');
  run = await underHolder(f, `revoked_customer_${f.id}`, commands.selectQuote, () => sql(`delete from public.user_roles where user_id=${quote(f.customer)} and role='customer'`));
  assert.equal(run.code, 'NOT_FOUND');
  assert.equal(snapshot(f).split('|')[0], 'quotes_ready');

  // 4c. role granted to the customer while queued: customer actions become FORBIDDEN, as for a fresh call.
  f = fixture('quotes_ready');
  run = await underHolder(f, `granted_admin_${f.id}`, commands.selectQuote, () => sql(`insert into public.user_roles(user_id,role) values(${quote(f.customer)},'admin') on conflict do nothing`));
  assert.equal(run.code, 'FORBIDDEN');
  assert.equal(snapshot(f).split('|')[0], 'quotes_ready');

  // 4d. vehicle ownership cannot move away from a vehicle with care history (care_guard_vehicle_owner), so the
  //     post-lock owner/request-linkage re-verification in the function is defence in depth only.
  f = fixture('scheduled');
  const newOwner = randomUUID();
  sql(`insert into auth.users(id) values(${quote(newOwner)})`);
  assert.ok((await result(`update public.vehicles set owner_id=${quote(newOwner)} where id=${quote(f.vehicle)}`)).output?.includes('VEHICLE_HAS_CARE_HISTORY'));

  // 4e. vehicle archived while queued: new booking decisions are NOT_FOUND, but admin cancel is still allowed
  //     (the original function never applied the archived filter to start/complete/cancel).
  f = fixture('booking_requested');
  run = await underHolder(f, `archived_confirm_${f.id}`, confirm, () => {});
  assert.equal(run.code, 'ok', 'control: unarchived confirm succeeds');
  for (const [label, builder, state, expected] of [['confirm', confirm, 'booking_requested', 'NOT_FOUND'], ['cancel', cancel, 'booking_requested', 'ok']]) {
   const g = fixture(state), tag = `archived_${label}_${g.id}`;
   const held = holder(g, `update public.vehicles set archived_at=clock_timestamp() where id=${quote(g.vehicle)}`, tag);
   await waitHolder(tag);
   const waiter = result(builder(g, randomUUID(), `waiter_${tag}`, null));
   await waitWaiting(tag);
   assert.equal((await held).error, undefined);
   assert.equal(classify(await waiter), expected, `archived while queued: ${label}`);
  }

  // 4f. exact replay is still served after the locks (replayed:true, no second mutation); changed reuse conflicts;
  //     replay stays denied once authority is gone.
  f = fixture('scheduled');
  const replayKey = randomUUID();
  assert.equal(classify(await result(cancel(f, replayKey, `replay_first_${f.id}`, null))), 'ok');
  const before = snapshot(f);
  const replayBuilder = (g, key, tag, seconds) => cancel(g, replayKey, tag, seconds);
  run = await underHolder(f, `replay_wait_${f.id}`, replayBuilder);
  assert.equal(run.code, 'ok');
  assert.ok(run.outcome.value.includes('"replayed": true'), 'replay must return replayed:true');
  assert.equal(snapshot(f), before);
  assert.equal(classify(await result(commands.admin('start')(f, replayKey, `replay_conflict_${f.id}`, null))), 'IDEMPOTENCY_CONFLICT');
  assert.equal(classify(await result(asAdmin(cancel, randomUUID())(f, replayKey, `replay_denied_${f.id}`, null))), 'NOT_FOUND');
  summary.authorityAndReplayChecks = 'PASS';
  console.log(JSON.stringify({test: 'journey lock order', result: 'PASS', authorityRecheckAfterLocks: true, replayContract: true}));

  // ---- 5. negative control: the ORIGINAL body (journey before request) must deadlock where predicted -----------
  installInjected(priorDefinition);
  const control = await inBatches(cases, 6, ([entry, adminFirst]) => racePair(entry, adminFirst));
  let deadlocks = 0;
  for (const row of control) {
   const expected = oracle.get(`${row.name}|${row.adminFirst}`);
   const predicted = row.adminFirst && expected.outcomes[0] === 'ok';
   const deadlocked = row.outcomes.includes('40P01');
   console.log(JSON.stringify({test: 'journey lock order', preFixControl: true, case: row.name, adminFirst: row.adminFirst, outcomes: row.outcomes, deadlock: deadlocked}));
   assert.equal(deadlocked, predicted, `pre-fix control ${row.name} adminFirst=${row.adminFirst}: deadlock expected=${predicted}`);
   if (!deadlocked) assert.deepEqual(row.outcomes, expected.outcomes);
   deadlocks += deadlocked ? 1 : 0;
  }
  assert.ok(deadlocks >= 9, `pre-fix control must reproduce the inversion in many pairings (saw ${deadlocks})`);
  summary.preFixDeadlocks = deadlocks;
 } finally {
  restore();
 }
 // The candidate definition is back and unchanged.
 assert.equal(sql(`select pg_get_functiondef(${quote(SIGNATURES.journey)}::regprocedure)`), originals.journey);
 console.log(`PASS: care_journey_command lock order ${JSON.stringify(summary)}`);
}
