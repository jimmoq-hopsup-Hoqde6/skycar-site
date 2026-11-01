import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Runs only through the existing disposable PostgreSQL integration harness.
// No production function, migration or frozen candidate is modified.
export async function verifyCompletionLockReview({sql,quote,result}) {
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
 const waitFor=async predicate=>{
  for(let attempt=0;attempt<200;attempt++){
   if(sql(predicate)!=='0')return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Expected PostgreSQL barrier was not reached');
 };
 // This holder deliberately takes only the journey lock. The real command
 // must pass its role check and then block acquiring that final row lock.
 const holder=result(`begin;set local statement_timeout='12s';
  select 1 from public.care_journeys where id=${quote(id)} for update;
  select pg_sleep(5);/* holder_${tag} */commit;`);
 let pending;
 try {
  await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%holder_'+tag+'%')}`);
  pending=result(`begin;/* pending_${tag} */set local statement_timeout='12s';set local role service_role;
   select public.care_customer_completion_review_command(${quote(actor)}::uuid,null,${quote(key)}::uuid,'confirm_completion',${quote(id)}::uuid,'{}'::jsonb);commit;`);
  await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%pending_'+tag+'%')}`);
  // Prove this is the final journey wait: the pending backend owns the vehicle
  // row lock (a NOWAIT attempt fails), not merely its actor/key advisory lock.
  assert.throws(()=>sql(`begin;select 1 from public.vehicles where id=${quote(vehicle)} for update nowait;rollback;`),/could not obtain lock/);
  sql(`insert into public.user_roles(user_id,role) values(${quote(actor)},'technician');`);
 } finally {
  const held=await holder;
  assert.equal(held.error,undefined,'journey holder must finish normally');
 }
 assert.ok(pending,'review command must have started');
 const outcome=await pending;
 const final=sql(`select completion_review_state from public.care_journeys where id=${quote(id)}`);
 const effects=sql(`select (select count(*) from public.care_journey_commands where idempotency_key=${quote(key)})||':'||
  (select count(*) from public.care_journey_events where journey_id=${quote(id)} and type='completion_confirmed')||':'||
  (select count(*) from public.audit_events where resource_id=${quote(id)} and action='care.confirm_completion')`);
 console.log(JSON.stringify({test:'fresh command role grant during final journey lock wait',outcome:outcome.error?'rejected':'accepted',state:final,effects}));
 assert.ok(outcome.output?.includes('NOT_FOUND'),'authority changed during journey wait: fresh command must reject NOT_FOUND');
 assert.equal(final,'awaiting_review');
 assert.equal(effects,'0:0:0','rejected command leaves no command/event/audit effects');
}
