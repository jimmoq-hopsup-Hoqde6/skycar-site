import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Cross-feature lock order on the integrated chain. care_journey_command takes
//   advisory(scope:key) -> vehicle FOR UPDATE -> care_requests FOR UPDATE -> care_journeys FOR UPDATE
//   -> quote/expert rows -> (confirm only) care:expert-capacity advisory lock.
// This test races it, in real parallel psql sessions with lock_timeout and deadlock detection, against
//   (a) care_submit_request incl. the coverage check (20261101160000): vehicle FOR UPDATE, then inserts;
//   (b) care_record_request_photos / care_heal_request_photo_marker (20261101150000): care_requests FOR KEY SHARE,
//       then the photo-set row;
//   (c) care_technician_replace_availability (20261101063000): care_experts FOR SHARE, own advisories, schedule row.
// The session that goes FIRST sleeps (a GUC-driven pg_sleep injected into the function under test, nothing else
// changed) right after the lock named below; the SECOND starts once the first is observed inside pg_sleep and is
// then either observed waiting on a lock (expected contention) or observed finishing while the first still sleeps
// (expected isolation). Every concurrent outcome and final state must equal running the same two commands serially
// in the same order, and nothing may raise 40P01 or 55P03. A negative control with a genuinely inverted pair of
// plain row locks proves the harness does detect a deadlock.
const SLEEP = 'skycar.lock_test_sleep', SLEEP_EXPERT = 'skycar.lock_test_sleep_expert', SECONDS = '1.5';
const SIGS = {
 journey: 'public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)',
 submit: 'public.care_submit_request(uuid,jsonb)',
 record: 'public.care_record_request_photos(uuid,integer,text,text)',
 heal: 'public.care_heal_request_photo_marker(uuid,text)',
 availability: 'public.care_technician_replace_availability(uuid,uuid,integer,jsonb)',
};
const sleeper = guc => `perform pg_sleep(coalesce(nullif(current_setting('${guc}',true),''),'0')::numeric);`;
// Insert a sleep statement right after the single occurrence of `anchor` (a complete statement boundary).
function injectAfter(definition, anchor, guc, from = 0) {
 const at = definition.indexOf(anchor, from);
 assert.ok(at >= 0, `injection anchor not found: ${anchor}`);
 const end = at + anchor.length;
 return `${definition.slice(0, end)}\n  ${sleeper(guc)}${definition.slice(end)}`;
}
const INJECT = {
 journey: d => injectAfter(d, 'select * into journey from public.care_journeys where id=p_id for update;', SLEEP),
 journeyExpert: d => {
  const lock = d.indexOf("perform pg_advisory_xact_lock(hashtextextended('care:expert-capacity:'");
  assert.ok(lock > 0, 'confirm expert-capacity lock not found');
  return injectAfter(d, "message='EXPERT_UNAVAILABLE'; end if;", SLEEP_EXPERT, lock);
 },
 submit: d => injectAfter(d, "if not found then raise exception using errcode = 'P0001', message = 'NOT_FOUND'; end if;", SLEEP, d.indexOf('for update;', d.indexOf('from public.vehicles where id = vehicle'))),
 photo: d => injectAfter(d, "message = 'NOT_FOUND';\n  end if;", SLEEP),
 availability: d => injectAfter(d, 'if not found then current_revision := 0; end if;', SLEEP),
};
const classify = outcome => {
 if (!outcome.error) return 'ok';
 const output = outcome.output ?? '';
 if (output.includes('deadlock detected')) return '40P01';
 if (output.includes('lock timeout')) return '55P03';
 const match = output.match(/ERROR:\s+([A-Z_]{4,})/);
 return match ? match[1] : `OTHER:${output.split('\n')[0]}`;
};
const HASH = 'ab'.repeat(32);
const EVIDENCE_FREE = JSON.stringify({timezone: 'Australia/Adelaide', weekly_windows: [{weekday: 1, starts_at: '09:00', ends_at: '17:00'}], exceptions: []});

export async function verifyCrossLockOrder({sql, quote, result}) {
 const originals = Object.fromEntries(Object.entries(SIGS).map(([name, signature]) => [name, sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`)]));
 const restore = () => { for (const definition of Object.values(originals)) sql(definition); };
 const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
 const waitFor = async (predicate, what) => {
  for (let attempt = 0; attempt < 600; attempt++) { if (sql(predicate) !== '0') return; await wait(20); }
  throw new Error(`Cross lock-order barrier not observed: ${what}`);
 };
 const sleeping = tag => `select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%' + tag + '%')}`;
 const blocked = tag => `select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%' + tag + '%')}`;

 const adminId = randomUUID();
 sql(`insert into auth.users(id) values(${quote(adminId)}); insert into public.user_roles(user_id,role) values(${quote(adminId)},'admin') on conflict do nothing;`);
 function fixture() {
  const f = {customer: randomUUID(), tech: randomUUID(), expert: randomUUID(), id: randomUUID(), vehicle: randomUUID(), quoteId: randomUUID(), admin: adminId};
  sql(`insert into auth.users(id) values(${quote(f.customer)}),(${quote(f.tech)});
   insert into public.user_roles(user_id,role) values(${quote(f.customer)},'customer') on conflict do nothing;
   delete from public.user_roles where user_id=${quote(f.tech)};
   insert into public.user_roles(user_id,role) values(${quote(f.tech)},'technician');
   insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until)
    values(${quote(f.expert)},'Cross lock technician','Synthetic isolated expert',array['repair'],array['5000'],current_date+30);
   insert into public.care_technician_accounts(expert_id,user_id) values(${quote(f.expert)},${quote(f.tech)});
   insert into public.vehicles(id,owner_id,make,model,year) values(${quote(f.vehicle)},${quote(f.customer)},'Toyota','Cross lock order',2020);
   insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes)
    values(${quote(f.id)},${quote(f.customer)},${quote(f.vehicle)},'repair','Synthetic cross lock order','flexible',clock_timestamp()+interval '1 hour',30);
   insert into public.care_journeys(id,account_request_id,customer_details,state,expert_id,starts_at,ends_at)
    values(${quote(f.id)},${quote(f.id)},'{"postcode":"5000"}','booking_requested',${quote(f.expert)},clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour');
   insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
    values(${quote(f.quoteId)},${quote(f.id)},${quote(f.expert)},'Cross lock technician','Synthetic isolated expert','Synthetic repair',10000,'selected',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour');
   update public.care_journeys set selected_quote_id=${quote(f.quoteId)} where id=${quote(f.id)};`);
  return f;
 }
 const snapshot = f => sql(`select concat_ws('|',
   (select state from public.care_journeys where id=${quote(f.id)}),
   (select count(*) from public.care_requests where customer_id=${quote(f.customer)}),
   (select count(*) from public.care_request_photo_sets where request_id=${quote(f.id)}),
   coalesce((select revision::text from public.care_technician_availability where expert_id=${quote(f.expert)}),'-'),
   (select count(*) from public.care_journey_commands where journey_id=${quote(f.id)}))`);

 const head = (label, role, extra) => `begin;/* ${label} */set local statement_timeout='25s';set local lock_timeout='15s';${role};${extra ?? ''}`;
 const service = (label, body, gucs = {}) => `${head(label, 'set local role service_role', Object.entries(gucs).map(([k, v]) => `set local ${k}='${v}';`).join(''))}${body};commit;`;
 const customerRole = f => `set local role authenticated;set local request.jwt.claim.sub=${quote(f.customer)}`;
 const submitBody = (f, postcode) => JSON.stringify({vehicle_id: f.vehicle, service: 'repair', description: 'Synthetic cross lock submit', preferred_window: 'flexible', postcode});
 const cmd = {
  cancel: (f, label, g) => service(label, `select public.care_journey_command('cancel',${quote(f.id)}::uuid,${quote(f.admin)}::uuid,null,${quote(randomUUID())}::uuid,'{}'::jsonb)`, g),
  confirm: (f, label, g) => service(label, `select public.care_journey_command('confirm',${quote(f.id)}::uuid,${quote(f.admin)}::uuid,null,${quote(randomUUID())}::uuid,'{"availability_confirmed":true}'::jsonb)`, g),
  submit: postcode => (f, label, g) => `${head(label, customerRole(f), Object.entries(g ?? {}).map(([k, v]) => `set local ${k}='${v}';`).join(''))}select public.care_submit_request(${quote(randomUUID())}::uuid,${quote(submitBody(f, postcode))}::jsonb);commit;`,
  record: (f, label, g) => service(label, `select public.care_record_request_photos(${quote(f.id)}::uuid,1,${quote(HASH)},'account')`, g),
  heal: (f, label, g) => service(label, `select public.care_heal_request_photo_marker(${quote(f.id)}::uuid,'account')`, g),
  availability: (f, label, g) => service(label, `select public.care_technician_replace_availability(${quote(f.tech)}::uuid,${quote(randomUUID())}::uuid,0,${quote(EVIDENCE_FREE)}::jsonb)`, g),
 };
 const run = (builder, f, label, gucs) => result(builder(f, label, gucs));
 const serial = async (first, second) => {
  const f = fixture();
  const outcomes = [classify(await run(first, f, `serial_a_${f.id}`)), classify(await run(second, f, `serial_b_${f.id}`))];
  return {outcomes, snapshot: snapshot(f)};
 };
 // contention: second must be seen waiting on a lock. isolation: second must finish while the first still sleeps.
 async function race(first, second, firstGuc, mode) {
  const f = fixture(), tag = `${randomUUID()}`;
  const a = run(first, f, `first_${tag}`, {[firstGuc]: SECONDS});
  let b, secondOutcome;
  try {
   await waitFor(sleeping(`first_${tag}`), 'first session sleeping while holding its locks');
   b = run(second, f, `second_${tag}`);
   if (mode === 'contention') await waitFor(blocked(`second_${tag}`), 'second session waiting on a lock held by the first');
   else {
    secondOutcome = await b;
    assert.equal(sql(sleeping(`first_${tag}`)), '1', 'the second session finished without waiting for the first');
   }
  } catch (error) { await a; await b; throw error; }
  const outcomes = [classify(await a), classify(secondOutcome ?? await b)];
  return {outcomes, snapshot: snapshot(f), f};
 }
 const summary = {pairs: 0};
 async function pair(name, first, second, guc, mode, requireOk = true) {
  const oracle = await serial(first, second);
  assert.ok(!oracle.outcomes.some(x => x === '40P01' || x === '55P03' || x.startsWith('OTHER:')), `serial oracle ${name}: ${oracle.outcomes}`);
  const live = await race(first, second, guc, mode);
  assert.ok(!live.outcomes.includes('40P01') && !live.outcomes.includes('55P03'), `${name}: lock inversion or lock timeout ${live.outcomes}`);
  assert.deepEqual(live.outcomes, oracle.outcomes, `${name}: concurrent outcome differs from serial order`);
  assert.equal(live.snapshot, oracle.snapshot, `${name}: final state differs from serial order`);
  if (requireOk) assert.ok(live.outcomes.includes('ok'), `${name}: at least one command must succeed ${live.outcomes}`);
  summary.pairs += 1;
  console.log(JSON.stringify({test: 'cross lock order', pair: name, mode, outcomes: live.outcomes, snapshot: live.snapshot, deadlock: false}));
  return live;
 }

 try {
  sql(INJECT.journey(originals.journey)); sql(INJECT.journeyExpert(sql(`select pg_get_functiondef(${quote(SIGS.journey)}::regprocedure)`)));
  sql(INJECT.submit(originals.submit)); sql(INJECT.photo(originals.record)); sql(INJECT.photo(originals.heal)); sql(INJECT.availability(originals.availability));

  // (a) journey vs care_submit_request with the coverage check, both directions.
  const inArea = cmd.submit('5000'), outArea = cmd.submit('5290');
  const a1 = await pair('journey cancel (holds vehicle,request,journey) then in-area care_submit_request', cmd.cancel, inArea, SLEEP, 'contention');
  assert.equal(a1.outcomes[1], 'ok');
  const a2 = await pair('in-area care_submit_request (holds vehicle) then journey cancel', inArea, cmd.cancel, SLEEP, 'contention');
  assert.deepEqual(a2.outcomes, ['ok', 'ok']);
  const a3 = await pair('journey cancel then OUT-OF-AREA care_submit_request: rejected by the coverage check before any lock', cmd.cancel, outArea, SLEEP, 'isolation');
  assert.deepEqual(a3.outcomes, ['ok', 'OUT_OF_AREA']);
  assert.equal(a3.snapshot.split('|')[1], '1', 'the out-of-area attempt created no request');

  // (b) journey vs the photo-marker RPCs (care_requests FOR KEY SHARE), both directions.
  for (const [name, builder] of [['care_record_request_photos', cmd.record], ['care_heal_request_photo_marker', cmd.heal]]) {
   await pair(`journey cancel then ${name}`, cmd.cancel, builder, SLEEP, 'contention');
   await pair(`${name} (holds request key share) then journey cancel`, builder, cmd.cancel, SLEEP, 'contention');
  }

  // (c) journey vs the availability RPC: the confirm sleeps after it holds journey, expert key share and the
  // capacity advisory lock; availability takes expert FOR SHARE (compatible) and its own advisories. Neither waits.
  const c1 = await pair('journey confirm (holds request,journey,expert key share,capacity advisory) then availability replace', cmd.confirm, cmd.availability, SLEEP_EXPERT, 'isolation');
  assert.deepEqual(c1.outcomes, ['ok', 'ok']);
  const c2 = await pair('availability replace (holds expert share, schedule advisory and row) then journey confirm', cmd.availability, cmd.confirm, SLEEP, 'isolation');
  assert.deepEqual(c2.outcomes, ['ok', 'ok']);
  assert.equal(c2.snapshot.split('|')[3], '1', 'availability revision advanced exactly once');
 } finally {
  restore();
 }
 // Production bodies are back, byte for byte.
 for (const [name, signature] of Object.entries(SIGS)) {
  assert.equal(sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`), originals[name], `${name} restored`);
 }

 // ---- negative control: a real inversion (request -> vehicle versus vehicle -> request) must deadlock.
 const f = fixture();
 const invert = (label, one, two) => `begin;/* ${label} */set local statement_timeout='20s';select 1 from public.${one[0]} where id=${quote(one[1])} for update;select pg_sleep(1);select 1 from public.${two[0]} where id=${quote(two[1])} for update;commit;`;
 const [x, y] = await Promise.all([
  result(invert(`inv_x_${f.id}`, ['care_requests', f.id], ['vehicles', f.vehicle])),
  result(invert(`inv_y_${f.id}`, ['vehicles', f.vehicle], ['care_requests', f.id])),
 ]);
 const control = [classify(x), classify(y)].sort();
 assert.deepEqual(control, ['40P01', 'ok'], `the inverted negative control must deadlock exactly one session: ${control}`);
 summary.negativeControl = control.join(',');
 console.log(`PASS: cross-feature lock order ${JSON.stringify(summary)}`);
}
