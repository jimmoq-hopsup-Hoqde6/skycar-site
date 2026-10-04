import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyTechnicianQuotes({sql,auth,quote,result,waitForQuery}){
 let checks=0;const run=s=>Promise.resolve().then(()=>sql(s));const json=async s=>JSON.parse((await run(s)).split('\n')[0]);
 const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};const fail=async(s,code)=>{await assert.rejects(()=>run(s),e=>`${e.message}\n${e.stderr||''}`.includes(code),code);checks++;};
 const service=s=>`begin;set local role service_role;${s};commit;`;
 const admin=randomUUID(),customer=randomUUID(),otherCustomer=randomUUID(),techA=randomUUID(),techB=randomUUID(),unlinked=randomUUID(),expertA=randomUUID(),expertB=randomUUID(),guest=randomUUID();
 await run(`insert into auth.users(id) values(${[admin,customer,otherCustomer,techA,techB,unlinked].map(quote).join('),(')});
 insert into public.user_roles(user_id,role) values(${quote(admin)},'admin'),(${quote(techA)},'technician'),(${quote(techB)},'technician'),(${quote(unlinked)},'technician');
 insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values
 (${quote(expertA)},'Quote expert A','Synthetic repair quote specialist',array['repair'],array['5000'],'2030-12-31'),(${quote(expertB)},'Quote expert B','Synthetic repair quote specialist',array['repair'],array['5000'],'2030-12-31');
 insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(guest)},gen_random_uuid(),${quote('b'.repeat(64))},${quote(JSON.stringify({name:'Private Owner',phone:'0400000000',postcode:'5000',suburb:'Adelaide',vehicle:'Synthetic Corolla',service:'repair',description:'A private bumper scratch'}))}::jsonb);`);
 const adminCommand=(action,id,payload)=>service(`select public.care_technician_admin_command(${quote(admin)}::uuid,gen_random_uuid(),${quote(action)},${id?`${quote(id)}::uuid`:'null'},${quote(JSON.stringify(payload))}::jsonb)`);
 const command=(actor,action,id,payload,key=randomUUID())=>service(`select public.care_technician_job_command(${quote(actor)}::uuid,${quote(key)}::uuid,${quote(action)},${quote(id)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`);
 const journey=(action,id,payload,actor=admin,guestKey=null)=>service(`select public.care_journey_command(${quote(action)},${quote(id)}::uuid,${actor?`${quote(actor)}::uuid`:'null'},${guestKey?`${quote(guestKey)}::uuid`:'null'},gen_random_uuid(),${quote(JSON.stringify(payload))}::jsonb)`);
 const status=id=>run(`select status from public.care_reviewed_quotes where id=${quote(id)}::uuid`);
 await json(adminCommand('bind_technician',null,{expert_id:expertA,user_id:techA}));await json(adminCommand('bind_technician',null,{expert_id:expertB,user_id:techB}));
 const times=await json("select jsonb_build_object('expiry',date_trunc('seconds',clock_timestamp()+interval '1 hour'),'start',date_trunc('seconds',clock_timestamp()+interval '1 day'),'end',date_trunc('seconds',clock_timestamp()+interval '1 day 2 hours'))");
 const payload={scope_summary:'Inspect and repair the bumper scratch',total_price_cents:49500,expires_at:times.expiry,starts_at:times.start,ends_at:times.end};
 await fail(auth(techA,`select public.care_technician_job_command(${quote(techA)},gen_random_uuid(),'decline',${quote(guest)},'{}')`),'permission denied');
 await fail(command(customer,'quote',guest,payload),'FORBIDDEN');await fail(command(unlinked,'quote',guest,payload),'FORBIDDEN');await fail(command(techA,'quote',guest,payload),'NOT_FOUND');
 await json(adminCommand('invite_technician',guest,{expert_id:expertA}));
 await fail(command(techB,'quote',guest,payload),'NOT_FOUND');
 for(const change of [{total_price_cents:1.1},{total_price_cents:0},{total_price_cents:100000001},{expert_id:expertB},{scope_summary:'short'},{starts_at:'2030-01-01T00:00'},{expires_at:'2020-01-01T00:00:00Z'},{ends_at:times.start},{expires_at:times.end},{ends_at:'infinity'}])await fail(command(techA,'quote',guest,{...payload,...change}),'VALIDATION_FAILED');
 await run(`update public.care_experts set insurance_valid_until=(clock_timestamp() at time zone 'Australia/Adelaide')::date where id=${quote(expertA)}::uuid`);
 await fail(command(techA,'quote',guest,payload),'EXPERT_UNAVAILABLE');await run(`update public.care_experts set insurance_valid_until='2030-12-31' where id=${quote(expertA)}::uuid`);
 const key=randomUUID(),first=await json(command(techA,'quote',guest,payload,key));equal(first.action,'quote');equal(first.state,'quotes_ready');equal(first.replayed,false);equal(await status(first.quote_id),'issued');
 equal(await run(`select submitted_by_technician from public.care_reviewed_quotes where id=${quote(first.quote_id)}::uuid`),techA);
 equal((await json(command(techA,'quote',guest,payload,key))).replayed,true);await fail(command(techA,'quote',guest,{...payload,total_price_cents:50000},key),'IDEMPOTENCY_CONFLICT');
 equal(await run(`select count(*) from public.care_reviewed_quotes where journey_id=${quote(guest)}::uuid`),'1');
 const second=await json(command(techA,'quote',guest,{...payload,total_price_cents:51000}));equal(await status(first.quote_id),'superseded');equal(await status(second.quote_id),'issued');
 await json(adminCommand('invite_technician',guest,{expert_id:expertB}));const other=await json(command(techB,'quote',guest,payload));
 const declineKey=randomUUID();equal((await json(command(techA,'decline',guest,{},declineKey))).state,'quotes_ready');equal(await status(second.quote_id),'withdrawn');equal(await status(other.quote_id),'issued');
 equal((await json(command(techA,'decline',guest,{},declineKey))).replayed,true,'decline is replayable after own invitation removed');await fail(command(techA,'quote',guest,payload),'NOT_FOUND');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(guest)}::uuid and type='quote_withdrawn'`),'1');
 const guestKey=await run(`select idempotency_key from public.care_guest_requests where id=${quote(guest)}::uuid`);
 await fail(journey('select_quote',guest,{quote_id:second.quote_id,address:'1 Test Street'},null,guestKey),'QUOTE_EXPIRED');
 await json(adminCommand('revoke_technician_invitation',guest,{expert_id:expertB}));equal(await status(other.quote_id),'withdrawn');equal(await run(`select state from public.care_journeys where id=${quote(guest)}::uuid`),'review');
 await json(adminCommand('invite_technician',guest,{expert_id:expertA}));const third=await json(command(techA,'quote',guest,payload));
 await run(`delete from public.user_roles where user_id=${quote(techA)}::uuid and role='technician'`);
 await fail(journey('select_quote',guest,{quote_id:third.quote_id,address:'1 Test Street'},null,guestKey),'EXPERT_UNAVAILABLE');await fail(command(techA,'quote',guest,payload,key),'FORBIDDEN');
 await run(`insert into public.user_roles(user_id,role) values(${quote(techA)},'technician');update public.care_technician_accounts set active=false where expert_id=${quote(expertA)}::uuid`);
 await fail(journey('select_quote',guest,{quote_id:third.quote_id,address:'1 Test Street'},null,guestKey),'EXPERT_UNAVAILABLE');await run(`update public.care_technician_accounts set active=true where expert_id=${quote(expertA)}::uuid`);
 // Audit rejection must restore both an existing proposal and a declined invitation.
 await run("create function public.technician_quote_test_audit_fail() returns trigger language plpgsql as $$ begin if new.action like 'care.technician_%' then raise exception 'QUOTE_AUDIT_FAILURE'; end if; return new; end $$;create trigger technician_quote_test_audit_fail before insert on public.audit_events for each row execute function public.technician_quote_test_audit_fail()");
 const auditKey=randomUUID();await fail(command(techA,'quote',guest,{...payload,total_price_cents:53000},auditKey),'QUOTE_AUDIT_FAILURE');equal(await status(third.quote_id),'issued');equal(await run(`select count(*) from public.care_technician_commands where idempotency_key=${quote(auditKey)}::uuid`),'0');
 await fail(command(techA,'decline',guest,{}),'QUOTE_AUDIT_FAILURE');equal(await status(third.quote_id),'issued');equal(await run(`select active from public.care_technician_invitations where journey_id=${quote(guest)}::uuid and expert_id=${quote(expertA)}::uuid`),'t');
 await run('drop trigger technician_quote_test_audit_fail on public.audit_events;drop function public.technician_quote_test_audit_fail()');
 equal((await json(journey('select_quote',guest,{quote_id:third.quote_id,address:'1 Test Street'},null,guestKey))).state,'booking_requested');
 await fail(command(techA,'quote',guest,payload),'INVALID_TRANSITION');equal((await json(journey('confirm',guest,{availability_confirmed:true}))).state,'scheduled');
 equal((await json(service(`select public.care_technician_read(${quote(techA)}::uuid,${quote(guest)}::uuid)`))).job.state,'scheduled');
 // Account ownership/archive boundaries use persisted synthetic source records.
 const vehicle=randomUUID(),accountJob=randomUUID();await run(`insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Toyota','Account fixture',2020);
 insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes) values(${quote(accountJob)},${quote(customer)},${quote(vehicle)},'repair','Synthetic account bumper scratch','flexible',clock_timestamp()+interval '1 hour',30);
 insert into public.care_journeys(id,account_request_id,customer_details) values(${quote(accountJob)},${quote(accountJob)},'{"postcode":"5000"}');`);
 await json(adminCommand('invite_technician',accountJob,{expert_id:expertA}));await run(`update public.vehicles set archived_at=clock_timestamp() where id=${quote(vehicle)}::uuid`);await fail(command(techA,'quote',accountJob,payload),'NOT_FOUND');
 await fail(`update public.vehicles set owner_id=${quote(otherCustomer)}::uuid where id=${quote(vehicle)}::uuid`,'VEHICLE_HAS_CARE_HISTORY');
 await run(`update public.vehicles set archived_at=null where id=${quote(vehicle)}::uuid;update public.care_requests set customer_id=${quote(otherCustomer)}::uuid where id=${quote(accountJob)}::uuid`);await fail(command(techA,'quote',accountJob,payload),'NOT_FOUND');
 await run(`update public.care_requests set customer_id=${quote(customer)}::uuid where id=${quote(accountJob)}::uuid`);equal((await json(command(techA,'quote',accountJob,payload))).state,'quotes_ready');equal(await run(`select quote_state from public.care_requests where id=${quote(accountJob)}::uuid`),'issued');
 // Real PostgreSQL only: race two exact keys, then technician quote against customer selection.
 if(result&&waitForQuery){
  const concurrentKey=randomUUID();const body=command(techA,'quote',accountJob,{...payload,total_price_cents:54000},concurrentKey);
  const tag='technician_quote_exact_replay';const firstCall=result(body.replace(';commit;',`;select pg_sleep(1);/* ${tag} */commit;`));await waitForQuery(tag);const secondCall=result(body);const [one,two]=await Promise.all([firstCall,secondCall]);equal(one.error,undefined);equal(two.error,undefined);equal(JSON.parse(two.value.split('\n')[0]).replayed,true);
  equal(await run(`select count(*) from public.care_technician_commands where actor_id=${quote(techA)}::uuid and idempotency_key=${quote(concurrentKey)}::uuid`),'1');
  const currentQuote=await run(`select id from public.care_reviewed_quotes where journey_id=${quote(accountJob)}::uuid and status='issued'`);
  const selectionTag='technician_customer_selection_blocks_new_quote';
  const selection=journey('select_quote',accountJob,{quote_id:currentQuote,address:'2 Test Street'},customer);
  const selected=result(selection.replace(';commit;',`;select pg_sleep(1);/* ${selectionTag} */commit;`));await waitForQuery(selectionTag);
  const lateQuote=result(command(techA,'quote',accountJob,{...payload,total_price_cents:55000}));const [selectedResult,lateResult]=await Promise.all([selected,lateQuote]);
  equal(selectedResult.error,undefined);assert.ok(lateResult.output?.includes('INVALID_TRANSITION'));checks++;
  equal(await status(currentQuote),'selected');equal(await run(`select count(*) from public.care_reviewed_quotes where journey_id=${quote(accountJob)}::uuid and total_price_cents=55000`),'0');
  await fail(journey('confirm',accountJob,{availability_confirmed:true}),'SLOT_UNAVAILABLE');

 }
 console.log(`PASS: ${checks} technician quote/decline identity, replay, withdrawal, customer selection, account ownership and rollback assertions (disposable database).`);
}
