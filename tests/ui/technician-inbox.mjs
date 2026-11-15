// Mocked browser handoff; database permissions are covered separately.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3199',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',expertId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',techId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3199'],{stdio:'ignore'});let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const ops=await browser.newPage(),tech=await browser.newPage({viewport:{width:390,height:844}});const errors=[];for(const p of [ops,tech])p.on('pageerror',e=>errors.push(e.message));
 let linked=false,invited=false,denied=false,confirmed=false;const commands=[],photos=[];const now=new Date().toISOString();
 const profile={expert_id:expertId,business_name:'Synthetic Panel Care',description:'Private repair specialist',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'};
 const expert={id:expertId,...profile,expert_id:undefined,active:true};
 const job=detail=>({id,kind:'guest',vehicle:'Toyota Corolla 2020',service:'repair',description:'Private bumper scratch',postcode:'5000',state:confirmed?'scheduled':'review',access:confirmed?'selected':'invited',created_at:now,appointment:confirmed?{starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString()}:null,contact:detail&&confirmed?{name:'Private Owner',phone:'0400000000',address:'1 Synthetic Street',suburb:'Adelaide',postcode:'5000'}:null,...(detail?{photos:[1]}:{})});
 await ops.route('**/api/v1/operations/care**',async route=>{const req=route.request(),url=new URL(req.url());
  if(req.method()==='POST'){const body=req.postDataJSON();commands.push(body);assert.ok(req.headers()['idempotency-key']);if(body.action==='bind_technician'){assert.equal(body.id,undefined);assert.deepEqual(body.payload,{expert_id:expertId,user_id:techId});linked=true;}if(body.action==='invite_technician')invited=true;if(body.action==='revoke_technician_invitation')invited=false;return route.fulfill({json:{data:{id,state:'review',replayed:false}},headers:{'X-Skycar-Account':'operator'}});}
  const data=url.searchParams.has('id')?{id,kind:'guest',state:'review',revision:1,request:{vehicle:'Toyota Corolla 2020',service:'repair',description:'Private bumper scratch',created_at:now},details:{name:'Private Owner',postcode:'5000'},quotes:[],selected_quote_id:null,appointment:null,events:[],photos:[],completion_photos:[],completion_review:{state:null},technician_invitations:invited?[{expert_id:expertId,active:true}]:[]}:{queue:[{id,kind:'guest',service:'repair',description:'Private bumper scratch',created_at:now,state:'review'}],experts:[{...expert,technician_account_linked:linked}],integrations:{assessment:'Manual',payments:'Unavailable',notifications:'In-app'}};
  return route.fulfill({json:{data},headers:{'X-Skycar-Account':'operator'}});
 });
 await tech.route(/\/api\/v1\/technician\/jobs(?:\/.*)?$/,async route=>{assert.equal(route.request().method(),'GET');const path=new URL(route.request().url()).pathname;
  if(denied||(!invited&&path!== '/api/v1/technician/jobs'))return route.fulfill({status:denied?403:404,json:{error:{message:'Technician access unavailable',retryable:false}}});
  if(path.includes('/photos/')){photos.push(path);return route.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),contentType:'image/png',headers:{'X-Skycar-Account':techId}});}
  return route.fulfill({json:{data:path.endsWith(id)?{profile,job:job(true)}:{profile,jobs:invited?[job(false)]:[],has_more:false}},headers:{'X-Skycar-Account':techId}});
 });
 await tech.goto(origin+'/technician/jobs');await tech.getByRole('heading',{name:'No jobs shared yet'}).waitFor();
 await ops.goto(origin+'/operations/care');await ops.getByText('Care command centre.').waitFor();await ops.getByText(/^Expert registry/).click();
 await ops.getByLabel('Expert to link').selectOption(expertId);await ops.getByLabel('Authorised technician account ID').fill(techId);await ops.getByLabel('I verified this account and its authority to represent the expert.').check();await ops.getByRole('button',{name:'Link technician account',exact:true}).click();await ops.getByText('The operations record was updated.').waitFor();
 await ops.locator('.operations-queue button').first().click();await ops.getByLabel('Technician to invite').selectOption(expertId);await ops.getByRole('button',{name:'Invite technician to review'}).click();await ops.getByRole('button',{name:'Revoke review access'}).waitFor();
 await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByRole('heading',{name:'Toyota Corolla 2020'}).waitFor();await tech.getByRole('link',{name:/REPAIR · INVITED TO REVIEW/}).click();await tech.getByRole('heading',{name:'Private request photos'}).waitFor({timeout:5000}).catch(async e=>{console.error(tech.url(),await tech.locator('body').innerText());throw e;});await tech.waitForFunction(()=>document.querySelector('.technician-photos img')?.naturalWidth>0);assert.equal(photos.length>0,true);assert.equal(await tech.getByText('Private Owner',{exact:true}).count(),0);assert.equal(await tech.locator('.app-dock').count(),0);
 for(const width of [320,390,1440]){await tech.setViewportSize({width,height:900});assert.equal(await tech.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 confirmed=true;await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByText('1 Synthetic Street',{exact:false}).waitFor();
 await mkdir('.garage-qa',{recursive:true});await tech.screenshot({path:'.garage-qa/technician-inbox.png',fullPage:true});
 confirmed=false;await ops.getByRole('button',{name:'Revoke review access'}).click();await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByRole('heading',{name:'Job unavailable'}).waitFor();assert.equal(await tech.getByText('Private bumper scratch',{exact:true}).count(),0);assert.equal(await tech.locator('.technician-photos img').count(),0);assert.equal(await tech.locator('address').count(),0);
 denied=true;await tech.goto(origin+'/technician/jobs');await tech.getByRole('heading',{name:'Technician access required'}).waitFor();assert.match(await tech.getByRole('link',{name:'Sign in as a technician'}).getAttribute('href'),/next=%2Ftechnician%2Fjobs/);assert.deepEqual(commands.map(c=>c.action),['bind_technician','invite_technician','revoke_technician_invitation']);assert.deepEqual(errors,[]);
 console.log('PASS: operations link/invite/revoke, isolated technician session, private photos/contact, denied access clearing, responsive inbox (mock API).');
}finally{await browser?.close();server.kill('SIGTERM');}
