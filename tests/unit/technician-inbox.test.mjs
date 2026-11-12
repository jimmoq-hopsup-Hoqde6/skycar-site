import test from 'node:test';
import assert from 'node:assert/strict';
import {readTechnicianInbox,readTechnicianDetail} from '../../src/domain/technician/inbox.mjs';
import {createTechnicianHandlers,technicianFault} from '../../src/server/technician/http.mjs';
import {safeReturnPath} from '../../src/server/auth/http.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profile={expert_id:account,business_name:'Synthetic Repair',description:'Synthetic authorised technician.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'};
const job={id,kind:'account',vehicle:'Toyota Corolla 2020',service:'repair',description:'Visible bumper scratch',postcode:'5000',state:'review',access:'invited',created_at:'2026-10-04T00:00:00Z',appointment:null,contact:null};
const inbox={profile,jobs:[job],has_more:false};
const detail={profile,job:{...job,photos:[1]}};
const quiet={logger:{info(){},error(){}}};
const request=path=>new Request(`http://localhost${path}`);

test('technician inbox/detail decode only reviewed scoped fields',()=>{
  assert.equal(readTechnicianInbox(inbox),inbox);assert.equal(readTechnicianDetail(detail,id),detail);
  for(const change of [{contact:{name:'Private customer'}},{state:'scheduled'},{customer_id:account},{kind:'unknown'},{postcode:'x'},{appointment:{starts_at:'2026-10-04T00:00:00Z',ends_at:'2026-10-03T00:00:00Z'}}]){
    assert.throws(()=>readTechnicianInbox({...inbox,jobs:[{...job,...change}]}));
  }
  for(const change of [{photos:[1,1]},{photos:[4]},{photos:[1,2,3,4]},{id:account},{contact:{name:'Premature'}},{object_path:'private/path'}])assert.throws(()=>readTechnicianDetail({...detail,job:{...detail.job,...change}},id));
  assert.throws(()=>readTechnicianInbox({...inbox,jobs:[job,job]}));
  assert.throws(()=>readTechnicianInbox({...inbox,profile:{...profile,user_id:account}}));
});
test('contact is allowed only for the selected confirmed job detail',()=>{
  const scheduled={...detail,job:{...detail.job,state:'scheduled',access:'selected',contact:{name:'Synthetic owner',phone:'0400000000',address:'1 Test Street'}}};
  assert.equal(readTechnicianDetail(scheduled,id),scheduled);
  assert.throws(()=>readTechnicianDetail({...scheduled,job:{...scheduled.job,state:'booking_requested'}},id));
  assert.throws(()=>readTechnicianDetail({...scheduled,job:{...scheduled.job,contact:{email:'private@example.test'}}},id));
});
test('technician sign-in return is allowlisted without allowing external redirects',()=>{
  assert.equal(safeReturnPath('/technician/jobs'),'/technician/jobs');
  assert.equal(safeReturnPath(`/technician/jobs/${id}`),`/technician/jobs/${id}`);
  for(const path of ['//evil.test/technician/jobs','/technician-other/jobs','/technician/../../api/v1/operations/care','/api/v1/technician/jobs'])assert.throws(()=>safeReturnPath(path));
});
test('API success is private, account-bound and carries canonical request IDs',async()=>{
  let calls=0;const handlers=createTechnicianHandlers({async read(key){calls++;return {account,data:key?detail:inbox};}},quiet);
  for(const response of [await handlers.list(request('/api/v1/technician/jobs')),await handlers.detail(request(`/api/v1/technician/jobs/${id}`),id)]){
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('X-Skycar-Account'),account);
    const body=await response.json();assert.equal(response.headers.get('X-Request-Id'),body.meta.requestId);
  }
  assert.equal(calls,2);
});
test('invalid job/query/slot is rejected before access or storage work',async()=>{
  let calls=0;const handlers=createTechnicianHandlers({async read(){calls++;},async photo(){calls++;}},quiet);
  for(const response of [await handlers.list(request('/api/v1/technician/jobs?actor=other')),await handlers.detail(request('/api/v1/technician/jobs/bad'),'bad'),await handlers.photo(request('/api/v1/technician/jobs/photos'),id,'0')])assert.equal(response.status,400);
  assert.equal(calls,0);
});
test('denied/unavailable reads never expose private fixtures and vary by Cookie',async()=>{
  for(const [code,status] of [['UNAUTHENTICATED',401],['FORBIDDEN',403],['NOT_FOUND',404],['UNAVAILABLE',503]]){
    const handlers=createTechnicianHandlers({async read(){throw technicianFault(code);}},quiet);
    const response=await handlers.list(request('/api/v1/technician/jobs'));assert.equal(response.status,status);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(response.headers.get('cache-control'),'private, no-store');
    const body=await response.json();assert.equal(body.data,undefined);assert.equal(body.error.retryable,status>=500);
  }
});
test('malformed repository/account data fails closed rather than empty-success',async()=>{
  for(const result of [{account,data:{...inbox,jobs:[{...job,contact:{name:'leak'}}]}},{account:'not-an-account',data:inbox},{account,data:{...inbox,has_more:'yes'}}]){
    const response=await createTechnicianHandlers({async read(){return result;}},quiet).list(request('/api/v1/technician/jobs'));assert.equal(response.status,503);assert.equal((await response.json()).data,undefined);
  }
});
test('private photo has account binding and no public storage URL',async()=>{
  const bytes=new Uint8Array(256);let calls=0;const handlers=createTechnicianHandlers({async photo(key,slot){assert.equal(key,id);assert.equal(slot,1);calls++;return {bytes,mime:'image/png',account};}},quiet);
  const response=await handlers.photo(request(`/api/v1/technician/jobs/${id}/photos/1`),id,'1');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('X-Skycar-Account'),account);assert.equal((await response.arrayBuffer()).byteLength,256);assert.equal(calls,1);
  const denied=await createTechnicianHandlers({async photo(){throw technicianFault('NOT_FOUND');}},quiet).photo(request('/api/v1/technician/jobs'),id,'1');assert.equal(denied.status,404);assert.equal(denied.headers.get('vary'),'Cookie');
});
