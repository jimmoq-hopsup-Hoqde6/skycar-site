import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyTechnicianWorkStart({sql,auth,quote,result,waitForQuery}){
 let checks=0;const run=s=>Promise.resolve().then(()=>sql(s));const json=async s=>JSON.parse((await run(s)).split('\n')[0]);
 const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};const fail=async(s,code)=>{await assert.rejects(()=>run(s),e=>`${e.message}\n${e.stderr||''}`.includes(code),code);checks++;};
 const service=s=>`begin;set local role service_role;${s};commit;`;
 const admin=randomUUID(),customer=randomUUID(),other=randomUUID(),tech=randomUUID(),unlinked=randomUUID(),expert=randomUUID(),expertB=randomUUID();
 await run(`insert into auth.users(id) values(${[admin,customer,other,tech,unlinked].map(quote).join('),(')});
 insert into public.user_roles(user_id,role) values(${quote(admin)},'admin'),(${quote(customer)},'customer'),(${quote(tech)},'technician'),(${quote(unlinked)},'technician') on conflict do nothing;
 insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values
 (${quote(expert)},'Start expert','Synthetic work start specialist',array['repair'],array['5000'],'2030-12-31'),(${quote(expertB)},'Other start expert','Synthetic other specialist',array['repair'],array['5000'],'2030-12-31');
 insert into public.care_technician_accounts(expert_id,user_id) values(${quote(expert)},${quote(tech)});`);
 const command=(id,key=randomUUID(),actor=tech,payload={},action='start')=>service(`select public.care_technician_work_command(${quote(actor)},${quote(key)},${quote(action)},${quote(id)},${quote(JSON.stringify(payload))}::jsonb)`);
 const fixture=async(kind='guest',state='scheduled',assigned=expert)=>{
  const id=randomUUID(),vehicle=randomUUID(),q=randomUUID(),guestKey=randomUUID();
  if(kind==='account')await run(`insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Toyota','Start fixture',2020);
   insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state) values(${quote(id)},${quote(customer)},${quote(vehicle)},'repair','Synthetic work start request','flexible',clock_timestamp()+interval '1 hour',30,'scheduled');`);
  else await run(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(id)},${quote(guestKey)},${quote('c'.repeat(64))},'{"name":"Owner","phone":"0400000000","postcode":"5000","suburb":"Adelaide","vehicle":"Start fixture","service":"repair","description":"Synthetic work start request"}');`);
  await run(`insert into public.care_journeys(id,${kind==='account'?'account_request_id':'guest_request_id'},customer_details,state,expert_id,starts_at,ends_at) values(${quote(id)},${quote(id)},'{"postcode":"5000"}',${quote(state)},${quote(assigned)},clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
   insert into public.care_reviewed_quotes(id,journey_id,expert_id,expert_name,expert_description,scope_summary,total_price_cents,status,expires_at,starts_at,ends_at) values(${quote(q)},${quote(id)},${quote(assigned)},'Start expert','Synthetic specialist','Inspect the synthetic repair',49500,'selected',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour');
   update public.care_journeys set selected_quote_id=${quote(q)} where id=${quote(id)};`);
  return {id,vehicle,quoteId:q,guestKey};
 };
 const guest=await fixture();
 await fail(auth(tech,`select public.care_technician_work_command(${quote(tech)},gen_random_uuid(),'start',${quote(guest.id)},'{}')`),'permission denied');
 await fail(command(guest.id,randomUUID(),customer),'FORBIDDEN');await fail(command(guest.id,randomUUID(),unlinked),'FORBIDDEN');
 for(const payload of [{expert_id:expert},{evidence:[]},null])await fail(command(guest.id,randomUUID(),tech,payload),'VALIDATION_FAILED');
 await fail(command(guest.id,randomUUID(),tech,{},'complete'),'INVALID_TRANSITION');
 const unassigned=await fixture('guest','scheduled',expertB);await fail(command(unassigned.id),'NOT_FOUND');
 await run(`update public.care_journeys set starts_at=clock_timestamp()+interval '30 minutes' where id=${quote(guest.id)}`);await fail(command(guest.id),'INVALID_TRANSITION');
 await run(`update public.care_journeys set starts_at=clock_timestamp()-interval '1 hour' where id=${quote(guest.id)}`);
 for(const state of ['booking_requested','cancellation_requested','cancelled','completed','in_progress']){await run(`update public.care_journeys set state=${quote(state)} where id=${quote(guest.id)}`);await fail(command(guest.id),'INVALID_TRANSITION');}
 await run(`update public.care_journeys set state='scheduled' where id=${quote(guest.id)};update public.care_experts set postcodes=array['5001'] where id=${quote(expert)}`);await fail(command(guest.id),'EXPERT_UNAVAILABLE');
 await run(`update public.care_experts set postcodes=array['5000'],services=array['cleaning'] where id=${quote(expert)}`);await fail(command(guest.id),'EXPERT_UNAVAILABLE');
 await run(`update public.care_experts set services=array['repair'],insurance_valid_until='2020-01-01' where id=${quote(expert)}`);await fail(command(guest.id),'EXPERT_UNAVAILABLE');
 await run(`update public.care_experts set insurance_valid_until='2030-12-31' where id=${quote(expert)};delete from public.user_roles where user_id=${quote(tech)} and role='technician'`);await fail(command(guest.id),'FORBIDDEN');
 await run(`insert into public.user_roles(user_id,role) values(${quote(tech)},'technician');update public.care_technician_accounts set active=false where expert_id=${quote(expert)}`);await fail(command(guest.id),'FORBIDDEN');
 await run(`update public.care_technician_accounts set active=true where expert_id=${quote(expert)}`);
 await run(`update public.care_experts set active=false where id=${quote(expert)}`);await fail(command(guest.id),'FORBIDDEN');await run(`update public.care_experts set active=true where id=${quote(expert)}`);
 await run(`update public.care_reviewed_quotes set status='withdrawn' where id=${quote(guest.quoteId)}`);await fail(command(guest.id),'NOT_FOUND');await run(`update public.care_reviewed_quotes set status='selected' where id=${quote(guest.quoteId)}`);
 // A start is authorised by confirmed assignment even after review invitation revocation.
 await run(`insert into public.care_technician_invitations(journey_id,expert_id,active) values(${quote(guest.id)},${quote(expert)},false)`);
 const key=randomUUID(),started=await json(command(guest.id,key));equal(started,{id:guest.id,action:'start',state:'in_progress',quote_id:null,replayed:false});
 equal((await json(command(guest.id,key))).replayed,true);await fail(command(guest.id),'INVALID_TRANSITION');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(guest.id)} and type='work_started'`),'1');
 equal(await run(`select count(*) from public.audit_events where resource_id=${quote(guest.id)} and action='care.technician_start'`),'1');
 equal((await json(service(`select public.care_technician_read(${quote(tech)},${quote(guest.id)})`))).job.state,'in_progress');
 await run(`update public.care_journeys set state='completed' where id=${quote(guest.id)}`);equal((await json(command(guest.id,key))).replayed,true,'old exact result after later completion');
 await run(`update public.care_technician_accounts set active=false where expert_id=${quote(expert)}`);await fail(command(guest.id,key),'FORBIDDEN');await run(`update public.care_technician_accounts set active=true where expert_id=${quote(expert)}`);
 await run(`delete from public.user_roles where user_id=${quote(tech)} and role='technician'`);await fail(command(guest.id,key),'FORBIDDEN');await run(`insert into public.user_roles(user_id,role) values(${quote(tech)},'technician')`);
 const account=await fixture('account');
 await run(`update public.vehicles set archived_at=clock_timestamp() where id=${quote(account.vehicle)}`);await fail(command(account.id),'NOT_FOUND');
 await run(`update public.vehicles set archived_at=null where id=${quote(account.vehicle)};update public.care_requests set customer_id=${quote(other)} where id=${quote(account.id)}`);await fail(command(account.id),'NOT_FOUND');
 await run(`update public.care_requests set customer_id=${quote(customer)} where id=${quote(account.id)}`);
 const conflictKey=randomUUID();await run(`insert into public.care_technician_commands(actor_id,idempotency_key,action,journey_id,payload,result) values(${quote(tech)},${quote(conflictKey)},'quote',${quote(account.id)},'{}','{}')`);await fail(command(account.id,conflictKey),'IDEMPOTENCY_CONFLICT');
 await run("create function public.work_start_test_audit_fail() returns trigger language plpgsql as $$ begin if new.action='care.technician_start' then raise exception 'START_AUDIT_FAILURE'; end if; return new; end $$;create trigger work_start_test_audit_fail before insert on public.audit_events for each row execute function public.work_start_test_audit_fail()");
 const auditKey=randomUUID();await fail(command(account.id,auditKey),'START_AUDIT_FAILURE');
 equal(await run(`select state from public.care_journeys where id=${quote(account.id)}`),'scheduled');equal(await run(`select fulfilment_state from public.care_requests where id=${quote(account.id)}`),'scheduled');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(account.id)} and type='work_started'`),'0');equal(await run(`select count(*) from public.care_technician_commands where idempotency_key=${quote(auditKey)}`),'0');
 await run('drop trigger work_start_test_audit_fail on public.audit_events;drop function public.work_start_test_audit_fail()');
 equal((await json(command(account.id))).state,'in_progress');equal(await run(`select fulfilment_state from public.care_requests where id=${quote(account.id)}`),'in_progress');
 if(result&&waitForQuery){
  const race=await fixture(),raceKey=randomUUID(),tag='technician_start_exact_key';
  const one=result(command(race.id,raceKey).replace(';commit;',`;select pg_sleep(1);/* ${tag} */commit;`));await waitForQuery(tag);const two=result(command(race.id,raceKey));const [a,b]=await Promise.all([one,two]);equal(a.error,undefined);equal(b.error,undefined);equal(JSON.parse(b.value.split('\n')[0]).replayed,true);equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(race.id)} and type='work_started'`),'1');
  const cancelled=await fixture(),cancelTag='cancel_blocks_technician_start';const cancel=service(`select public.care_journey_command('cancel',${quote(cancelled.id)},${quote(admin)},null,gen_random_uuid(),'{}')`);
  const pending=result(cancel.replace(';commit;',`;select pg_sleep(1);/* ${cancelTag} */commit;`));await waitForQuery(cancelTag);const blocked=result(command(cancelled.id));const [c,d]=await Promise.all([pending,blocked]);equal(c.error,undefined);assert.ok(d.output?.includes('INVALID_TRANSITION'));checks++;equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(cancelled.id)} and type='work_started'`),'0');
 }
 console.log(`PASS: ${checks} technician work-start authority, shared state, exact retry, eligibility, rollback and race assertions (disposable database).`);
}
