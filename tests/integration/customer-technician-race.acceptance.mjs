import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyCustomerTechnicianRace({sql,quote,result}) {
 const reviewSig='public.care_customer_completion_review_command(uuid,uuid,uuid,text,uuid,jsonb)';
 const techSig='public.care_technician_work_command(uuid,uuid,text,uuid,jsonb)';
 const originalReview=sql(`select pg_get_functiondef(${quote(reviewSig)}::regprocedure)`);
 const originalTech=sql(`select pg_get_functiondef(${quote(techSig)}::regprocedure)`);
 const reviewLock='  select * into journey from public.care_journeys where id=p_id for update;';
 const techLock=' select * into journey from public.care_journeys where id=p_id for update;';
 assert.ok(originalReview.includes(reviewLock));assert.ok(originalTech.includes(techLock));
 const evidence=[{slot:1,mime_type:'image/jpeg',size_bytes:256,sha256:'b'.repeat(64)}];
 const waitFor=async predicate=>{
  for(let attempt=0;attempt<200;attempt++){
   if(sql(predicate)!=='0')return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('Customer/technician lock barrier not observed');
 };
 try {
  for(const techFirst of [false,true]){
   const customer=randomUUID(),tech=randomUUID(),expert=randomUUID(),id=randomUUID(),vehicle=randomUUID(),qid=randomUUID(),techKey=randomUUID(),reviewKey=randomUUID();
   sql(`insert into auth.users(id) values(${quote(customer)}),(${quote(tech)});
    delete from public.user_roles where user_id=${quote(tech)};
    insert into public.user_roles(user_id,role) values(${quote(tech)},'technician');
    insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until)
     values(${quote(expert)},'Race technician','Synthetic isolated expert',array['repair'],array['5000'],current_date+30);
    insert into public.care_technician_accounts(expert_id,user_id) values(${quote(expert)},${quote(tech)});
    insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Toyota','Customer technician race',2020);
    insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
     values(${quote(id)},${quote(customer)},${quote(vehicle)},'repair','Synthetic customer technician race','flexible',clock_timestamp()+interval '1 hour',30,'in_progress');
    insert into public.care_journeys(id,account_request_id,customer_details,state,expert_id,starts_at,ends_at)
     values(${quote(id)},${quote(id)},'{"postcode":"5000"}','in_progress',${quote(expert)},clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
    insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at)
     values(${quote(qid)},${quote(id)},${quote(expert)},'Race technician','Synthetic isolated expert','Synthetic repair',10000,'selected',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
    update public.care_journeys set selected_quote_id=${quote(qid)} where id=${quote(id)};`);
   sql(techFirst?originalReview:originalReview.replace(reviewLock,'  perform pg_sleep(3);\n'+reviewLock));
   sql(techFirst?originalTech.replace(techLock,' perform pg_sleep(3);\n'+techLock):originalTech);
   const tag=`customer_technician_${techFirst}_${id}`;
   const service=(body,label)=>`begin;/* ${label}_${tag} */set local statement_timeout='12s';set local role service_role;${body};commit;`;
   const review=label=>service(`select public.care_customer_completion_review_command(${quote(customer)}::uuid,null,${quote(reviewKey)}::uuid,'confirm_completion',${quote(id)}::uuid,'{}'::jsonb)`,label);
   const complete=label=>service(`select public.care_technician_work_command(${quote(tech)}::uuid,${quote(techKey)}::uuid,'complete',${quote(id)}::uuid,${quote(JSON.stringify({evidence}))}::jsonb)`,label);
   const first=result(techFirst?complete('first'):review('first'));let second;
   try {
    await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event='PgSleep' and query like ${quote('%first_'+tag+'%')}`);
    second=result(techFirst?review('second'):complete('second'));
    await waitFor(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like ${quote('%second_'+tag+'%')}`);
   } finally {
    const a=await first;assert.ok(second);const b=await second;
    if(techFirst){assert.equal(a.error,undefined);assert.equal(b.error,undefined);}
    else {assert.ok(a.output?.includes('INVALID_TRANSITION'));assert.equal(b.error,undefined);}
    assert.equal(sql(`select state||':'||completion_review_state from public.care_journeys where id=${quote(id)}`),techFirst?'completed:confirmed':'completed:awaiting_review');
    assert.equal(sql(`select count(*) from public.care_journey_events where journey_id=${quote(id)} and type='work_completed'`),'1');
    assert.equal(sql(`select count(*) from public.care_journey_events where journey_id=${quote(id)} and type='completion_confirmed'`),techFirst?'1':'0');
    assert.equal(sql(`select count(*) from public.vehicle_history where vehicle_id=${quote(vehicle)} and event_type='care_service_completed'`),'1');
    assert.equal(sql(`select count(*) from public.care_technician_commands where actor_id=${quote(tech)} and idempotency_key=${quote(techKey)}`),'1');
    assert.equal(sql(`select count(*) from public.audit_events where resource_id=${quote(id)} and action='care.technician_complete'`),'1');
    console.log(JSON.stringify({test:'same journey customer/technician distinct-key race',techFirst,result:'PASS'}));
   }
  }
 } finally {sql(originalReview);sql(originalTech);}
}
