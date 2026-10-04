import test from 'node:test';
import assert from 'node:assert/strict';
import {readTechnicianCommand,readTechnicianCommandResult,readOwnTechnicianQuotes,quotePriceCents,quoteInstant} from '../../src/domain/technician/commands.mjs';
import {readTechnicianDetail} from '../../src/domain/technician/inbox.mjs';
import {createTechnicianHandlers,technicianFault,requireTechnicianAccount} from '../../src/server/technician/http.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',quoteId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload={scope_summary:'Inspect and repair the visible bumper scratch.',total_price_cents:49500,expires_at:'2030-01-01T00:00:00Z',starts_at:'2030-01-02T00:00:00Z',ends_at:'2030-01-02T02:00:00Z'};
const command={action:'quote',payload};const result={id,action:'quote',state:'quotes_ready',quote_id:quoteId,replayed:false};
const quiet={logger:{info(){},error(){}},origin:{environment:'demo',appOrigin:undefined}};
function request(body=command,headers={},path=`/api/v1/technician/jobs/${id}`){return new Request(`http://localhost${path}`,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','idempotency-key':quoteId,'x-skycar-account':account,...headers},body:typeof body==='string'?body:JSON.stringify(body)});}
test('technician command accepts only quote/decline and server-owned identity is not client input',()=>{
 assert.equal(readTechnicianCommand(command),command);assert.deepEqual(readTechnicianCommand({action:'decline',payload:{}}),{action:'decline',payload:{}});
 for(const v of [{...command,actor:account},{...command,id},{action:'confirm',payload:{}},{action:'decline',payload:{reason:'x'}},{...command,payload:{...payload,expert_id:account}}])assert.throws(()=>readTechnicianCommand(v));
});
test('technician proposal validates cents and bounded exact appointment instants',()=>{
 for(const change of [{scope_summary:'short'},{scope_summary:null},{total_price_cents:1.5},{total_price_cents:0},{total_price_cents:100000001},{total_price_cents:'49500'},{expires_at:'2030-01-03T00:00:00Z'},{starts_at:'2030-01-02T00:00'},{ends_at:payload.starts_at},{ends_at:'2030-01-10T00:00:00Z'},{ends_at:'infinity'}])assert.throws(()=>readTechnicianCommand({...command,payload:{...payload,...change}}));
 assert.equal(quotePriceCents('495.00'),49500);assert.equal(quotePriceCents('0.01'),1);for(const v of ['0','1.234','1e3','-4','1000000.01'])assert.throws(()=>quotePriceCents(v));assert.equal(quoteInstant('2030-01-01T00:00:00Z'),'2030-01-01T00:00:00.000Z');assert.throws(()=>quoteInstant('bad'));
});
test('command result and own quotes cannot expose another identity or malformed data',()=>{
 assert.equal(readTechnicianCommandResult(result,id,'quote'),result);for(const change of [{id:account},{quote_id:null},{action:'decline'},{replayed:'yes'},{state:'scheduled'},{actor_id:account}])assert.throws(()=>readTechnicianCommandResult({...result,...change},id,'quote'));
 const own={id:quoteId,...payload,currency:'AUD',status:'issued'};assert.equal(readOwnTechnicianQuotes([own]).length,1);for(const v of [[own,own],[{...own,submitted_by_technician:account}],[{...own,status:'paid'}],[{...own,currency:'USD'}],Array.from({length:21},()=>own)])assert.throws(()=>readOwnTechnicianQuotes(v));
 const profile={expert_id:account,business_name:'Synthetic Expert',description:'Synthetic repair specialist.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'};
 const detail={profile,job:{id,kind:'guest',vehicle:'Toyota Corolla',service:'repair',description:'Private scratch',postcode:'5000',state:'review',access:'invited',created_at:'2026-10-04T00:00:00Z',appointment:null,contact:null,photos:[]},own_quotes:[own]};assert.equal(readTechnicianDetail(detail,id),detail);
});
test('command passes exact actor-independent body/key/job and returns canonical private success',async()=>{
 let calls=0;const handlers=createTechnicianHandlers({async command(job,key,body,expected){assert.equal(expected,account);assert.equal(job,id);assert.equal(key,quoteId);assert.deepEqual(body,command);calls++;return {account,data:result};}},quiet);
 const response=await handlers.command(request(),id);assert.equal(calls,1);assert.equal(response.status,200);assert.equal(response.headers.get('X-Skycar-Account'),account);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');const value=await response.json();assert.deepEqual(value.data,result);assert.equal(value.meta.requestId,response.headers.get('X-Request-Id'));
});
test('invalid origin/content/key/query/body are denied before any mutation',async()=>{
 let calls=0;const handlers=createTechnicianHandlers({async command(){calls++;}},quiet);
 for(const [req,status] of [[request(command,{origin:'https://evil.test'}),403],[request(command,{'sec-fetch-site':'cross-site'}),403],[request(command,{'content-type':'text/plain'}),400],[request(command,{'idempotency-key':'bad'}),400],[request(command,{'x-skycar-account':'bad'}),400],[request(command,{},`/api/v1/technician/jobs/${id}?actor=other`),400],[request('{'),400],[request({...command,actor:account}),400],[request('x'.repeat(16385)),413]]){const response=await handlers.command(req,id);assert.equal(response.status,status);assert.equal(response.headers.get('vary'),'Cookie');}
 assert.equal(calls,0);
});
test('technician command denials/conflicts/unavailability are private and retryable only for infrastructure',async()=>{
 for(const [code,status] of [['UNAUTHENTICATED',401],['FORBIDDEN',403],['NOT_FOUND',404],['INVALID_TRANSITION',409],['IDEMPOTENCY_CONFLICT',409],['EXPERT_UNAVAILABLE',409],['UNAVAILABLE',503]]){const h=createTechnicianHandlers({async command(){throw technicianFault(code);}},quiet);const response=await h.command(request(),id);assert.equal(response.status,status);const body=await response.json();assert.equal(body.data,undefined);assert.equal(body.error.retryable,status>=500);assert.equal(response.headers.get('cache-control'),'private, no-store');}
});
test('malformed mutation response fails closed while preserving exact retry safety',async()=>{
 for(const v of [{account:'bad',data:result},{account,data:{...result,id:account}},{account,data:{...result,payout:100}}]){const response=await createTechnicianHandlers({async command(){return v;}},quiet).command(request(),id);assert.equal(response.status,503);assert.equal((await response.json()).data,undefined);}
});

test('session account precondition prevents a switched account from writing a previous draft',()=>{
 assert.doesNotThrow(()=>requireTechnicianAccount(account,account));assert.throws(()=>requireTechnicianAccount(quoteId,account),error=>error.status===403&&error.code==='FORBIDDEN');
});
