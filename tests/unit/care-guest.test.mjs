import test from 'node:test';
import assert from 'node:assert/strict';
import {guestInput,guestReceipt} from '../../src/domain/care/guest.mjs';
import {guestHandler} from '../../src/server/care/guest-http.mjs';
const input={name:'Test Owner',email:'OWNER@example.com',phone:'0400 000 000',suburb:'Adelaide',postcode:'5000',vehicle:'Toyota Corolla 2020',service:'repair',description:'Synthetic scratch test only.',preferred_window:'flexible',consent:true};
const key='d35e8b9f-75a0-4d0d-8393-26527c451616';
function request(body=input,origin='http://localhost:3000') {return new Request('http://localhost:3000/api/v1/care/guest-requests',{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});}
test('guest details require explicit contact consent and valid contact without account identifiers',()=>{
  assert.equal(guestInput(input).email,'owner@example.com');
  for(const changes of [{consent:false},{customer_id:key},{vehicle_id:key},{email:'bad'},{postcode:'500'},{description:'short'},{phone:'not a number'}]) assert.throws(()=>guestInput({...input,...changes}));
});
test('receipt strips personal details and rejects unconfirmed status',()=>{
  const value={id:key,stage:'request_received',created_at:'2026-10-01T03:00:00Z',email:'private@example.com'};
  assert.deepEqual(Object.keys(guestReceipt(value)),['id','stage','created_at']);
  assert.throws(()=>guestReceipt({...value,stage:'booked'}));
});
test('guest endpoint saves without any session and returns only receipt',async()=>{
  const handler=guestHandler({enabled:()=>true,save:async(gotKey,body)=>{assert.equal(gotKey,key);assert.equal(body.email,'owner@example.com');return {id:key,stage:'request_received',created_at:'2026-10-01T03:00:00Z'};}});
  const response=await handler(request());assert.equal(response.status,201);assert.equal((await response.json()).data.id,key);
});
test('cross-origin and invalid consent never reach storage',async()=>{
  let calls=0;const handler=guestHandler({enabled:()=>true,save:()=>{calls++;}});
  assert.equal((await handler(request(input,'https://evil.example'))).status,403);
  assert.equal((await handler(request({...input,consent:false}))).status,400);assert.equal(calls,0);
});
test('storage failure never emits a saved receipt or exposes provider error',async()=>{
  const handler=guestHandler({enabled:()=>true,save:()=>{throw new Error('secret provider details');}});
  const response=await handler(request());const body=await response.json();assert.equal(response.status,503);assert.equal(body.data,undefined);assert.equal(JSON.stringify(body).includes('secret provider'),false);
});
