// Mocked browser/API acceptance for the private operations workspace; not hosted authorization proof.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3195';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const expertId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const quoteId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3195'],{stdio:'ignore'});
let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'server started');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&message.text()!=='Failed to load resource: net::ERR_FAILED')errors.push(message.text());});
 let account='admin-a';let state='review';let completion=[];let quotePublished=false;let failConfirm=true;const commands=[];const uploads=[];
 const now=new Date().toISOString();const start=new Date(Date.now()+2*86400000).toISOString();const end=new Date(Date.now()+2*86400000+7200000).toISOString();
 const expert={id:expertId,business_name:'Adelaide Panel Care',description:'Verified mobile repair specialist.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2027-12-31',active:true};
 const queue=()=>[{id,kind:'guest',service:'repair',description:'Visible scratch on the left rear door',created_at:now,state}];
 const snapshot=()=>({id,kind:'guest',state,revision:1,request:{vehicle:'2020 Toyota Corolla',service:'repair',description:'Visible scratch on the left rear door',created_at:now},details:{name:'Synthetic Customer',phone:'0400000000',suburb:'Adelaide',postcode:'5000',...(state==='booking_requested'||!['review','quotes_ready'].includes(state)?{address:'1 Test Street'}:{})},quotes:quotePublished?[{id:quoteId,expert_name:expert.business_name,expert_description:expert.description,scope_summary:'Inspect and repair the left rear door scratch.',total_price_cents:49500,currency:'AUD',status:state==='review'?'issued':state==='quotes_ready'?'issued':'selected',expires_at:new Date(Date.now()+86400000).toISOString(),starts_at:start,ends_at:end}]:[],selected_quote_id:['booking_requested','scheduled','in_progress','completed'].includes(state)?quoteId:null,appointment:['booking_requested','scheduled','in_progress','completed'].includes(state)?{starts_at:start,ends_at:end}:null,events:[],photos:[1],completion_photos:completion});
 await page.route('**/api/v1/operations/care**',async route=>{
  const request=route.request();const url=new URL(request.url());
  if(request.method()==='GET')return route.fulfill({json:{data:url.searchParams.has('id')?snapshot():{queue:queue(),experts:[expert],integrations:{assessment:'Manual expert review — Ravin API not connected',payments:'Not connected — no customer payments taken',notifications:'In-app updates only'}}},headers:{'X-Skycar-Account':account}});
  const body=request.postDataJSON();commands.push({key:request.headers()['idempotency-key'],body});
  if(body.action==='publish_quote'){assert.equal(body.id,id);assert.equal(body.payload.expert_id,expertId);assert.equal(body.payload.total_price_cents,49500);quotePublished=true;state='quotes_ready';}
  if(body.action==='confirm'){assert.deepEqual(body.payload,{availability_confirmed:true});if(failConfirm){failConfirm=false;return route.abort('failed');}state='scheduled';}
  if(body.action==='complete')state='completed';
  return route.fulfill({json:{data:{id,state,replayed:false}},headers:{'X-Skycar-Account':account}});
 });
 const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await page.route(/\/api\/v1\/care\/journey\/[^/]+\/photos(?:\/\d+)?(?:\?.*)?$/,async route=>{
  if(route.request().method()==='GET')return route.fulfill({body:pixel,contentType:'image/png',headers:{'X-Skycar-Account':account}});
  uploads.push({key:route.request().headers()['idempotency-key'],body:await route.request().postDataBuffer()});completion=[1];return route.fulfill({status:201,json:{data:{stored:1}},headers:{'X-Skycar-Account':account}});
 });
 await page.goto(`${origin}/operations/care`);await page.getByRole('heading',{name:'Care command centre.'}).waitFor();
 assert.match(await page.getByLabel('Integration status').innerText(),/Ravin API not connected/);await page.getByRole('button',{name:/Repair · Your request is under review/}).click();await page.getByRole('paragraph').filter({hasText:'Visible scratch on the left rear door'}).waitFor();
 const future=value=>new Date(value).toISOString().slice(0,16);
 await page.getByLabel('Verified expert').selectOption(expertId);await page.getByLabel('Work and inspection scope').fill('Inspect and repair the left rear door scratch.');await page.getByLabel('Total price (AUD)').fill('495.00');await page.getByLabel('Quote expires').fill(future(Date.now()+86400000));await page.getByLabel('Proposed start').fill(future(Date.now()+2*86400000));await page.getByLabel('Proposed end').fill(future(Date.now()+2*86400000+7200000));await page.getByRole('button',{name:'Publish reviewed quote'}).click();await page.getByText('The operations record was updated.').waitFor();
 state='booking_requested';await page.getByRole('button',{name:/Repair · Review your quotes/}).click();await page.getByText('Requested — not yet confirmed',{exact:true}).waitFor();const confirm=page.getByRole('button',{name:'Confirm appointment'});assert.equal(await confirm.isDisabled(),true);await page.getByLabel(/I checked this expert/).check();await confirm.click();await page.getByRole('button',{name:'Retry same action'}).waitFor();await page.getByRole('button',{name:'Retry same action'}).click();await page.getByRole('heading',{name:'Confirmed appointment',exact:true}).waitFor();
 const confirms=commands.filter(command=>command.body.action==='confirm');assert.equal(confirms.length,2);assert.deepEqual(confirms[0],confirms[1],'ambiguous confirmation must retry the exact key and body');
 state='in_progress';await page.getByRole('button',{name:/Repair · Your appointment is confirmed/}).click();await page.getByRole('heading',{name:'Record the result'}).waitFor();
 const photo=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;canvas.getContext('2d').fillRect(0,0,64,64);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
 await page.getByLabel('Add damage photos').setInputFiles({name:'completion.png',mimeType:'image/png',buffer:photo});await page.getByRole('button',{name:'Remove photo 1'}).waitFor();account='admin-b';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'Select a request'}).waitFor();assert.equal(await page.getByRole('button',{name:'Remove photo 1'}).count(),0,'a different admin must not inherit a private draft');
 await page.getByRole('button',{name:/Repair · Your car is being cared for/}).click();await page.getByLabel('Add damage photos').setInputFiles({name:'completion.png',mimeType:'image/png',buffer:photo});await page.getByRole('button',{name:'Save completion evidence'}).click();await page.getByRole('button',{name:'Complete job with this evidence'}).waitFor();assert.equal(uploads.length,1);assert.ok(uploads[0].key);await page.getByRole('button',{name:'Complete job with this evidence'}).click();await page.getByRole('heading',{name:'Your service is complete'}).waitFor();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await mkdir('.garage-qa',{recursive:true});await page.screenshot({path:'.garage-qa/care-operations-390.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: private review, manual quote, explicit confirmation, exact retry, account-switch clearing, completion evidence, completion, responsive layout');
}finally{if(browser)await browser.close();server.kill('SIGTERM');}
