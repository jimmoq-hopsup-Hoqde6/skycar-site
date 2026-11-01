import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyCompletionLockOrder({sql,quote,result}) {
 const signature='public.care_customer_completion_review_command(uuid,uuid,uuid,text,uuid,jsonb)';
 const journeySignature='public.care_journey_command(text,uuid,uuid,uuid,uuid,jsonb)';
 const original=sql(`select pg_get_functiondef(${quote(signature)}::regprocedure)`);
 const originalJourney=sql(`select pg_get_functiondef(${quote(journeySignature)}::regprocedure)`);
 const advisory="  perform pg_advisory_xact_lock(hashtextextended(scope_value||':'||p_key::text,0));";
 const journeyAdvisory="  perform pg_advisory_xact_lock(hashtextextended(scope_value || ':' || p_key::text,0));";
 assert.ok(original.includes(advisory));assert.ok(originalJourney.includes(journeyAdvisory));
 const marker='  -- The advisory/row locks may have waited behind an authority change.';
 assert.ok(original.includes(marker));
 const waitFor=async predicate=>{
  for(let attempt=0;attempt<200;attempt++){
   if(sql(predicate)!=='0')return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Lock-order barrier was not observed');
 };
 try {
  for(const inverted of [false,true]) for(const reviewFirst of [false,true]) {
   const actor=randomUUID(),id=randomUUID(),vehicle=randomUUID(),key=randomUUID();
   sql(`insert into auth.users(id) values(${quote(actor)});
    insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(actor)},'Toyota','Lock order',2020);
    insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
     values(${quote(id)},${quote(actor)},${quote(vehicle)},'repair','Synthetic lock order','flexible',clock_timestamp()+interval '1 hour',30,'completed');
    insert into public.care_journeys(id,account_request_id,customer_details,state,completion_evidence)
     values(${quote(id)},${quote(id)},'{"postcode":"5000"}','in_progress','[{"slot":1,"mime_type":"image/jpeg","size_bytes":256,"sha256":"${'a'.repeat(64)}"}]');
    update public.care_journeys set state='completed' where id=${quote(id)};`);
   let definition=original;
   if(inverted){
    // Negative control restores the original vehicle/request-before-key order.
    definition=definition.replace(advisory,'').replace(marker,(reviewFirst?'  perform pg_sleep(3);\n':'')+advisory+'\n'+marker);
   }else if(reviewFirst){
    definition=definition.replace(advisory,advisory+'\n  perform pg_sleep(3);');
   }
   sql(definition);
   sql(reviewFirst?originalJourney:originalJourney.replaceAll(journeyAdvisory,journeyAdvisory+'\n  perform pg_sleep(3);'));
   const tag=`lock_order_${inverted}_${reviewFirst}_${id}`;
   const service=(body,label)=>`begin;/* ${label}_${tag} */set local statement_timeout='12s';set local role service_role;${body};commit;`;
   const review=label=>service(`select public.care_customer_completion_review_command(${quote(actor)}::uuid,null,${quote(key)}::uuid,'confirm_completion',${quote(id)}::uuid,'{}'::jsonb)`,label);
   // Completed journey is intentional: select_quote acquires its real source
   // locks then rejects INVALID_TRANSITION, without a synthetic quote mutation.
   const select=label=>service(`select public.care_journey_command('select_quote',${quote(id)}::uuid,${quote(actor)}::uuid,null,${quote(key)}::uuid,'{}'::jsonb)`,label);
   const first=result(reviewFirst?review('first'):select('first'));
   let second;
   try {
    await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%first_'+tag+'%')}`);
    second=result(reviewFirst?select('second'):review('second'));
    await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%second_'+tag+'%')}`);
   } finally {
    const firstOutcome=await first;
    assert.ok(second,'second real RPC must start');
    const secondOutcome=await second;
    const outcomes=[firstOutcome,secondOutcome];
    const deadlock=outcomes.some(x=>x.output?.includes('deadlock detected'));
    console.log(JSON.stringify({test:'intermediate lock-order cycle',inverted,reviewFirst,deadlock}));
    assert.equal(deadlock,inverted,'negative control must deadlock; candidate must not');
    if(!inverted){
     if(reviewFirst){assert.equal(firstOutcome.error,undefined);assert.ok(secondOutcome.output?.includes('IDEMPOTENCY_CONFLICT'));}
     else {assert.ok(firstOutcome.output?.includes('INVALID_TRANSITION'));assert.equal(secondOutcome.error,undefined);}
     assert.equal(sql(`select completion_review_state from public.care_journeys where id=${quote(id)}`),'confirmed');
     assert.equal(sql(`select count(*) from public.care_journey_commands where actor_scope=${quote('user:'+actor)} and idempotency_key=${quote(key)}`),'1');
     assert.equal(sql(`select count(*) from public.care_journey_events where journey_id=${quote(id)} and type='completion_confirmed'`),'1');
     assert.equal(sql(`select count(*) from public.audit_events where resource_id=${quote(id)} and action='care.confirm_completion'`),'1');
    }
   }
  }
 } finally {
  sql(original);sql(originalJourney);
 }
 console.log('PASS: both intermediate lock acquisition orders and both inverted-lock negative controls');
}
