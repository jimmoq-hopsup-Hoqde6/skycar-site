// Mocked API/browser regressions. These do not prove hosted authorization or saves.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin='http://127.0.0.1:3194';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3194'],{stdio:'ignore'});
let browser;
try {
 let ready=false;
 for(let i=0;i<150;i++){try{if((await fetch(origin)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'server started');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let account='account-a',deny=false,postFails=false;
 const posts=[];
 const snapshot=()=>({id,kind:'account',state:'review',revision:0,request:{vehicle:`Synthetic vehicle ${account}`,service:'repair',description:'Synthetic visible scratch',created_at:'2026-10-01T00:00:00Z'},details:{name:account,phone:'0400000000',suburb:'Adelaide',postcode:'5000'},quotes:[],selected_quote_id:null,appointment:null,events:[],photos:[],completion_photos:[]});
 await page.route('**/api/v1/care/journey/**',async route=>{
  if(route.request().method()==='POST'){
   posts.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
   if(postFails)return route.abort('failed');
   return route.fulfill({json:{data:{ok:true}},headers:{'X-Skycar-Account':account}});
  }
  return route.fulfill({status:deny?403:200,json:deny?{error:{message:'Access denied',retryable:false}}:{data:snapshot()},headers:{'X-Skycar-Account':account}});
 });
 await page.goto(`${origin}/care/journey/${id}`);
 await page.getByRole('heading',{name:'Synthetic vehicle account-a'}).waitFor();
 const photo=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;c.getContext('2d').fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1];}),'base64');
 const choose=()=>page.getByLabel('Add damage photos').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:photo});
 const hasPhoto=()=>page.getByRole('button',{name:'Remove photo 1'});
 const refresh=async(name)=>{await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:`Synthetic vehicle ${name}`}).waitFor();};
 await choose();await hasPhoto().waitFor();
 await refresh(account);assert.equal(await hasPhoto().count(),1,'same verified account keeps selected photo');
 account='account-b';await refresh(account);
 assert.equal(await hasPhoto().count(),0,'different account must not inherit selected photos');
 assert.equal(await page.getByRole('button',{name:'Save photos with request'}).isDisabled(),true);
 // A late decoder from an unmounted picker must not repopulate the next account.
 await page.evaluate(()=>{const original=window.createImageBitmap.bind(window);window.createImageBitmap=(...args)=>new Promise((resolve,reject)=>{window.releasePhoto=()=>original(...args).then(resolve,reject);});});
 await choose();await page.getByText('Preparing photos…',{exact:true}).waitFor();
 account='account-c';await refresh(account);await page.evaluate(()=>window.releasePhoto());
 await page.waitForTimeout(150);
 assert.equal(await hasPhoto().count(),0,'late image decoder must not cross account boundary');
 // Denial clears the draft even when the same account signs in again.
 await page.reload();await page.getByRole('heading',{name:'Synthetic vehicle account-c'}).waitFor();
 await choose();await hasPhoto().waitFor();deny=true;
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Access denied',{exact:true}).waitFor();
 assert.equal(await hasPhoto().count(),0);deny=false;await refresh(account);assert.equal(await hasPhoto().count(),0);
 // Ambiguous commands retain exactly one payload/key for retries, then disappear on account change.
 postFails=true;await page.getByRole('button',{name:'Save service details',exact:true}).click();
 await page.getByRole('button',{name:'Check same action'}).click();
 await page.waitForFunction(()=>document.querySelector('[role="status"] button')?.disabled===false);
 assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
 account='account-d';await refresh(account);assert.equal(await page.getByRole('button',{name:'Check same action'}).count(),0);
 assert.equal(await page.getByLabel('Contact name').inputValue(),'account-d');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);
 console.log('PASS: same-account preservation, account-switch clearing, late photo decoding, denied access, exact command retry, three viewport widths, no browser errors');
} finally {if(browser)await browser.close();server.kill('SIGTERM');}
