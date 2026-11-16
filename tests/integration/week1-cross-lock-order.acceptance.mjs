import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {weekOf,tomorrowAt,publishAvailability} from './availability-fixture.mjs';
import {lockGate, track, HOLD_SECONDS, WAIT_MS, STATEMENT_TIMEOUT} from './lock-test-gate.mjs';

// Cross-feature lock order on the integrated chain. care_journey_command takes
//   advisory(scope:key) -> vehicle FOR UPDATE -> care_requests FOR UPDATE -> care_journeys FOR UPDATE
//   -> quote/expert rows -> (confirm only) care:expert-capacity advisory lock.
// This test races it, in real parallel psql sessions with lock_timeout and deadlock detection, against
//   (a) care_submit_request incl. the coverage check (20261101160000): vehicle FOR UPDATE, then inserts;
//   (b) care_record_request_photos / care_heal_request_photo_marker (20261101150000): care_requests FOR KEY SHARE,
//       then the photo-set row;
//   (c) care_technician_replace_availability (20261101063000): care_experts FOR SHARE, own advisories, schedule row.
// The session that goes FIRST holds (a GUC-driven lock_test.hold() injected into the function under test, nothing
// else changed) right after the lock named below, and keeps holding until the test releases it (./lock-test-gate.mjs).
// The SECOND starts once the first has signalled that it holds its locks and is then either proven blocked BY THE
// FIRST (pg_blocking_pids contains the first's pid; expected contention) or observed finishing while the first is
// still inside its hold (expected isolation; the hold cannot end on time, so this does not depend on timing). Every concurrent outcome and final state must equal running the same two commands serially
// in the same order, and nothing may raise 40P01 or 55P03. A negative control with a genuinely inverted pair of
// plain row locks proves the harness does detect a deadlock.
const SLEEP = 'skycar.lock_test_sleep', SLEEP_EXPERT = 'skycar.lock_test_sleep_expert', SLEEP_AVAIL = 'skycar.lock_test_sleep_avail', TAG = 'skycar.lock_test_tag';
const SIGS = {
 journey: 'public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)',
 submit: 'public.care_submit_request(uuid,jsonb)',
 record: 'public.care_record_request_photos(uuid,integer,text,text)',
 heal: 'public.care_heal_request_photo_marker(uuid,text)',
 availability: 'public.care_technician_replace_availability(uuid,uuid,integer,jsonb)',
};
const sleeper = guc => `perform lock_test.hold(current_setting('${TAG}',true), coalesce(nullif(current_setting('${guc}',true),''),'0')::numeric);`;
// Insert a sleep statement right after the single occurrence of `anchor` (a complete statement boundary).
function injectAfter(definition, anchor, guc, from = 0) {
 const at = definition.indexOf(anchor, from);
 assert.ok(at >= 0, `injection anchor not found: ${anchor}`);
 const end = at + anchor.length;
 return `${definition.slice(0, end)}\n  ${sleeper(guc)}${definition.slice(end)}`;
}
const INJECT = {
 journey: d => injectAfter(d, 'select * into journey from public.care_journeys where id=p_id for update;', SLEEP),
 // 20261115090000: confirm sleeps right after its availability check, i.e. while it holds the schedule advisory lock.
 journeyAvail: d => injectAfter(d, 'perform public.care_assert_expert_slot_available(journey.expert_id,journey.starts_at,journey.ends_at);', SLEEP_AVAIL),
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
// Fixtures publish 09:00-17:00 every day (revision 1) and book tomorrow 10:00-11:00 Adelaide. The replace commands
// rewrite revision 1: KEEP still covers the slot, AWAY (00:00-09:00) no longer does (20261115090000).
const KEEP = weekOf('08:00', '18:00'), AWAY = weekOf('00:00', '09:00');

export async function verifyCrossLockOrder({sql, quote, result}) {
 const originals = Object.fromEntries(Object.entries(SIGS).map(([name, signature]) => [name, sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`)]));
 const restore = () => { for (const definition of Object.values(originals)) sql(definition); };
 const gate = lockGate({exec: sql, quote});
 const {waitFor, holding, blockedBy, release} = gate;
 gate.setup();

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
    values(${quote(f.id)},${quote(f.id)},'{"postcode":"5000"}','booking_requested',${quote(f.expert)},${tomorrowAt(10)},${tomorrowAt(11)});
   insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
    values(${quote(f.quoteId)},${quote(f.id)},${quote(f.expert)},'Cross lock technician','Synthetic isolated expert','Synthetic repair',10000,'selected',clock_timestamp()+interval '1 hour',${tomorrowAt(10)},${tomorrowAt(11)});
   update public.care_journeys set selected_quote_id=${quote(f.quoteId)} where id=${quote(f.id)};`);
  sql(publishAvailability(quote, f.tech, weekOf('09:00', '17:00')));
  return f;
 }
 const snapshot = f => sql(`select concat_ws('|',
   (select state from public.care_journeys where id=${quote(f.id)}),
   (select count(*) from public.care_requests where customer_id=${quote(f.customer)}),
   (select count(*) from public.care_request_photo_sets where request_id=${quote(f.id)}),
   coalesce((select revision::text from public.care_technician_availability where expert_id=${quote(f.expert)}),'-'),
   (select count(*) from public.care_journey_commands where journey_id=${quote(f.id)}))`);

 const head = (label, role, extra) => `begin;/* ${label} */set local statement_timeout='${STATEMENT_TIMEOUT}';set local lock_timeout='60s';${role};${extra ?? ''}`;
 const service = (label, body, gucs = {}) => `${head(label, 'set local role service_role', Object.entries(gucs).map(([k, v]) => `set local ${k}='${v}';`).join(''))}${body};commit;`;
 const customerRole = f => `set local role authenticated;set local request.jwt.claim.sub=${quote(f.customer)}`;
 const submitBody = (f, postcode) => JSON.stringify({vehicle_id: f.vehicle, service: 'repair', description: 'Synthetic cross lock submit', preferred_window: 'flexible', postcode});
 const cmd = {
  cancel: (f, label, g) => service(label, `select public.care_journey_command('cancel',${quote(f.id)}::uuid,${quote(f.admin)}::uuid,null,${quote(randomUUID())}::uuid,'{}'::jsonb)`, g),
  confirm: (f, label, g) => service(label, `select public.care_journey_command('confirm',${quote(f.id)}::uuid,${quote(f.admin)}::uuid,null,${quote(randomUUID())}::uuid,'{"availability_confirmed":true}'::jsonb)`, g),
  submit: postcode => (f, label, g) => `${head(label, customerRole(f), Object.entries(g ?? {}).map(([k, v]) => `set local ${k}='${v}';`).join(''))}select public.care_submit_request(${quote(randomUUID())}::uuid,${quote(submitBody(f, postcode))}::jsonb);commit;`,
  record: (f, label, g) => service(label, `select public.care_record_request_photos(${quote(f.id)}::uuid,1,${quote(HASH)},'account')`, g),
  heal: (f, label, g) => service(label, `select public.care_heal_request_photo_marker(${quote(f.id)}::uuid,'account')`, g),
  availability: (f, label, g) => service(label, `select public.care_technician_replace_availability(${quote(f.tech)}::uuid,${quote(randomUUID())}::uuid,1,${quote(KEEP)}::jsonb)`, g),
  availabilityAway: (f, label, g) => service(label, `select public.care_technician_replace_availability(${quote(f.tech)}::uuid,${quote(randomUUID())}::uuid,1,${quote(AWAY)}::jsonb)`, g),
 };
 const run = (builder, f, label, gucs) => result(builder(f, label, gucs));
 const serial = async (first, second) => {
  const f = fixture();
  const outcomes = [classify(await run(first, f, `serial_a_${f.id}`)), classify(await run(second, f, `serial_b_${f.id}`))];
  return {outcomes, snapshot: snapshot(f)};
 };
 // contention: the server must report the second blocked by the first (pg_blocking_pids), then the first is released.
 // isolation: the second must finish while the first is still inside its hold. The hold ends only on release (or
 // LOCK_TEST_HOLD_TIMEOUT after HOLD_SECONDS), so "still holding" is a server fact, not a timing window.
 async function race(first, second, firstGuc, mode) {
  const f = fixture(), tag = `${randomUUID()}`, firstLabel = `first_${tag}`;
  const a = run(first, f, firstLabel, {[firstGuc]: String(HOLD_SECONDS), [TAG]: firstLabel});
  const aEnded = track(a);
  let b, secondOutcome;
  try {
   await waitFor(holding(firstLabel), 'first session holding its locks', WAIT_MS, aEnded);
   b = run(second, f, `second_${tag}`);
   const bEnded = track(b);
   if (mode === 'contention') await waitFor(blockedBy(`second_${tag}`, firstLabel), 'second session blocked by the first (pg_blocking_pids)', WAIT_MS, () => aEnded() || bEnded());
   else {
    secondOutcome = await b;
    assert.equal(sql(holding(firstLabel)), '1', 'the second session finished without waiting for the first');
   }
  } catch (error) { release(firstLabel); await a; await b; throw error; }
  release(firstLabel);
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
  sql(INJECT.journeyAvail(sql(`select pg_get_functiondef(${quote(SIGS.journey)}::regprocedure)`)));
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

  // (c) journey confirm vs the availability RPC. Since 20261115090000, confirm takes, after the capacity advisory
  // lock, the schedule advisory lock that care_technician_replace_availability holds while it rewrites windows,
  // then checks the slot. So the two serialise on that lock (contention, never a deadlock) and the check sees the
  // schedule that is current when it runs.
  // c0: confirm sleeps BEFORE the schedule lock (after the expert check): replace does not wait for it.
  const c0 = await pair('journey confirm (holds request,journey,expert key share,capacity advisory) then availability replace', cmd.confirm, cmd.availability, SLEEP_EXPERT, 'isolation');
  assert.deepEqual(c0.outcomes, ['ok', 'ok']);
  // c1: confirm sleeps AFTER its check, holding the schedule lock: replace waits for it.
  const c1 = await pair('journey confirm (holds schedule advisory after its availability check) then availability replace', cmd.confirm, cmd.availability, SLEEP_AVAIL, 'contention');
  assert.deepEqual(c1.outcomes, ['ok', 'ok']);
  assert.equal(c1.snapshot.split('|')[0], 'scheduled');
  // c2: replace sleeps holding the schedule lock and row: confirm waits for it, then checks the new schedule.
  const c2 = await pair('availability replace (holds expert share, schedule advisory and row) then journey confirm', cmd.availability, cmd.confirm, SLEEP, 'contention');
  assert.deepEqual(c2.outcomes, ['ok', 'ok']);
  assert.equal(c2.snapshot.split('|')[3], '2', 'availability revision advanced exactly once');
  // c3: a replace that removes the slot commits while confirm waits: confirm must refuse, not book.
  const c3 = await pair('availability replace removing the slot (holds schedule lock) then journey confirm', cmd.availabilityAway, cmd.confirm, SLEEP, 'contention');
  assert.deepEqual(c3.outcomes, ['ok', 'AVAILABILITY_SLOT_UNAVAILABLE']);
  assert.equal(c3.snapshot.split('|')[0], 'booking_requested', 'nothing was booked outside the new schedule');
  // c4: confirm decided first and holds the lock: the later schedule change waits and does not undo the booking.
  const c4 = await pair('journey confirm (holds schedule advisory) then availability replace removing the slot', cmd.confirm, cmd.availabilityAway, SLEEP_AVAIL, 'contention');
  assert.deepEqual(c4.outcomes, ['ok', 'ok']);
 } finally {
  restore();
 }
 // Production bodies are back, byte for byte.
 for (const [name, signature] of Object.entries(SIGS)) {
  assert.equal(sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`), originals[name], `${name} restored`);
 }

 // ---- negative control: a real inversion (request -> vehicle versus vehicle -> request) must deadlock.
 const f = fixture();
 // Each session takes its first row lock and holds; only when the server shows both holding are both released, so
 // both second-lock requests are guaranteed to cross (no sleep decides whether the inversion happens).
 const invert = (label, one, two) => `begin;/* ${label} */set local statement_timeout='${STATEMENT_TIMEOUT}';select 1 from public.${one[0]} where id=${quote(one[1])} for update;${gate.holdCall(label)};select 1 from public.${two[0]} where id=${quote(two[1])} for update;commit;`;
 const [labelX, labelY] = [`inv_x_${f.id}`, `inv_y_${f.id}`];
 const px = result(invert(labelX, ['care_requests', f.id], ['vehicles', f.vehicle]));
 const py = result(invert(labelY, ['vehicles', f.vehicle], ['care_requests', f.id]));
 try {
  await waitFor(holding(labelX), 'negative control x holding care_requests');
  await waitFor(holding(labelY), 'negative control y holding vehicles');
 } finally { release(labelX); release(labelY); }
 const [x, y] = await Promise.all([px, py]);
 gate.teardown();
 const control = [classify(x), classify(y)].sort();
 assert.deepEqual(control, ['40P01', 'ok'], `the inverted negative control must deadlock exactly one session: ${control}`);
 summary.negativeControl = control.join(',');
 console.log(`PASS: cross-feature lock order ${JSON.stringify(summary)}`);
}
