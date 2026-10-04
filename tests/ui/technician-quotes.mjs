// Two isolated sessions with mocked transport; actual permission/state tests are SQL.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3201',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',accountA='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',accountB='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3201'],{stdio:'ignore'});let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const tech=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Australia/Adelaide'}),customer=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Australia/Adelaide'});
 const errors=[];for(const page of [tech,customer]){page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));}
 let account=accountA,state='review',invited=true,quotes=[],failAfterSave=false,denial=0,changedWrite=false,sequence=0;const commands=[],stored=new Map();
 const profile=()=>({expert_id:account,business_name:account===accountA?'Synthetic Quote Expert':'Other Scoped Expert',description:'Synthetic mobile repair specialist.',services:['repair'],postcodes:['5000'],insurance_valid_until:'2030-12-31'});
 const now=new Date().toISOString(),start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString(),expiry=new Date(Date.now()+3600000).toISOString();
 const job=()=>({id,kind:'guest',vehicle:'Toyota Corolla 2020',service:'repair',description:'Private bumper scratch',postcode:'5000',state,access:['review','quotes_ready'].includes(state)?'invited':'selected',created_at:now,appointment:['review','quotes_ready'].includes(state)?null:{starts_at:start,ends_at:end},contact:state==='scheduled'?{name:'Private Owner',phone:'0400000000',address:'1 Test Street'}:null,photos:[]});
 await tech.route(/\/api\/v1\/technician\/jobs(?:\/.*)?$/,async route=>{
  const req=route.request();if(req.method()==='GET'){
   if(!invited)return route.fulfill({status:404,json:{error:{message:'Job unavailable',retryable:false}}});
   return route.fulfill({json:{data:{profile:profile(),job:job(),own_quotes:account===accountA?quotes.map(({expert_name,expert_description,...q})=>{void expert_name;void expert_description;return q;}):[]}},headers:{'X-Skycar-Account':account}});
  }
  const body=req.postDataJSON(),key=req.headers()['idempotency-key'];assert.equal(req.headers()['x-skycar-account'],accountA);commands.push({key,body});assert.ok(key);
  if(denial)return route.fulfill({status:denial,json:{error:{message:'Technician access denied',retryable:false}}});
  if(changedWrite)return route.fulfill({json:{data:{id,action:body.action,state:'quotes_ready',quote_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',replayed:false}},headers:{'X-Skycar-Account':accountB}});
  let result=stored.get(key);
  if(result){assert.deepEqual(result.body,body);return route.fulfill({json:{data:{...result.data,replayed:true}},headers:{'X-Skycar-Account':account}});}
  if(body.action==='quote'){
   assert.deepEqual(Object.keys(body).sort(),['action','payload']);assert.equal(body.payload.total_price_cents,49500);assert.equal(body.payload.expert_id,undefined);
   quotes=quotes.map(q=>q.status==='issued'?{...q,status:'superseded'}:q);const quoteId=`dddddddd-dddd-4ddd-8ddd-${String(++sequence).padStart(12,'0')}`;
   quotes.unshift({id:quoteId,...body.payload,currency:'AUD',status:'issued',expert_name:'Synthetic Quote Expert',expert_description:'Synthetic mobile repair specialist.'});state='quotes_ready';result={body,data:{id,action:'quote',state,quote_id:quoteId,replayed:false}};
  }else{assert.equal(body.action,'decline');assert.deepEqual(body.payload,{});quotes=quotes.map(q=>q.status==='issued'?{...q,status:'withdrawn'}:q);state='review';invited=false;result={body,data:{id,action:'decline',state,quote_id:null,replayed:false}};}
  stored.set(key,result);if(failAfterSave){failAfterSave=false;return route.abort('failed');}
  return route.fulfill({json:{data:result.data},headers:{'X-Skycar-Account':account}});
 });
 await customer.route(/\/api\/v1\/care\/journey\/[^/]+$/,async route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();assert.equal(body.action,'select_quote');assert.equal(body.payload.quote_id,quotes.find(q=>q.status==='issued').id);state='booking_requested';quotes=quotes.map(q=>({...q,status:q.id===body.payload.quote_id?'selected':q.status==='issued'?'withdrawn':q.status}));return route.fulfill({json:{data:{id,state,replayed:false}},headers:{'X-Skycar-Account':'guest:'+id}});}
  return route.fulfill({json:{data:{id,kind:'guest',state,revision:1,request:{vehicle:'Toyota Corolla 2020',service:'repair',description:'Private bumper scratch',created_at:now},details:{name:'Private Owner',phone:'0400000000',suburb:'Adelaide',postcode:'5000',...(!['review','quotes_ready'].includes(state)?{address:'1 Test Street'}:{})},quotes,selected_quote_id:quotes.find(q=>q.status==='selected')?.id||null,appointment:['review','quotes_ready'].includes(state)?null:{starts_at:start,ends_at:end},events:!invited?[{id:1,type:'quote_withdrawn',occurred_at:now}]:[],photos:[],completion_photos:[]}},headers:{'X-Skycar-Account':'guest:'+id}});
 });
 const local=value=>new Date(new Date(value).getTime()+630*60000).toISOString().slice(0,16);
 async function fill(){await tech.getByLabel('Work and inspection scope').fill('Inspect and repair the visible bumper scratch.');await tech.getByLabel('Total quote price (AUD)').fill('495.00');await tech.getByLabel('Quote valid until').fill(local(expiry));await tech.getByLabel('Proposed appointment start').fill(local(start));await tech.getByLabel('Proposed appointment end').fill(local(end));}
 await tech.goto(`${origin}/technician/jobs/${id}`);await tech.getByRole('heading',{name:'Propose your work and appointment'}).waitFor();await fill();failAfterSave=true;await tech.getByRole('button',{name:'Send proposal to customer'}).click();await tech.getByRole('button',{name:'Retry same action'}).waitFor();
 assert.equal(await tech.getByRole('button',{name:'Send proposal to customer'}).isDisabled(),true);await tech.evaluate(()=>window.dispatchEvent(new Event('focus')));await tech.getByRole('button',{name:'Retry same action'}).waitFor();await tech.getByRole('button',{name:'Retry same action'}).click();await tech.getByRole('heading',{name:'Your saved proposals'}).waitFor();assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);assert.equal(quotes.length,1);
 await customer.goto(`${origin}/care/journey/${id}`);await customer.getByRole('heading',{name:'Choose the care that suits you.'}).waitFor();assert.equal(await customer.getByText('$495.00',{exact:true}).count(),1);await customer.getByRole('button',{name:'Review this quote ↗'}).click();await customer.getByLabel('Service street address').fill('1 Test Street');await customer.getByRole('button',{name:'Request this appointment'}).click();await customer.getByRole('heading',{name:'Your appointment is requested'}).waitFor();
 await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByRole('heading',{name:'Your appointment is requested'}).waitFor();assert.equal(await tech.getByRole('button',{name:'Send proposal to customer'}).count(),0);assert.equal(await tech.locator('address').count(),0);
 state='scheduled';await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByText('1 Test Street',{exact:false}).waitFor();
 state='quotes_ready';quotes=quotes.map(q=>({...q,status:'issued'}));await tech.getByRole('button',{name:'Refresh jobs'}).click();await tech.getByLabel('I cannot take this request and want to withdraw my current proposal.').check();await tech.getByRole('button',{name:'Decline request'}).click();await tech.getByText('You declined this request. It has been removed from your review inbox.').waitFor();assert.equal(await tech.getByLabel('Work and inspection scope').count(),0);
 await customer.getByRole('button',{name:'Refresh',exact:true}).click();await customer.getByRole('heading',{name:'Your request is under review'}).waitFor();await customer.getByText('Expert proposal withdrawn',{exact:true}).waitFor();assert.equal(await customer.getByRole('button',{name:'Review this quote ↗'}).count(),0);
 for(const width of [320,390,1440]){await customer.setViewportSize({width,height:900});assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 // Denied or changed-account POST clears all private details, drafts and pending actions.
 for(const problem of [401,403,404,'changed']){
  invited=true;state='review';quotes=[];account=accountA;denial=0;changedWrite=false;await tech.reload();await fill();if(problem==='changed')changedWrite=true;else denial=problem;
  const before=commands.length;await tech.getByRole('button',{name:'Send proposal to customer'}).click();await tech.getByRole('alert').filter({hasText:/Technician access denied|Your technician account changed/}).waitFor();assert.equal(await tech.getByText('Private bumper scratch',{exact:true}).count(),0);assert.equal(await tech.getByLabel('Work and inspection scope').count(),0);assert.equal(await tech.getByRole('button',{name:'Retry same action'}).count(),0);assert.equal(commands.length,before+1);
 }
 denial=0;changedWrite=false;account=accountA;await tech.reload();await fill();account=accountB;await tech.evaluate(()=>window.dispatchEvent(new Event('focus')));await tech.getByRole('heading',{name:'Other Scoped Expert'}).waitFor();assert.equal(await tech.getByLabel('Work and inspection scope').inputValue(),'','account switch drops private draft');
 for(const width of [320,390,1440]){await tech.setViewportSize({width,height:900});assert.equal(await tech.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await tech.setViewportSize({width:390,height:844});await mkdir('.garage-qa',{recursive:true});await tech.screenshot({path:'.garage-qa/technician-quote-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: technician quote/exact retry → same customer proposal/selection → shared requested/confirmed state, decline withdrawal, denied writes/account-switch clearing, responsive forms (mock API).');
}finally{await browser?.close();server.kill('SIGTERM');}
