// Independent review of frozen #59. Embedded PostgreSQL, not hosted Auth/storage
// or multi-connection concurrency proof. Requires a separately installed PGlite.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {verifyCustomerCompletionReview} from '../integration/customer-completion-review.acceptance.mjs';
import {verifyTechnicianInbox} from '../integration/technician-inbox.acceptance.mjs';
import {verifyTechnicianQuotes} from '../integration/technician-quotes.acceptance.mjs';
import {verifyTechnicianWorkStart} from '../integration/technician-work-start.acceptance.mjs';
import {verifyTechnicianCompletion} from '../integration/technician-completion.acceptance.mjs';

const modulePath=process.env.SKYCAR_REVIEW_PGLITE_MODULE;
if(!modulePath)throw new Error('Set SKYCAR_REVIEW_PGLITE_MODULE to the installed PGlite module; never use hosted fixtures.');
const {PGlite}=await import(modulePath);
const db=new PGlite();
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
async function sql(statement){
 try{
  const results=await db.exec(statement);
  return results.flatMap(r=>r.rows.map(row=>Object.values(row).map(v=>v===null?'':typeof v==='object'?JSON.stringify(v):typeof v==='boolean'?(v?'t':'f'):String(v)).join('|'))).join('\n');
 }catch(error){await db.exec('rollback');throw error;}
}
const auth=(actor,statement)=>`begin;set local role authenticated;set local request.jwt.claim.sub=${quote(actor)};${statement};commit;`;
const service=statement=>`begin;set local role service_role;${statement};commit;`;
try{
 await sql(await readFile('tests/integration/bootstrap.sql','utf8'));
 for(const name of (await readdir('supabase/migrations')).filter(v=>v.endsWith('.sql')).sort())await sql(await readFile(`supabase/migrations/${name}`,'utf8'));
 await verifyTechnicianInbox({sql,auth,quote});
 await verifyTechnicianQuotes({sql,auth,quote});
 await verifyTechnicianWorkStart({sql,auth,quote});
 await verifyTechnicianCompletion({sql,auth,quote});
 await verifyCustomerCompletionReview({sql,auth,quote});
 const evidence=[{slot:1,mime_type:'image/jpeg',size_bytes:256,sha256:'a'.repeat(64)}];
 for(const extraRole of ['admin','technician']){
  const actor=randomUUID(),vehicle=randomUUID(),id=randomUUID();
  await sql(`insert into auth.users(id) values(${quote(actor)});
   insert into public.user_roles(user_id,role) values(${quote(actor)},'customer'),(${quote(actor)},${quote(extraRole)}) on conflict do nothing;
   insert into public.vehicles(id,owner_id,make,model,year) values(${quote(vehicle)},${quote(actor)},'Toyota','Synthetic review',2020);
   insert into public.care_requests(id,customer_id,vehicle_id,service,description,preferred_window,next_update_at,escalation_minutes,fulfilment_state)
    values(${quote(id)},${quote(actor)},${quote(vehicle)},'repair','Synthetic completion review','flexible',now()+interval '1 hour',30,'completed');
   insert into public.care_journeys(id,account_request_id,customer_details,state,completion_evidence)
    values(${quote(id)},${quote(id)},'{}','in_progress',${quote(JSON.stringify(evidence))});
   update public.care_journeys set state='completed' where id=${quote(id)};`);
  const value=JSON.parse(await sql(service(`select public.care_customer_completion_review_command(${quote(actor)}::uuid,null,${quote(randomUUID())}::uuid,'confirm_completion',${quote(id)}::uuid,'{}')`)));
  assert.equal(value.review_state,'confirmed');
  console.log(`REPRODUCED contract violation: customer+${extraRole} can confirm completion; contract says never ${extraRole}.`);
 }
 console.log('Independent reproduction complete. Finding remains open; this is not an acceptance PASS.');
}finally{await db.close();}
