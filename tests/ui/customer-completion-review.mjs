// Mocked browser/API acceptance. PostgreSQL acceptance separately proves authority and concurrency.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3203',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3203'],{stdio:'ignore'});let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'server started');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);const errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/^Failed to load resource: (net::ERR_FAILED|the server responded with a status of (403|404))/.test(message.text()))errors.push(message.text());});
 const now=new Date().toISOString(),accountA=`guest:${id}`,accountB='guest:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 let reviewState='awaiting_review',issueDetails,activeAccount=accountA,failConfirm=true,postDenial=0;const commands=[],stored=new Map();
 const snapshot=()=>({id,kind:'guest',state:'completed',revision:reviewState==='awaiting_review'?3:4,request:{vehicle:'Toyota Corolla 2020',service:'repair',description:'Private repair work',created_at:now},details:{name:'Private Owner',phone:'0400000000',suburb:'Adelaide',postcode:'5000',address:'1 Test Street'},quotes:[],selected_quote_id:null,appointment:null,events:[{id:1,type:'work_completed',occurred_at:now},...(reviewState==='confirmed'?[{id:2,type:'completion_confirmed',occurred_at:now}]:reviewState==='issue_reported'?[{id:2,type:'completion_issue_reported',occurred_at:now}]:[])],photos:[],completion_photos:[1],completion_review:{state:reviewState,...(reviewState==='issue_reported'?{issue_details:issueDetails}:{})}});
 const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await page.route(/\/api\/v1\/care\/journey\/[^/]+(?:\/photos\/1\?kind=completion)?$/,async route=>{
  const request=route.request();if(/photos\/1\?kind=completion$/.test(request.url()))return route.fulfill({body:pixel,contentType:'image/png',headers:{'X-Skycar-Account':activeAccount}});
  if(request.method()==='GET')return route.fulfill({json:{data:snapshot()},headers:{'X-Skycar-Account':activeAccount}});
  const body=request.postDataJSON(),key=request.headers()['idempotency-key'];commands.push({key,body});assert.ok(key);
  if(postDenial)return route.fulfill({status:postDenial,json:{error:{message:'Customer access denied',retryable:false}}});
  const prior=stored.get(key);if(prior)return route.fulfill({json:{data:{...prior,replayed:true}},headers:{'X-Skycar-Account':activeAccount}});
  if(body.action==='confirm_completion'){assert.deepEqual(body.payload,{});reviewState='confirmed';}
  else{assert.equal(body.action,'report_completion_issue');assert.deepEqual(Object.keys(body.payload),['details']);issueDetails=body.payload.details.trim();assert.ok(issueDetails.length>=10);reviewState='issue_reported';}
  const result={id,state:'completed',revision:4,review_state:reviewState,replayed:false};stored.set(key,result);
  if(body.action==='confirm_completion'&&failConfirm){failConfirm=false;return route.abort('failed');}
  return route.fulfill({json:{data:result},headers:{'X-Skycar-Account':activeAccount}});
 });
 await page.goto(`${origin}/care/journey/${id}`);await page.getByRole('heading',{name:'How does the completed work look?'}).waitFor();
 await page.getByLabel(/completed work looks good/).check();await page.getByRole('button',{name:'Confirm completed work'}).click();await page.getByRole('button',{name:'Check same action'}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Check same action'}).waitFor();await page.getByRole('button',{name:'Check same action'}).click();await page.getByRole('heading',{name:'Completed work confirmed'}).waitFor();
 assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1],'ambiguous confirmation retries the exact key and body');assert.match(await page.locator('main').innerText(),/No payment action was taken/);
 reviewState='awaiting_review';issueDetails=undefined;stored.clear();await page.reload();const issue=page.getByLabel('Report an issue privately');await issue.fill('Private paint finish concern that needs review');
 activeAccount=accountB;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'How does the completed work look?'}).waitFor();assert.equal(await issue.inputValue(),'','a replacement account cannot inherit a private issue draft');
 activeAccount=accountA;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await issue.fill('Private concern removed after denied write');postDenial=403;await page.getByRole('button',{name:'Report completion issue'}).click();await page.getByRole('alert').filter({hasText:'Customer access denied'}).waitFor();assert.equal(await page.getByText('Private concern removed after denied write',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Check same action'}).count(),0);
 postDenial=0;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('heading',{name:'How does the completed work look?'}).waitFor();await issue.fill('  Paint edge needs a closer manual inspection.  ');await page.getByRole('button',{name:'Report completion issue'}).click();await page.getByRole('heading',{name:'Skycar operations review requested'}).waitFor();await page.getByText('Paint edge needs a closer manual inspection.',{exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/No refund or payment change was made automatically/);
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);console.log('PASS: customer confirms completed evidence with exact retry, or reports a private issue; account changes and denied writes clear private drafts; no payment implication; responsive UI.');
}finally{await browser?.close();server.kill('SIGTERM');}
