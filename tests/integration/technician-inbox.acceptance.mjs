import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Can use a disposable PostgreSQL or PGlite SQL adapter. Hosted JWT/Storage are not proven.
export async function verifyTechnicianInbox({sql,auth,quote}) {
  let checks=0;
  const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const run=statement=>Promise.resolve().then(()=>sql(statement));
  const json=async statement=>JSON.parse((await run(statement)).split('\n')[0]);
  const fail=async(statement,code)=>{await assert.rejects(()=>run(statement),error=>`${error.message}\n${error.stderr||''}`.includes(code),code);checks++;};
  const service=statement=>`begin;set local role service_role;${statement};commit;`;
  const admin=randomUUID(),customer=randomUUID(),techA=randomUUID(),techB=randomUUID(),unlinked=randomUUID();
  const expertA=randomUUID(),expertB=randomUUID(),guestId=randomUUID();
  await run(`insert into auth.users(id) values(${quote(admin)}),(${quote(customer)}),(${quote(techA)}),(${quote(techB)}),(${quote(unlinked)});
    insert into public.user_roles(user_id,role) values(${quote(admin)},'admin'),(${quote(techA)},'technician'),(${quote(techB)},'technician'),(${quote(unlinked)},'technician');
    insert into public.care_experts(id,business_name,description,services,postcodes,insurance_valid_until) values
      (${quote(expertA)},'Synthetic expert A','Disposable technician access fixture',array['repair'],array['5000'],'2030-12-31'),
      (${quote(expertB)},'Synthetic expert B','Disposable technician access fixture',array['repair'],array['5000'],'2030-12-31');
    insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(${quote(guestId)},gen_random_uuid(),${quote('a'.repeat(64))},
      ${quote(JSON.stringify({name:'Private Owner',phone:'0400000000',suburb:'Adelaide',postcode:'5000',vehicle:'Toyota Corolla 2020',service:'repair',description:'Bumper scratch',email:'never-return@example.test'}))}::jsonb);`);
  const command=(action,id,payload,actor=admin,key=randomUUID())=>service(`select public.care_technician_admin_command(${quote(actor)}::uuid,${quote(key)}::uuid,${quote(action)},${id?`${quote(id)}::uuid`:'null'},${quote(JSON.stringify(payload))}::jsonb)`);
  const read=(actor,id=null)=>service(`select public.care_technician_read(${quote(actor)}::uuid,${id?`${quote(id)}::uuid`:'null'})`);
  await fail(command('bind_technician',null,{expert_id:expertA,user_id:techA},customer),'FORBIDDEN');
  await fail(command('bind_technician',null,{expert_id:expertA,user_id:customer}),'FORBIDDEN');
  const key=randomUUID();equal((await json(command('bind_technician',null,{expert_id:expertA,user_id:techA},admin,key))).replayed,false);
  equal((await json(command('bind_technician',null,{expert_id:expertA,user_id:techA},admin,key))).replayed,true);
  await fail(command('bind_technician',null,{expert_id:expertB,user_id:techA},admin,key),'IDEMPOTENCY_CONFLICT');
  await fail(command('bind_technician',null,{expert_id:expertA,user_id:techB}),'LINK_CONFLICT');
  await json(command('bind_technician',null,{expert_id:expertB,user_id:techB}));
  for(const table of ['care_technician_accounts','care_technician_invitations','care_technician_commands']){
    await fail(auth(techA,`select * from public.${table}`),'permission denied');
  }
  await fail(auth(techA,`select public.care_technician_read(${quote(techA)}::uuid,null)`),'permission denied');
  await fail(auth(techA,`select public.care_technician_admin_command(${quote(admin)}::uuid,gen_random_uuid(),'bind_technician',null,'{}'::jsonb)`),'permission denied');
  await fail(read(customer),'FORBIDDEN');await fail(read(unlinked),'FORBIDDEN');
  equal((await json(read(techA))).jobs,[],'linked technician sees no unrelated jobs');
  await fail(read(techA,guestId),'NOT_FOUND');
  await fail(command('invite_technician',guestId,{expert_id:expertA,unknown:true}),'VALIDATION_FAILED');
  await run(`update public.care_experts set insurance_valid_until='2020-01-01' where id=${quote(expertA)}::uuid`);
  await fail(command('invite_technician',guestId,{expert_id:expertA}),'EXPERT_UNAVAILABLE');
  equal(await run(`select count(*) from public.care_journeys where id=${quote(guestId)}::uuid`),'0','failed eligibility rolls back lazy journey');
  await run(`update public.care_experts set insurance_valid_until='2030-12-31' where id=${quote(expertA)}::uuid;
    create function public.technician_test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_AUDIT_FAILURE'; end $$;
    create trigger technician_test_audit_failure before insert on public.audit_events for each row execute function public.technician_test_audit_failure()`);
  const failedKey=randomUUID();await fail(command('invite_technician',guestId,{expert_id:expertA},admin,failedKey),'SYNTHETIC_AUDIT_FAILURE');
  equal(await run(`select count(*) from public.care_technician_commands where idempotency_key=${quote(failedKey)}::uuid`),'0','audit failure rolls back command');
  equal(await run(`select count(*) from public.care_technician_invitations where journey_id=${quote(guestId)}::uuid`),'0','audit failure rolls back invitation');
  equal(await run(`select count(*) from public.care_journeys where id=${quote(guestId)}::uuid`),'0','audit failure rolls back journey');
  await run('drop trigger technician_test_audit_failure on public.audit_events;drop function public.technician_test_audit_failure()');
  const inviteKey=randomUUID();
  equal((await json(command('invite_technician',guestId,{expert_id:expertA},admin,inviteKey))).replayed,false);
  equal((await json(command('invite_technician',guestId,{expert_id:expertA},admin,inviteKey))).replayed,true);
  equal(await run(`select count(*) from public.care_technician_invitations where journey_id=${quote(guestId)}::uuid`),'1');
  const invited=await json(read(techA,guestId));equal(invited.job.access,'invited');equal(invited.job.contact,null,'prebooking contact is redacted');equal(invited.job.appointment,null);
  equal(invited.job.vehicle,'Toyota Corolla 2020');equal(invited.profile.expert_id,expertA);
  assert.ok(!JSON.stringify(invited).includes('never-return@example.test'));checks++;
  equal((await json(read(techB))).jobs,[]);await fail(read(techB,guestId),'NOT_FOUND');
  await json(command('revoke_technician_invitation',guestId,{expert_id:expertA}));await fail(read(techA,guestId),'NOT_FOUND');
  await json(command('invite_technician',guestId,{expert_id:expertA}));await json(command('invite_technician',guestId,{expert_id:expertB}));
  equal((await json(read(techB,guestId))).job.access,'invited');
  // Use the real connected journey commands for customer selection and confirmation.
  const journeyCommand=(action,payload,actor=admin,guestKey=null)=>service(`select public.care_journey_command(${quote(action)},${quote(guestId)}::uuid,${actor?`${quote(actor)}::uuid`:'null'},${guestKey?`${quote(guestKey)}::uuid`:'null'},gen_random_uuid(),${quote(JSON.stringify(payload))}::jsonb)`);
  const times=await json("select jsonb_build_object('expiry',date_trunc('seconds',clock_timestamp()+interval '1 hour'),'start',date_trunc('seconds',clock_timestamp()+interval '1 day'),'end',date_trunc('seconds',clock_timestamp()+interval '1 day 2 hours'))");
  await json(journeyCommand('publish_quote',{expert_id:expertA,scope_summary:'Repair the visible bumper scratch',total_price_cents:49500,expires_at:times.expiry,starts_at:times.start,ends_at:times.end}));
  const quoteId=await run(`select id from public.care_reviewed_quotes where journey_id=${quote(guestId)}::uuid and status='issued'`);
  const guestKey=await run(`select idempotency_key from public.care_guest_requests where id=${quote(guestId)}::uuid`);
  await json(journeyCommand('select_quote',{quote_id:quoteId,address:'1 Synthetic Street'},null,guestKey));
  equal((await json(read(techA,guestId))).job.access,'selected');equal((await json(read(techA,guestId))).job.contact,null,'requested is not confirmed');
  await fail(read(techB,guestId),'NOT_FOUND');equal((await json(read(techB))).jobs,[],'selected expert removes competing review access');
  await json(journeyCommand('confirm',{availability_confirmed:true}));
  equal((await json(read(techA,guestId))).job.contact.address,'1 Synthetic Street');
  equal((await json(read(techA))).jobs[0].contact,null,'list never returns contact');
  await run(`delete from public.user_roles where user_id=${quote(techA)}::uuid and role='technician'`);await fail(read(techA,guestId),'FORBIDDEN');
  await run(`insert into public.user_roles(user_id,role) values(${quote(techA)},'technician');update public.care_technician_accounts set active=false where expert_id=${quote(expertA)}::uuid`);await fail(read(techA,guestId),'FORBIDDEN');
  await run(`update public.care_technician_accounts set active=true where expert_id=${quote(expertA)}::uuid`);
  await json(journeyCommand('cancel',{}));await fail(read(techA,guestId),'NOT_FOUND');
  await fail(command('invite_technician',guestId,{expert_id:expertA}),'INVALID_TRANSITION');
  equal(await run(`select count(*) from public.care_technician_commands where actor_id=${quote(admin)}::uuid and idempotency_key=${quote(inviteKey)}::uuid`),'1','same key has one command');
  console.log(`PASS: ${checks} technician identity/invitation/selection/contact/revocation permission assertions (disposable database, not hosted Auth/Storage).`);
}
