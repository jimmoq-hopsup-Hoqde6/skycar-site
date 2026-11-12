import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTechnicianHandlers,technicianFault} from '../../src/server/technician/http.mjs';
import {readTechnicianCommand,readTechnicianCommandResult} from '../../src/domain/technician/commands.mjs';
import {readTechnicianDetail} from '../../src/domain/technician/inbox.mjs';
import {verifyCompletionEvidence} from '../../src/server/care/completion-evidence.mjs';
import {readGuestPhotos,storeCarePhotos} from '../../src/server/care/guest-photos.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quiet={logger:{info(){},error(){}},origin:{environment:'demo',appOrigin:undefined}};
const bytes=Buffer.alloc(256,1);bytes.set([255,216,255]);
const meta={slot:1,mime_type:'image/jpeg',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
function request(files=[new File([bytes],'finished.jpg',{type:'image/jpeg'})],headers={},extra=false){const form=new FormData();files.forEach(f=>form.append('photos',f));if(extra)form.append('expert_id',account);return new Request(`http://localhost/api/v1/technician/jobs/${id}/completion-photos`,{method:'POST',headers:{origin:'http://localhost','X-Skycar-Account':account,...headers},body:form});}
test('completion media is bounded, content-checked and account-bound before repository writes',async()=>{
 let calls=0;const handlers=createTechnicianHandlers({async upload(job,photos,expected){assert.equal(job,id);assert.equal(expected,account);assert.equal(photos.length,1);assert.deepEqual(photos[0].bytes,bytes);calls++;return {account,stored:photos.length};}},quiet);
 const response=await handlers.upload(request(),id);assert.equal(response.status,201);assert.equal(response.headers.get('X-Skycar-Account'),account);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');assert.deepEqual((await response.json()).data,{stored:1});
 for(const [r,status] of [[request([]),400],[request(undefined,{'x-skycar-account':'bad'}),400],[request(undefined,{origin:'https://evil.test'}),403],[request(undefined,{},true),400],[request([new File([Buffer.alloc(256)],'fake.jpg',{type:'image/jpeg'})]),400],[request([new File([bytes],'fake.png',{type:'image/png'})]),400],[request(Array.from({length:4},()=>new File([bytes],'a.jpg',{type:'image/jpeg'}))),400]])assert.equal((await handlers.upload(r,id)).status,status);
 const big=new Request(`http://localhost/api/v1/technician/jobs/${id}/completion-photos`,{method:'POST',headers:{origin:'http://localhost','X-Skycar-Account':account,'Content-Type':'multipart/form-data; boundary=x'},body:'a'.repeat(2800001)});assert.equal((await handlers.upload(big,id)).status,413);assert.equal(calls,1);
});
test('denied upload and invalid server results never expose private media metadata',async()=>{
 for(const [code,status] of [['UNAUTHENTICATED',401],['FORBIDDEN',403],['NOT_FOUND',404],['INVALID_TRANSITION',409],['IDEMPOTENCY_CONFLICT',409],['UNAVAILABLE',503]]){const response=await createTechnicianHandlers({async upload(){throw technicianFault(code);}},quiet).upload(request(),id);assert.equal(response.status,status);const b=await response.json();assert.equal(b.data,undefined);assert.equal(b.error.retryable,status===503);}
 for(const result of [{account:'bad',stored:1},{account,stored:2},{account:id,stored:1}]){const r=await createTechnicianHandlers({async upload(){return result;}},quiet).upload(request(),id);assert.ok([403,503].includes(r.status));assert.equal((await r.json()).data,undefined);}
});
test('completion byte route remains private and canonical on denials',async()=>{
 const h=createTechnicianHandlers({async completionPhoto(job,slot){assert.equal(job,id);assert.equal(slot,1);return {account,bytes,mime:'image/jpeg'};}},quiet);const req=new Request(`http://localhost/api/v1/technician/jobs/${id}/completion-photos/1`);const r=await h.photo(req,id,'1',true);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('X-Skycar-Account'),account);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 const denied=await createTechnicianHandlers({async completionPhoto(){throw technicianFault('NOT_FOUND');}},quiet).photo(req,id,'1',true);assert.equal(denied.status,404);assert.equal(denied.headers.get('Vary'),'Cookie');
});
test('completion needs every private byte with matching MIME, length, content hash and magic',async()=>{
 assert.deepEqual(await verifyCompletionEvidence([meta],async()=>({bytes,mime:'image/jpeg'})),[meta]);
 await assert.rejects(()=>verifyCompletionEvidence([],()=>{}),e=>e.code==='EVIDENCE_REQUIRED');
 for(const photo of [{bytes:bytes.subarray(0,128),mime:'image/jpeg'},{bytes:Buffer.alloc(256),mime:'image/jpeg'},{bytes,mime:'image/png'}])await assert.rejects(()=>verifyCompletionEvidence([meta],async()=>photo),e=>e.code==='UNAVAILABLE');
 const invalid=Buffer.alloc(256);await assert.rejects(()=>verifyCompletionEvidence([{...meta,sha256:createHash('sha256').update(invalid).digest('hex')}],async()=>({bytes:invalid,mime:'image/jpeg'})),e=>e.code==='UNAVAILABLE');
 await assert.rejects(()=>verifyCompletionEvidence([meta,{...meta,slot:2}],async slot=>{if(slot===2)throw new Error('missing private bytes');return {bytes,mime:'image/jpeg'};}),/missing private bytes/);
});
test('partial private upload retries identical content and rejects a changed manifest without overwrite',async()=>{
 const objects=new Map();let fail=true;const bucket={async upload(path,value){if(objects.has(path))return {error:{message:'exists'}};if(path.endsWith('photo-1')&&fail){fail=false;return {error:{message:'transient'}};}objects.set(path,Buffer.from(value));return {};},async download(path){return objects.has(path)?{data:new Blob([objects.get(path)])}:{error:{message:'missing'}};}};
 const photos=await readGuestPhotos([new File([bytes],'a.jpg',{type:'image/jpeg'})]);await assert.rejects(()=>storeCarePhotos(bucket,`care-completion/${id}`,photos),e=>e.code==='UNAVAILABLE');await storeCarePhotos(bucket,`care-completion/${id}`,photos);assert.equal(objects.size,2);
 const changed=Buffer.from(bytes);changed[8]=2;const other=await readGuestPhotos([new File([changed],'a.jpg',{type:'image/jpeg'})]);await assert.rejects(()=>storeCarePhotos(bucket,`care-completion/${id}`,other),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.deepEqual(objects.get(`care-completion/${id}/photo-1`),bytes);
});
test('browser complete cannot supply evidence metadata or unrelated actions/results',()=>{
 assert.deepEqual(readTechnicianCommand({action:'complete',payload:{}}),{action:'complete',payload:{}});assert.throws(()=>readTechnicianCommand({action:'complete',payload:{evidence:[meta]}}));
 const result={id,action:'complete',state:'completed',quote_id:null,replayed:false};assert.equal(readTechnicianCommandResult(result,id,'complete'),result);assert.throws(()=>readTechnicianCommandResult({...result,state:'in_progress'},id,'complete'));
 const profile={expert_id:account,business_name:'Synthetic Expert',description:'Synthetic repair specialist.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'};
 const job={id,kind:'guest',vehicle:'Toyota',service:'repair',description:'Private repair',postcode:'5000',state:'in_progress',access:'selected',created_at:'2026-10-04T00:00:00Z',appointment:null,contact:null,photos:[]};
 assert.doesNotThrow(()=>readTechnicianDetail({profile,job,completion_photos:[1]},id));assert.throws(()=>readTechnicianDetail({profile,job:{...job,state:'scheduled'},completion_photos:[1]},id));assert.throws(()=>readTechnicianDetail({profile,job,completion_photos:[2]},id));
});
