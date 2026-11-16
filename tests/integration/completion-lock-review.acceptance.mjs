import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lockGate, STATEMENT_TIMEOUT} from './lock-test-gate.mjs';

// Runs only through the existing disposable PostgreSQL integration harness.
// No production function, migration or frozen candidate is modified.
export async function verifyCompletionLockReview({sql,quote,result}) {
 const gate=lockGate({exec:sql,quote});
 gate.setup();
 try {
 for(const action of ['confirm_completion','report_completion_issue']) for(const roleChange of ['technician','admin','remove_customer']) {
 const actor=randomUUID(),id=randomUUID(),vehicle=randomUUID(),key=randomUUID();
 sql(`insert into auth.users(id) values(${quote(actor)});
  insert into public.user_roles(user_id,role) values(${quote(actor)},'customer') on conflict do nothing;
  insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(actor)},'Toyota','Lock review',2020);
  insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
   values(${quote(id)},${quote(actor)},${quote(vehicle)},'repair','Synthetic lock review','flexible',clock_timestamp()+interval '1 hour',30,'completed');
  insert into public.care_journeys(id,account_request_id,customer_details,state,completion_evidence)
   values(${quote(id)},${quote(id)},'{"postcode":"5000"}','in_progress','[{"slot":1,"mime_type":"image/jpeg","size_bytes":256,"sha256":"${'a'.repeat(64)}"}]');
  update public.care_journeys set state='completed' where id=${quote(id)};`);
 const tag=`review_journey_wait_${id}`;
 // This holder deliberately takes only the journey lock. The real command
 // must pass its role check and then block acquiring that final row lock.
 // The holder signals after its lock (lock_test.hold) and keeps it until released below.
 const holder=result(`begin;/* holder_${tag} */set local statement_timeout='${STATEMENT_TIMEOUT}';
  select 1 from public.care_journeys where id=${quote(id)} for update;
  ${gate.holdCall('holder_'+tag)};commit;`);
 let pending;
 try {
  await gate.waitFor(gate.holding('holder_'+tag),`journey holder ${tag}`);
  pending=result(`begin;/* pending_${tag} */set local statement_timeout='${STATEMENT_TIMEOUT}';set local role service_role;
   select public.care_customer_completion_review_command(${quote(actor)}::uuid,null,${quote(key)}::uuid,${quote(action)},${quote(id)}::uuid,${quote(JSON.stringify(action==='confirm_completion'?{}:{details:'A private issue after the lock wait.'}))}::jsonb);commit;`);
  await gate.waitFor(gate.blockedBy('pending_'+tag,'holder_'+tag),`review command blocked by the journey holder ${tag} (pg_blocking_pids)`);
  // Prove this is the final journey wait: the pending backend owns the vehicle
  // row lock (a NOWAIT attempt fails), not merely its actor/key advisory lock.
  assert.throws(()=>sql(`begin;select 1 from public.vehicles where id=${quote(vehicle)} for update nowait;rollback;`),/could not obtain lock/);
  if(roleChange==='remove_customer')sql(`delete from public.user_roles where user_id=${quote(actor)} and role='customer'`);
  else sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},${quote(roleChange)});`);
 } finally {
  gate.release('holder_'+tag);
  const held=await holder;
  assert.equal(held.error,undefined,'journey holder must finish normally');
 }
 assert.ok(pending,'review command must have started');
 const outcome=await pending;
 const final=sql(`select completion_review_state from public.care_journeys where id=${quote(id)}`);
 const effects=sql(`select (select count(*) from public.care_journey_commands where idempotency_key=${quote(key)})||':'||
  (select count(*) from public.care_journey_events where journey_id=${quote(id)} and type in ('completion_confirmed','completion_issue_reported'))||':'||
  (select count(*) from public.audit_events where resource_id=${quote(id)} and action in ('care.confirm_completion','care.report_completion_issue'))`);
 console.log(JSON.stringify({test:'fresh command role change during final journey lock wait',action,roleChange,outcome:outcome.error?'rejected':'accepted',state:final,effects}));
 assert.ok(outcome.output?.includes('NOT_FOUND'),'authority changed during journey wait: fresh command must reject NOT_FOUND');
 assert.equal(final,'awaiting_review');
 assert.equal(effects,'0:0:0','rejected command leaves no command/event/audit effects');
 }
 } finally { gate.teardown(); }
}
