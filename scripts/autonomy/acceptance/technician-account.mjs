// Trusted operator acceptance. Not supplied to or writable by the coding model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root = process.env.SKYCAR_CANDIDATE_ROOT || '/workspace';
const {createTechnicianHandlers} = await import(pathToFileURL(root + '/src/server/technician/http.mjs'));
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const quiet={logger:{info(){},error(){}},origin:{environment:'demo',appOrigin:undefined}};
for (const action of ['quote','decline','start','complete']) {
  for (const mismatch of [false,true]) {
    test(`${action}: ${mismatch?'rejects switched':'preserves same'} account`, async()=>{
      const payload=action==='quote'?{scope_summary:'Inspect the synthetic bumper scratch.',total_price_cents:100,
        expires_at:'2030-01-01T00:00:00Z',starts_at:'2030-01-02T00:00:00Z',ends_at:'2030-01-02T01:00:00Z'}:{};
      const result={id,action,state:{quote:'quotes_ready',decline:'review',start:'in_progress',complete:'completed'}[action],
        quote_id:action==='quote'?other:null,replayed:false};
      let calls=0;
      const handlers=createTechnicianHandlers({async command(job,key,command,expected){
        calls++;assert.equal(job,id);assert.equal(key,other);assert.equal(expected,account);
        assert.deepEqual(command,{action,payload});return {account:mismatch?other:account,data:result};
      }},quiet);
      const response=await handlers.command(new Request(`http://localhost/api/v1/technician/jobs/${id}`,{
        method:'POST',headers:{origin:'http://localhost','content-type':'application/json',
          'idempotency-key':other,'x-skycar-account':account},body:JSON.stringify({action,payload})}),id);
      assert.equal(calls,1);assert.equal(response.status,mismatch?403:200);
      assert.equal(response.headers.get('Cache-Control'),'private, no-store');
      assert.equal(response.headers.get('Vary'),'Cookie');
      const body=await response.json();
      if(mismatch){assert.equal(body.error.code,'FORBIDDEN');assert.equal(body.data,undefined);
        assert.notEqual(response.headers.get('X-Skycar-Account'),other);
      }else{assert.equal(response.headers.get('X-Skycar-Account'),account);assert.deepEqual(body.data,result);}
    });
  }
}
