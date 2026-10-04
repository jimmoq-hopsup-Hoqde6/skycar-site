import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyCustomerCompletionReview({sql,auth,quote,result,waitForQuery}){
 let checks=0;const run=s=>Promise.resolve().then(()=>sql(s));const json=async s=>JSON.parse((await run(s)).split('\n')[0]);
 const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
 const fail=async(s,code)=>{await assert.rejects(()=>run(s),e=>`${e.message}\n${e.stderr||''}`.includes(code),code);checks++;};
 const service=s=>`begin;set local role service_role;${s};commit;`;
 const customer=randomUUID(),other=randomUUID(),admin=randomUUID(),technician=randomUUID();
 await run(`insert into auth.users(id) values(${[customer,other,admin,technician].map(quote).join('),(')});
  insert into public.user_roles(user_id,role) values(${quote(customer)},'customer'),(${quote(other)},'customer'),(${quote(admin)},'admin'),(${quote(technician)},'technician') on conflict do nothing;`);
 const evidence=[{slot:1,mime_type:'image/jpeg',size_bytes:256,sha256:'a'.repeat(64)}];
 const command=(id,actor,guestKey,action,payload,key=randomUUID())=>service(`select public.care_customer_completion_review_command(${actor?`${quote(actor)}::uuid`:'null'},${guestKey?`${quote(guestKey)}::uuid`:'null'},${quote(key)}::uuid,${quote(action)},${quote(id)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`);
 const fixture=async(kind='account',state='completed')=>{
  const id=randomUUID(),vehicle=randomUUID(),capability=randomUUID();
  if(kind==='account')await run(`insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(customer)},'Toyota','Review fixture',2020);
   insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state) values(${quote(id)},${quote(customer)},${quote(vehicle)},'repair','Synthetic customer completion review','flexible',clock_timestamp()+interval '1 hour',30,${state==='completed'?"'completed'":"'in_progress'"});
   insert into public.care_journeys(id,account_request_id,customer_details,state,completion_evidence) values(${quote(id)},${quote(id)},'{"postcode":"5000"}','in_progress',${quote(JSON.stringify(evidence))});`);
  else await run(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(id)},${quote(capability)},${quote('f'.repeat(64))},'{"name":"Owner","phone":"0400000000","postcode":"5000","suburb":"Adelaide","vehicle":"Review fixture","service":"repair","description":"Synthetic customer completion review"}');
   insert into public.care_journeys(id,guest_request_id,customer_details,state,completion_evidence) values(${quote(id)},${quote(id)},'{"postcode":"5000"}','in_progress',${quote(JSON.stringify(evidence))});`);
  if(state==='completed')await run(`update public.care_journeys set state='completed' where id=${quote(id)}`);
  return {id,vehicle,capability};
 };

 const account=await fixture();
 equal(await run(`select completion_review_state from public.care_journeys where id=${quote(account.id)}`),'awaiting_review');
 await fail(auth(customer,`select public.care_customer_completion_review_command(${quote(customer)},null,gen_random_uuid(),'confirm_completion',${quote(account.id)},'{}')`),'permission denied');
 await fail(command(account.id,other,null,'confirm_completion',{}),'NOT_FOUND');
 await fail(command(account.id,admin,null,'confirm_completion',{}),'NOT_FOUND');
 await fail(command(account.id,technician,null,'confirm_completion',{}),'NOT_FOUND');
 await fail(command(account.id,null,randomUUID(),'confirm_completion',{}),'NOT_FOUND');
 for(const payload of [{confirmed:true},{details:'not allowed'},null,[]])await fail(command(account.id,customer,null,'confirm_completion',payload),'VALIDATION_FAILED');
 for(const [action,payload] of [['report_completion_issue',{}],['report_completion_issue',{details:'short'}],['report_completion_issue',{details:'x'.repeat(2001)}],['report_completion_issue',{details:10}],['report_completion_issue',{details:'A valid issue report',rating:1}],['unknown',{}]])await fail(command(account.id,customer,null,action,payload),'VALIDATION_FAILED');
 const inProgress=await fixture('account','in_progress');await fail(command(inProgress.id,customer,null,'confirm_completion',{}),'INVALID_TRANSITION');
 await run(`update public.care_journeys set state='completed',completion_evidence=null where id=${quote(inProgress.id)}`);await fail(command(inProgress.id,customer,null,'confirm_completion',{}),'INVALID_TRANSITION');
 const key=randomUUID(),confirmed=await json(command(account.id,customer,null,'confirm_completion',{},key));
 equal(confirmed.review_state,'confirmed');equal(confirmed.state,'completed');equal(confirmed.replayed,false);
 equal((await json(command(account.id,customer,null,'confirm_completion',{},key))).replayed,true);
 await fail(command(account.id,customer,null,'report_completion_issue',{details:'Changed final outcome'},key),'IDEMPOTENCY_CONFLICT');
 await fail(command(account.id,customer,null,'report_completion_issue',{details:'A different final outcome'}),'INVALID_TRANSITION');
 equal(await run(`select state||':'||completion_review_state from public.care_journeys where id=${quote(account.id)}`),'completed:confirmed');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(account.id)} and type='completion_confirmed'`),'1');
 equal(await run(`select count(*) from public.audit_events where resource_id=${quote(account.id)} and action='care.confirm_completion'`),'1');
 equal(await run(`select fulfilment_state from public.care_requests where id=${quote(account.id)}`),'completed');
 equal(await run(`select count(*) from information_schema.tables where table_schema='public' and table_name like '%payment%'`),'0','review introduces no money table');

 const guest=await fixture('guest');const issueKey=randomUUID(),details='  The repaired area still has a visible colour mismatch.  ';
 await fail(command(guest.id,null,randomUUID(),'report_completion_issue',{details}),'NOT_FOUND');
 await fail(command(guest.id,customer,guest.capability,'report_completion_issue',{details}),'NOT_FOUND');
 const reported=await json(command(guest.id,null,guest.capability,'report_completion_issue',{details},issueKey));
 equal(reported.review_state,'issue_reported');equal((await json(command(guest.id,null,guest.capability,'report_completion_issue',{details},issueKey))).replayed,true);
 equal(await run(`select completion_issue_details from public.care_journeys where id=${quote(guest.id)}`),'The repaired area still has a visible colour mismatch.');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(guest.id)} and type='completion_issue_reported'`),'1');
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(guest.id)} and type like '%colour%'`),'0','event does not expose issue text');
 equal(await run(`select count(*) from public.audit_events where resource_id=${quote(guest.id)} and metadata::text like '%colour mismatch%'`),'0','audit does not duplicate issue text');

 const transferred=await fixture();await run(`update public.care_requests set customer_id=${quote(other)} where id=${quote(transferred.id)}`);
 await fail(command(transferred.id,customer,null,'confirm_completion',{}),'NOT_FOUND');
 await fail(command(transferred.id,other,null,'confirm_completion',{}),'NOT_FOUND');

 const rollback=await fixture();const before=await run(`select revision||':'||completion_review_state from public.care_journeys where id=${quote(rollback.id)}`);
 await run("create function public.customer_review_audit_fail() returns trigger language plpgsql as $$ begin if new.action like 'care.%completion%' then raise exception 'REVIEW_AUDIT_FAILURE'; end if; return new; end $$;create trigger customer_review_audit_fail before insert on public.audit_events for each row execute function public.customer_review_audit_fail()");
 const rollbackKey=randomUUID();await fail(command(rollback.id,customer,null,'report_completion_issue',{details:'A valid private completion issue.'},rollbackKey),'REVIEW_AUDIT_FAILURE');
 equal(await run(`select revision||':'||completion_review_state from public.care_journeys where id=${quote(rollback.id)}`),before);
 equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(rollback.id)} and type='completion_issue_reported'`),'0');
 equal(await run(`select count(*) from public.care_journey_commands where idempotency_key=${quote(rollbackKey)}`),'0');
 await run('drop trigger customer_review_audit_fail on public.audit_events;drop function public.customer_review_audit_fail()');

 if(result&&waitForQuery){
  const race=await fixture(),tag='customer_completion_review_race';
  const confirm=command(race.id,customer,null,'confirm_completion',{}).replace(';commit;',`;select pg_sleep(1);/* ${tag} */commit;`);
  const first=result(confirm);await waitForQuery(tag);
  const second=result(command(race.id,customer,null,'report_completion_issue',{details:'A concurrent private issue report.'}));
  const [a,b]=await Promise.all([first,second]);equal(a.error,undefined);assert.ok(b.output?.includes('INVALID_TRANSITION'));checks++;
  equal(await run(`select completion_review_state from public.care_journeys where id=${quote(race.id)}`),'confirmed');
  equal(await run(`select count(*) from public.care_journey_events where journey_id=${quote(race.id)} and type in ('completion_confirmed','completion_issue_reported')`),'1');
 }
 console.log(`PASS: ${checks} customer completion confirmation/issue authority, privacy, replay, rollback and race assertions (disposable database).`);
}
