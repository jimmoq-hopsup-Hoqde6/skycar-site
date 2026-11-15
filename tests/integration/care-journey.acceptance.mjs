import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Disposable PostgreSQL acceptance. Auth and storage are local shims; this is
// not evidence of hosted Supabase, email delivery, AI assessment or payment.
export async function verifyCareJourney({sql,auth,quote,garageCreate,carePayload,expectSqlError,result}) {
  let checks=0;
  const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
  const fails=(statement,code)=>{expectSqlError(statement,code);checks++;};
  const json=statement=>JSON.parse(sql(statement).split('\n')[0]);
  const service=statement=>`begin; set local role service_role; set local request.jwt.claim.role='service_role'; ${statement}; commit;`;
  const actor=(action,id,user,guestKey,key,payload)=>`select public.care_journey_command(${quote(action)},${id?`${quote(id)}::uuid`:'null'},${user?`${quote(user)}::uuid`:'null'},${guestKey?`${quote(guestKey)}::uuid`:'null'},${quote(key)}::uuid,${quote(JSON.stringify(payload))}::jsonb)`;
  const command=(action,id,user,payload,key=randomUUID())=>({key,sql:service(actor(action,id,user,null,key,payload))});

  const admin=randomUUID(),owner=randomUUID(),stranger=randomUUID();
  sql(`insert into auth.users(id) values (${quote(admin)}),(${quote(owner)}),(${quote(stranger)});
    insert into public.user_roles(user_id,role) values (${quote(admin)},'admin');`);

  fails(auth(owner,'select * from public.care_journeys'),'permission denied');
  fails(auth(owner,actor('request_cancel',randomUUID(),owner,null,randomUUID(),{})),'permission denied');
  fails(service(actor('create_expert',null,owner,null,randomUUID(),{
    business_name:'Owner forgery',description:'Must not be accepted as an operations expert.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31',
  })),'FORBIDDEN');

  const expertKey=randomUUID();
  const expertPayload={business_name:'Synthetic Mobile Repairs',description:'Synthetic insured expert for disposable database acceptance.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'};
  const expertResult=json(service(actor('create_expert',null,admin,null,expertKey,expertPayload)));
  equal(expertResult.replayed,false,'first expert command is new');
  const expertId=expertResult.expert_id;
  equal(json(service(actor('create_expert',null,admin,null,expertKey,expertPayload))).replayed,true,'expert creation replays');
  fails(service(actor('create_expert',null,admin,null,expertKey,{...expertPayload,business_name:'Changed'})),'IDEMPOTENCY_CONFLICT');
  equal(sql(`select count(*) from public.care_experts where id=${quote(expertId)}::uuid`),'1');

  const vehicle=garageCreate(owner,randomUUID(),'Connected journey');
  const request=json(auth(owner,`select public.care_submit_request(gen_random_uuid(),${quote(carePayload(vehicle.id))}::jsonb)`)).request;
  const requestId=request.id;
  const details={name:'Synthetic Owner',phone:'0400000000',suburb:'Adelaide',postcode:'5000'};
  const detailsKey=randomUUID();
  const firstDetails=json(service(actor('update_details',requestId,owner,null,detailsKey,details)));
  equal(firstDetails.state,'review');
  equal(json(service(actor('update_details',requestId,owner,null,detailsKey,details))).replayed,true,'same detail command replays');
  fails(service(actor('update_details',requestId,owner,null,detailsKey,{...details,name:'Changed'})),'IDEMPOTENCY_CONFLICT');
  fails(service(actor('update_details',requestId,stranger,null,randomUUID(),details)),'NOT_FOUND');

  const times=json(`select jsonb_build_object(
    'expiry',date_trunc('seconds',clock_timestamp()+interval '1 hour'),
    'start',date_trunc('seconds',clock_timestamp()+interval '1 day'),
    'end',date_trunc('seconds',clock_timestamp()+interval '1 day 2 hours'))`);
  const quotePayload={expert_id:expertId,scope_summary:'Repair and refinish the visible bumper damage',total_price_cents:49500,expires_at:times.expiry,starts_at:times.start,ends_at:times.end};
  const published=json(command('publish_quote',requestId,admin,quotePayload).sql);
  equal(published.state,'quotes_ready');
  equal(sql(`select quote_state from public.care_requests where id=${quote(requestId)}::uuid`),'issued');
  const quoteId=sql(`select id from public.care_reviewed_quotes where journey_id=${quote(requestId)}::uuid and status='issued'`);
  fails(command('publish_quote',requestId,owner,quotePayload).sql,'FORBIDDEN');

  const selected=json(command('select_quote',requestId,owner,{quote_id:quoteId,address:'1 Test Street'}).sql);
  equal(selected.state,'booking_requested');
  equal(sql(`select quote_state||':'||assignment_state from public.care_requests where id=${quote(requestId)}::uuid`),'accepted:reserved');
  fails(command('confirm',requestId,admin,{}).sql,'INVALID_TRANSITION');
  equal(json(command('confirm',requestId,admin,{availability_confirmed:true}).sql).state,'scheduled');
  equal(sql(`select assignment_state||':'||fulfilment_state from public.care_requests where id=${quote(requestId)}::uuid`),'accepted:scheduled');

  sql(`update public.care_journeys set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 hour' where id=${quote(requestId)}::uuid`);
  equal(json(command('start',requestId,admin,{}).sql).state,'in_progress');
  fails(command('complete',requestId,admin,{}).sql,'EVIDENCE_REQUIRED');
  const evidence=[{slot:1,mime_type:'image/jpeg',size_bytes:256,sha256:'a'.repeat(64)}];
  const completeKey=randomUUID();
  equal(json(command('complete',requestId,admin,{evidence},completeKey).sql).state,'completed');
  equal(json(command('complete',requestId,admin,{evidence},completeKey).sql).replayed,true,'completion safely replays after final state');
  equal(sql(`select count(*) from public.vehicle_history where vehicle_id=${quote(vehicle.id)}::uuid and event_type='care_service_completed'`),'1');
  equal(sql(`select fulfilment_state from public.care_requests where id=${quote(requestId)}::uuid`),'completed');

  async function readyBooking(label) {
    const v=garageCreate(owner,randomUUID(),label);
    const r=json(auth(owner,`select public.care_submit_request(gen_random_uuid(),${quote(carePayload(v.id))}::jsonb)`)).request;
    json(command('update_details',r.id,owner,details).sql);
    json(command('publish_quote',r.id,admin,quotePayload).sql);
    const q=sql(`select id from public.care_reviewed_quotes where journey_id=${quote(r.id)}::uuid and status='issued'`);
    json(command('select_quote',r.id,owner,{quote_id:q,address:'2 Test Street'}).sql);
    return r.id;
  }
  const capacityA=await readyBooking('Capacity A');
  const capacityB=await readyBooking('Capacity B');
  const [confirmationA,confirmationB]=await Promise.all([
    result(command('confirm',capacityA,admin,{availability_confirmed:true}).sql),
    result(command('confirm',capacityB,admin,{availability_confirmed:true}).sql),
  ]);
  const outcomes=[confirmationA,confirmationB];
  equal(outcomes.filter(value=>!value.error).length,1,'one overlapping confirmation succeeds');
  assert.ok(outcomes.find(value=>value.error)?.output.includes('SLOT_UNAVAILABLE'));checks++;
  equal(sql(`select count(*) from public.care_journeys where id in (${quote(capacityA)},${quote(capacityB)}) and state='scheduled'`),'1');

  const cancelId=outcomes[0].error?capacityA:capacityB;
  equal(json(command('request_cancel',cancelId,owner,{}).sql).state,'cancellation_requested');
  const beforeCancel=sql(`select state||':'||revision from public.care_journeys where id=${quote(cancelId)}::uuid`);
  sql(`create function public.test_journey_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'TEST_JOURNEY_AUDIT_FAILURE'; end $$;
    create trigger test_journey_audit_failure before insert on public.audit_events for each row execute function public.test_journey_audit_failure();`);
  try {
    fails(command('cancel',cancelId,admin,{}).sql,'TEST_JOURNEY_AUDIT_FAILURE');
    equal(sql(`select state||':'||revision from public.care_journeys where id=${quote(cancelId)}::uuid`),beforeCancel,'audit failure rolls back transition');
  } finally {
    sql('drop trigger test_journey_audit_failure on public.audit_events; drop function public.test_journey_audit_failure();');
  }
  equal(json(command('cancel',cancelId,admin,{}).sql).state,'cancelled');

  const guestId=randomUUID(),guestKey=randomUUID();
  const guestPayload={name:'Guest Tester',email:'guest@example.com',phone:'0400000001',suburb:'Adelaide',postcode:'5000',vehicle:'Toyota Corolla 2020',service:'repair',description:'Visible scratch on the rear bumper',preferred_window:'flexible',consent:true};
  sql(`insert into public.care_guest_requests(id,idempotency_key,fingerprint,payload) values(
    ${quote(guestId)},${quote(guestKey)},${quote('b'.repeat(64))},${quote(JSON.stringify(guestPayload))}::jsonb)`);
  const guestCommand=(action,payload,key=randomUUID(),capability=guestKey)=>service(actor(action,guestId,null,capability,key,payload));
  fails(guestCommand('update_details',details,randomUUID(),randomUUID()),'NOT_FOUND');
  equal(json(guestCommand('update_details',details)).state,'review');
  json(command('publish_quote',guestId,admin,quotePayload).sql);
  const guestQuote=sql(`select id from public.care_reviewed_quotes where journey_id=${quote(guestId)}::uuid and status='issued'`);
  equal(json(guestCommand('select_quote',{quote_id:guestQuote,address:'3 Test Street'})).state,'booking_requested');
  equal(json(guestCommand('request_cancel',{})).state,'cancellation_requested');

  fails(service(`insert into public.care_journeys(id) values (${quote(randomUUID())})`),'violates check constraint');
  equal(sql(`select count(*) from public.care_journey_commands where result->>'replayed'='true'`),'0','stored command results remain original, not replay-mutated');
  console.log(`PASS: ${checks} connected Care database assertions for authority, idempotency, capacity, evidence, rollback and guest access (disposable SQL/auth shims, not hosted acceptance).`);
}
