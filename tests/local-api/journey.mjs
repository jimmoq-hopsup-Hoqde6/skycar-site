import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const base='http://127.0.0.1:3340',gateway='http://127.0.0.1:55431';
const root=process.env.SKYCAR_LOCAL_STACK_DIR;
assert.ok(root && process.env.SKYCAR_LOCAL_API_TEST==='1','run only through the isolated local runner');
const secret=JSON.parse(readFileSync(root+'/secrets.json','utf8'));
const pg=process.env.SKYCAR_POSTGRES_BIN;
const psql=pg+'/psql',db='postgresql://postgres@127.0.0.1:55433/skycar_api_test';
const sql=q=>execFileSync(psql,[db,'-XqAt','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let checks=0;
const issueMode=process.env.SKYCAR_LOCAL_REVIEW_MODE==='issue';
const reviewAction=issueMode?'report_completion_issue':'confirm_completion';
const issueDetails='Synthetic inspection found the repaired surface still needs attention.';
const reviewPayload=issueMode?{details:issueDetails}:{};
const actors={};
for(const [name,role]of [['customer','customer'],['stranger','customer'],['operator','admin'],['technician','technician']]){
 const email=`skycar-local-${name}@example.invalid`,password=randomBytes(24).toString('base64url');
 const response=await fetch(gateway+'/auth/v1/admin/users',{method:'POST',headers:{authorization:`Bearer ${secret.serviceKey}`,apikey:secret.serviceKey,'content-type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});
 assert.equal(response.status,200,`local Auth Admin create ${name}`);const user=await response.json();assert.match(user.id,/^[a-f0-9-]{36}$/);
 sql(`insert into public.user_roles(user_id,role)values('${user.id}','${role}')on conflict do nothing`);
 actors[name]={id:user.id,email,password,cookies:new Map()};checks++;
}

async function request(actor,path,{method='GET',body,status=200,key=randomUUID(),account=true,form}={}){
 const headers={};if(actor){headers.cookie=[...actor.cookies].map(([k,v])=>k+'='+v).join('; ');if(account)headers['x-skycar-account']=actor.id;}
 if(method!=='GET'){headers.origin=base;headers['idempotency-key']=key;if(!form)headers['content-type']='application/json';}
 const res=await fetch(base+path,{method,headers,body:form|| (body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(20000)});
 if(actor)for(const item of res.headers.getSetCookie()){const part=item.split(';')[0];const at=part.indexOf('=');actor.cookies.set(part.slice(0,at),part.slice(at+1));}
 const bytes=Buffer.from(await res.arrayBuffer());const text=bytes.toString('utf8');let json;try{json=JSON.parse(text)}catch{json={};}
 assert.ok((Array.isArray(status)?status:[status]).includes(res.status),`${method} ${path.replace(/[a-f0-9-]{36}/g,':id')} expected ${status}, got ${res.status} (${json.error?.code||'non-JSON'})`);checks++;
 return {data:json.data,json,res,text,bytes};
}
for(const actor of Object.values(actors))await request(actor,'/api/v1/auth/sign-in',{method:'POST',body:{email:actor.email,password:actor.password}});
console.log('PASS real Auth Admin users and Next sign-in sessions');
const {customer,stranger,operator,technician}=actors;
const vehicle=(await request(customer,'/api/v1/garage/vehicles',{method:'POST',body:{make:'Toyota',model:'Local API synthetic car',year:2022},status:201})).data;
const receipt=(await request(customer,'/api/v1/care/requests',{method:'POST',body:{vehicle_id:vehicle.id,service:'repair',description:'Synthetic bumper scratch for local-only acceptance',preferred_window:'flexible',postcode:'5000'},status:201})).data;
let id=receipt.request.id;
await request(stranger,`/api/v1/care/journey/${id}`,{status:404});
await request(customer,'/api/v1/operations/care',{status:403});
await request(null,`/api/v1/care/journey/${id}`,{status:401});
const image=readFileSync(new URL('./synthetic.png',import.meta.url));
const form=()=>{const f=new FormData();f.append('photos',new Blob([image],{type:'image/png'}),'synthetic.png');return f;};
await request(customer,`/api/v1/care/journey/${id}/photos`,{method:'POST',form:form(),status:201});
const photo=await request(customer,`/api/v1/care/journey/${id}/photos/1`);assert.match(photo.res.headers.get('cache-control'),/private/);assert.deepEqual(photo.bytes,image);checks++;
await request(stranger,`/api/v1/care/journey/${id}/photos/1`,{status:404});
const journey=(action,payload,key)=>request(customer,`/api/v1/care/journey/${id}`,{method:'POST',body:{action,payload},key});
const ops=(action,payload,journeyId=id,status=200)=>request(operator,'/api/v1/operations/care',{method:'POST',body:{action,...(journeyId?{id:journeyId}:{}),payload},status});
await journey('update_details',{name:'Synthetic Customer',phone:'0400000000',suburb:'Adelaide',postcode:'5000'});
const expert=(await ops('create_expert',{business_name:'Synthetic Local Repairs',description:'Synthetic local API integration test expert only',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'},null,201)).data.expert_id;
await ops('bind_technician',{expert_id:expert,user_id:technician.id},null);
await request(technician,'/api/v1/technician/availability',{method:'PUT',body:{expected_revision:0,timezone:'Australia/Adelaide',weekly_windows:Array.from({length:7},(_,weekday)=>({weekday:weekday+1,starts_at:'00:00',ends_at:'23:59'})),exceptions:[]}});
await ops('invite_technician',{expert_id:expert});
await request(technician,`/api/v1/technician/jobs/${id}`);
const now=Date.now(),start=now+30000;
const tech=(action,payload={},key)=>request(technician,`/api/v1/technician/jobs/${id}`,{method:'POST',body:{action,payload},key});
const quote=(await tech('quote',{scope_summary:'Synthetic local repair with no payment or dispatch',total_price_cents:49500,expires_at:new Date(start-3000).toISOString(),starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString()})).data;
await journey('select_quote',{quote_id:quote.quote_id,address:'1 Synthetic Test Street'});
// Prepare a second genuine booking for the same expert/time and race confirmations.
const secondReceipt=(await request(customer,'/api/v1/care/requests',{method:'POST',body:{vehicle_id:vehicle.id,service:'repair',description:'Second synthetic local capacity race request',preferred_window:'flexible',postcode:'5000'},status:201})).data;
const other=secondReceipt.request.id;
await request(customer,`/api/v1/care/journey/${other}/photos`,{method:'POST',form:form(),status:201});
await request(customer,`/api/v1/care/journey/${other}`,{method:'POST',body:{action:'update_details',payload:{name:'Synthetic Customer',phone:'0400000000',suburb:'Adelaide',postcode:'5000'}}});
await ops('invite_technician',{expert_id:expert},other);
const otherQuote=(await request(technician,`/api/v1/technician/jobs/${other}`,{method:'POST',body:{action:'quote',payload:{scope_summary:'Second synthetic quote for capacity race only',total_price_cents:49500,expires_at:new Date(start-3000).toISOString(),starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString()}}})).data;
await request(customer,`/api/v1/care/journey/${other}`,{method:'POST',body:{action:'select_quote',payload:{quote_id:otherQuote.quote_id,address:'2 Synthetic Test Street'}}});
const confirmations=await Promise.all([ops('confirm',{availability_confirmed:true},id,[200,409]),ops('confirm',{availability_confirmed:true},other,[200,409])]);
assert.equal(confirmations.filter(x=>x.res.status===200).length,1,'exactly one overlapping real HTTP confirmation succeeds');
assert.equal(confirmations.find(x=>x.res.status===409).json.error.code,'SLOT_UNAVAILABLE');checks+=2;
if(confirmations[1].res.status===200)id=other;
console.log('PASS real request/photos, technician quote, customer selection and operations confirmation');
await sleep(Math.max(0,start-Date.now()+200));
await tech('start');
await request(technician,`/api/v1/technician/jobs/${id}/completion-photos`,{method:'POST',form:form(),status:201});
const completionKey=randomUUID();assert.equal((await tech('complete',{},completionKey)).data.replayed,false);assert.equal((await tech('complete',{},completionKey)).data.replayed,true);checks+=2;
const reviewKey=randomUUID();
if(issueMode){
 const before=(await request(customer,`/api/v1/care/journey/${id}`)).data;
 await request(customer,`/api/v1/care/journey/${id}`,{method:'POST',body:{action:reviewAction,payload:{details:'short'}},status:400});
 await request(stranger,`/api/v1/care/journey/${id}`,{method:'POST',body:{action:reviewAction,payload:reviewPayload},status:404});
 const unchanged=(await request(customer,`/api/v1/care/journey/${id}`)).data;
 assert.equal(unchanged.revision,before.revision);assert.equal(unchanged.completion_review.state,'awaiting_review');checks+=2;
}
const reviewed=(await journey(reviewAction,reviewPayload,reviewKey)).data;
assert.equal(reviewed.replayed,false);const replayed=(await journey(reviewAction,reviewPayload,reviewKey)).data;
assert.equal(replayed.replayed,true);assert.equal(replayed.revision,reviewed.revision);checks+=3;
if(issueMode){
 const conflict=await request(customer,`/api/v1/care/journey/${id}`,{method:'POST',body:{action:reviewAction,payload:{details:'Different synthetic issue details must not replace the first report.'}},key:reviewKey,status:409});
 assert.equal(conflict.json.error.code,'IDEMPOTENCY_CONFLICT');checks++;
 const overwrite=await request(customer,`/api/v1/care/journey/${id}`,{method:'POST',body:{action:'confirm_completion',payload:{}},status:409});
 assert.equal(overwrite.json.error.code,'INVALID_TRANSITION');checks++;
 const counts=sql(`select (select count(*) from public.care_journey_events where journey_id='${id}' and type='completion_issue_reported'),(select count(*) from public.audit_events where resource_id='${id}' and action='care.report_completion_issue'),(select count(*) from public.care_journey_commands where journey_id='${id}' and action='report_completion_issue')`);
 assert.equal(counts,'1|1|1');checks++;
}
const history=(await request(customer,`/api/v1/garage/vehicles/${vehicle.id}/history`)).data;
const completed=history.items.filter(x=>x.event_type==='care_service_completed');assert.equal(completed.length,1);checks++;
const snap=(await request(customer,`/api/v1/care/journey/${id}`)).data;assert.equal(snap.state,'completed');assert.equal(snap.completion_review.state,issueMode?'issue_reported':'confirmed');checks+=2;
if(issueMode){
 assert.equal(snap.completion_review.issue_details,issueDetails);assert.equal(snap.revision,reviewed.revision);checks+=2;
 const techView=await request(technician,`/api/v1/technician/jobs/${id}`);
 assert.ok(!techView.text.includes(issueDetails));assert.ok(!techView.text.includes('issue_details'));checks+=2;
 assert.ok(!JSON.stringify(snap.events).includes(issueDetails));assert.ok(!JSON.stringify(history).includes(issueDetails));checks+=2;
 const unrelated=await request(stranger,`/api/v1/care/journey/${id}`,{status:404});assert.ok(!unrelated.text.includes(issueDetails));checks++;
}
const selected=snap.quotes.find(q=>q.id===snap.selected_quote_id);assert.equal(selected.total_price_cents,49500);assert.equal(selected.currency,'AUD');assert.equal(completed[0].payload.quote_id,snap.selected_quote_id);assert.deepEqual(snap.completion_photos,[1]);checks+=4;
const completionPhoto=await request(customer,`/api/v1/care/journey/${id}/photos/1?kind=completion`);assert.deepEqual(completionPhoto.bytes,image);checks++;
await request(stranger,`/api/v1/care/journey/${id}/photos/1?kind=completion`,{status:404});
await request(stranger,`/api/v1/garage/vehicles/${vehicle.id}/history`,{status:404});
const stored=sql(`select count(*) from public.vehicle_history where vehicle_id='${vehicle.id}' and event_type='care_service_completed'`);assert.equal(stored,'1');checks++;
// Verify Storage itself denies access, not just the Next proxy route.
const storagePath=`/storage/v1/object/authenticated/private-media/care-requests/${id}/photo-1`;
const strangerAuth=await fetch(gateway+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:secret.anonKey,'content-type':'application/json'},body:JSON.stringify({email:stranger.email,password:stranger.password})});assert.equal(strangerAuth.status,200);const strangerSession=await strangerAuth.json();
const direct=await fetch(gateway+storagePath,{headers:{apikey:secret.serviceKey,authorization:`Bearer ${secret.serviceKey}`}});assert.equal(direct.status,200);assert.deepEqual(Buffer.from(await direct.arrayBuffer()),image);checks+=2;
for(const token of [secret.anonKey,strangerSession.access_token]){
 const denied=await fetch(gateway+storagePath,{headers:{apikey:secret.anonKey,authorization:`Bearer ${token}`}});const denial=await denied.json();assert.ok([400,401,403,404].includes(denied.status),'Storage denial must not be a server/proxy failure');assert.ok(['not_found','NoSuchKey','AccessDenied','Unauthorized','Forbidden'].includes(denial.error)||/not found|not authorized|permission|Unauthorized|Forbidden/i.test(denial.message||''),'Storage must return an explicit access/not-found error');checks++;
}
// Compare durable state and ledger counts across current-authority denials.
const reviewFingerprint=()=>sql(`select jsonb_build_object('journey',(select to_jsonb(j) from public.care_journeys j where id='${id}'),'events',(select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from public.care_journey_events e where journey_id='${id}'),'audit',(select jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text) from public.audit_events a where resource_id='${id}'),'commands',(select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from public.care_journey_commands c where journey_id='${id}'))`);
const beforeDenied=reviewFingerprint();
for(const role of ['technician','admin','remove_customer']){
 if(role==='remove_customer')sql(`delete from public.user_roles where user_id='${customer.id}' and role='customer'`);
 else sql(`insert into public.user_roles(user_id,role)values('${customer.id}','${role}')`);
 try{
  for(const key of [reviewKey,randomUUID()]){
   const denied=await request(customer,`/api/v1/care/journey/${id}`,{method:'POST',body:{action:reviewAction,payload:reviewPayload},key,status:404});
   assert.equal(denied.json.error.code,'NOT_FOUND');assert.ok(!denied.text.includes(issueDetails));checks+=2;
  }
  assert.equal(reviewFingerprint(),beforeDenied,'denied current-authority attempts must not mutate journey or ledgers');checks++;
 }finally{
  if(role==='remove_customer')sql(`insert into public.user_roles(user_id,role)values('${customer.id}','customer')`);
  else sql(`delete from public.user_roles where user_id='${customer.id}' and role='${role}'`);
 }
 assert.equal((await journey(reviewAction,reviewPayload,reviewKey)).data.replayed,true);checks++;
 assert.equal(reviewFingerprint(),beforeDenied,'restored-authority exact replay must remain read-only');checks++;
}
sql(`delete from public.user_roles where user_id='${technician.id}' and role='technician'`);
await request(technician,`/api/v1/technician/jobs/${id}`,{status:403});
// Real cookie replacement and old-account command binding, not a mocked identity.
await request(customer,'/api/v1/auth/sign-in',{method:'POST',body:{email:stranger.email,password:stranger.password}});
await request(customer,`/api/v1/care/journey/${id}`,{status:404});
await request(customer,'/api/v1/garage/vehicles',{method:'POST',body:{make:'Toyota',model:'Must not be created after switch'},status:409});
await request(customer,'/api/v1/auth/sign-out',{method:'POST',body:{}});
await request(customer,`/api/v1/care/journey/${id}`,{status:401});
console.log('PASS real private-Storage denial, dual-role replay denial, revoked technician and account-switch boundaries');

console.log(`PASS ${reviewAction}: ${checks} genuine local HTTP/Auth/PostgREST/Storage/PostgreSQL journey assertions; no hosted or physical-device acceptance claimed`);
writeFileSync(root+'/result.json',JSON.stringify({checks,status:'PASS',reviewAction,services:{auth:'real GoTrue',database:'real PostgreSQL',rest:'real PostgREST',storage:'real Supabase Storage'},hosted:false,physicalDevice:false},null,2));
