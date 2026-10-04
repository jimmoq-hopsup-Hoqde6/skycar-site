"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {DamagePhotos} from '../damage-photos';
import {PrivateJourneyPhoto} from './private-photo';
import {api,date,events,JourneyApiError,money,readJourney,states,type Journey} from './types';
import '../request-form.css';
import '../guest-request-form.css';
import './journey.css';

type QueueItem={id:string;kind:'guest'|'account';service:'repair'|'cleaning';description:string;created_at:string;state:string};
type Expert={id:string;business_name:string;description:string;services:string[];postcodes:string[];insurance_valid_until:string;active:boolean};
type Operations={queue:QueueItem[];experts:Expert[];integrations:{assessment:string;payments:string;notifications:string}};
type Attempt={key:string;account:string;url:string;body?:string;files?:File[]};

function readOperations(value:unknown):Operations{
 const d=value as Operations;
 if(!d||!Array.isArray(d.queue)||d.queue.some(item=>!item||typeof item.id!=='string'||!['guest','account'].includes(item.kind)||!['repair','cleaning'].includes(item.service)||typeof item.description!=='string'||!Object.hasOwn(states,item.state)||!Number.isFinite(Date.parse(item.created_at)))||!Array.isArray(d.experts)||d.experts.some(expert=>!expert||typeof expert.id!=='string'||typeof expert.business_name!=='string'||typeof expert.description!=='string'||!Array.isArray(expert.services)||expert.services.some(service=>!['repair','cleaning'].includes(service))||!Array.isArray(expert.postcodes)||expert.postcodes.some(postcode=>typeof postcode!=='string'||!/^\d{4}$/.test(postcode))||typeof expert.insurance_valid_until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(expert.insurance_valid_until)||typeof expert.active!=='boolean')||!d.integrations||Object.values(d.integrations).some(v=>typeof v!=='string'))throw new Error('The operations response could not be verified.');
 return d;
}
function localInstant(value:FormDataEntryValue|null){const parsed=new Date(String(value));if(!Number.isFinite(parsed.getTime()))throw new Error('Enter a valid date and time.');return parsed.toISOString();}
function priceCents(value:FormDataEntryValue|null){const text=String(value).trim();if(!/^\d{1,8}(\.\d{1,2})?$/.test(text))throw new Error('Enter a valid total price with no more than two decimal places.');const cents=Math.round(Number(text)*100);if(!Number.isSafeInteger(cents)||cents<1||cents>100_000_000)throw new Error('Enter a total price between $0.01 and $1,000,000.');return cents;}

export function CareOperations(){
 const[list,setList]=useState<Operations|null>(null);const[data,setData]=useState<Journey|null>(null);const[selected,setSelected]=useState('');const[account,setAccount]=useState('');
 const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[uncertain,setUncertain]=useState(false);
 const[files,setFiles]=useState<File[]>([]);const[preparing,setPreparing]=useState(false);const[availability,setAvailability]=useState(false);
 const epoch=useRef(0);const read=useRef<AbortController|null>(null);const attempt=useRef<Attempt|null>(null);const locked=useRef(false);const verifiedAccount=useRef('');
 const clearPrivate=useCallback(()=>{setData(null);setSelected('');setFiles([]);setAvailability(false);attempt.current=null;setUncertain(false);},[]);
 const clearAccess=useCallback(()=>{
  verifiedAccount.current='';setAccount('');setList(null);setNotice('');setPreparing(false);clearPrivate();
 },[clearPrivate]);
 const invalidate=useCallback(()=>{epoch.current++;read.current?.abort();},[]);
 const load=useCallback(async(id?:string)=>{
  read.current?.abort();const controller=new AbortController();read.current=controller;const version=++epoch.current;setLoading(true);setError('');
  try{
   const result=await api(`/api/v1/operations/care${id?`?id=${encodeURIComponent(id)}`:''}`,{signal:controller.signal});if(version!==epoch.current)return;
   if(!result.account)throw new Error('The signed-in operations account could not be verified.');
   if(verifiedAccount.current&&verifiedAccount.current!==result.account)clearPrivate();verifiedAccount.current=result.account;setAccount(result.account);
   if(id){setData(readJourney(result.data,id));setSelected(id);setFiles([]);setAvailability(false);}else setList(readOperations(result.data));
  }catch(caught){if(version!==epoch.current||controller.signal.aborted)return;const problem=caught instanceof Error?caught.message:'Unable to load operations.';setError(problem);if(caught instanceof JourneyApiError&&[401,403,404].includes(caught.status))clearAccess();}
  finally{if(version===epoch.current)setLoading(false);}
 },[clearPrivate,clearAccess]);
 useEffect(()=>{const refresh=()=>{void load();};const visible=()=>{if(document.visibilityState==='visible')refresh();};queueMicrotask(refresh);window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);return()=>{invalidate();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);};},[load,invalidate]);
 async function run(url:string,body?:unknown,uploadFiles?:File[]){
  if(locked.current||!account||preparing)return;
  if(!attempt.current)attempt.current={key:crypto.randomUUID(),account,url,...(uploadFiles?{files:[...uploadFiles]}:{body:JSON.stringify(body)})};
  const original=attempt.current;if(original.account!==account)return;locked.current=true;setBusy(true);setError('');setNotice('');const version=epoch.current;
  try{
   let requestBody:BodyInit=original.body||'';const headers:Record<string,string>={'Idempotency-Key':original.key};
   if(original.files){const form=new FormData();original.files.forEach(file=>form.append('photos',file));requestBody=form;}else headers['Content-Type']='application/json';
   const result=await api(original.url,{method:'POST',headers,body:requestBody});if(version!==epoch.current)return;if(result.account!==account)throw new JourneyApiError('Your operations account changed. Refresh before continuing.',403,false);
   attempt.current=null;setUncertain(false);setFiles([]);setAvailability(false);setNotice(original.files?'Completion evidence saved privately.':'The operations record was updated.');
   if(selected)await load(selected);await load();
  }catch(caught){
   if(version!==epoch.current)return;
   if(caught instanceof JourneyApiError&&[401,403,404].includes(caught.status))clearAccess();
   else{const retry=caught instanceof JourneyApiError?caught.retryable:true;if(!retry)attempt.current=null;setUncertain(retry);}
   setError(caught instanceof Error?caught.message:'The action could not be confirmed.');
  }
  finally{locked.current=false;setBusy(false);if(attempt.current)setUncertain(true);}
 }
 const command=(action:string,payload:unknown,id=selected)=>run('/api/v1/operations/care',{action,...(action==='create_expert'?{}:{id}),payload});
 const state=data?states[data.state]:null;const selectedQuote=data?.quotes.find(q=>q.id===data.selected_quote_id);
 return <main className="journey-shell">
  <nav className="journey-nav"><Link className="care-entry-wordmark" href="/">skycar<span>●</span></Link><Link href="/garage/jobs">Customer view ↗</Link></nav>
  <header className="journey-header"><p className="eyebrow">PRIVATE OPERATIONS</p><h1>Care command centre.</h1><p>Review requests, issue human-reviewed quotes and record confirmed service work.</p></header>
  {error&&<div className="care-entry-warning" role="alert"><p>{error}</p>{!account&&<Link href="/auth/sign-in?next=%2Foperations%2Fcare">Sign in with an authorised operations account</Link>}</div>}
  {notice&&<div className="operations-success" role="status">{notice}</div>}
  {uncertain&&<div className="care-entry-warning" role="status"><p>The result is not confirmed. The exact original request is held for a safe retry.</p><button type="button" disabled={busy} onClick={()=>void run('')}>Retry same action</button></div>}
  {!list&&!loading&&account&&<button className="journey-text-button" onClick={()=>void load()}>Reload operations</button>}
  {list&&<>
   <section className="operations-integrations" aria-label="Integration status"><strong>Current test-version boundaries</strong><span>{list.integrations.assessment}</span><span>{list.integrations.payments}</span><span>{list.integrations.notifications}</span></section>
   <details className="journey-panel operations-registry"><summary>Expert registry ({list.experts.length})</summary><div className="operations-experts">{list.experts.map(expert=><div key={expert.id}><strong>{expert.business_name}</strong><span>{expert.services.join(' + ')} · {expert.postcodes.join(', ')} · insurance to {expert.insurance_valid_until}{expert.active?'':' · inactive'}</span><p>{expert.description}</p></div>)}</div>
    <form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const services=form.getAll('services');if(!services.length){setError('Choose at least one service for this expert.');return;}void command('create_expert',{business_name:form.get('business_name'),description:form.get('description'),services,postcodes:String(form.get('postcodes')).split(',').map(v=>v.trim()).filter(Boolean),insurance_valid_until:form.get('insurance_valid_until')},'');}}><h3>Add verified expert</h3><div className="operations-form-grid"><label className="care-field">Business name<input name="business_name" minLength={2} maxLength={120} required disabled={busy||uncertain}/></label><label className="care-field">Insurance valid until<input name="insurance_valid_until" type="date" required disabled={busy||uncertain}/></label></div><label className="care-field">Description<textarea name="description" minLength={10} maxLength={1000} required disabled={busy||uncertain}/></label><fieldset className="operations-checks" disabled={busy||uncertain}><legend>Services</legend><label><input name="services" type="checkbox" value="repair"/> Repair</label><label><input name="services" type="checkbox" value="cleaning"/> Cleaning</label></fieldset><label className="care-field">Service postcodes<input name="postcodes" required placeholder="5000, 5001" disabled={busy||uncertain}/></label><button className="care-entry-button" type="submit" disabled={busy||uncertain}>Add expert</button></form>
   </details>
   <div className="operations-layout"><aside className="journey-panel"><p className="eyebrow">REQUEST QUEUE</p><h2>{list.queue.length} requests</h2><div className="operations-queue">{list.queue.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id} disabled={busy} onClick={()=>void load(item.id)}><strong>{item.service==='repair'?'Repair':'Cleaning'} · {states[item.state].title}</strong><span>{item.kind==='guest'?'Guest':'Garage'} · {date(item.created_at)}</span><span>{item.description}</span></button>)}</div></aside>
   <section>{loading&&selected&&<p>Checking the latest private record…</p>}{!selected&&!loading&&<div className="operations-access"><h2>Select a request</h2><p>Open a request to review its private photos, details and complete recorded history.</p></div>}
   {data&&state&&<><section className="journey-status"><p className="eyebrow">{data.kind==='guest'?'GUEST':'GARAGE'} · {data.request.service.toUpperCase()}</p><h2>{state.title}</h2><p>{data.request.vehicle} · {data.details.suburb} {data.details.postcode}</p>{data.appointment&&<div className="journey-appointment"><strong>{date(data.appointment.starts_at)}</strong><span>Until {date(data.appointment.ends_at)} · Adelaide time</span><span className={data.state==='booking_requested'?'operations-requested':'operations-confirmed'}>{data.state==='booking_requested'?'Requested — not yet confirmed':'Confirmed appointment'}</span></div>}</section>
    <div className="journey-columns"><section className="journey-panel"><p className="eyebrow">PRIVATE REQUEST EVIDENCE</p><h2>{data.request.vehicle}</h2><p className="journey-description">{data.request.description}</p><div className="journey-private-photos">{data.photos.map(slot=><PrivateJourneyPhoto key={`${account}:${data.id}:${slot}`} id={data.id} slot={slot} account={account}/>)}</div>{!data.photos.length&&<p>No damage photos were supplied.</p>}</section><section className="journey-panel"><p className="eyebrow">CUSTOMER DETAILS</p><h2>{data.details.name||'Details required'}</h2><p>{data.details.phone}<br/>{data.details.address&&<>{data.details.address}<br/></>}{data.details.suburb} {data.details.postcode}</p><p className="care-help">Request reference {data.id}</p></section></div>
    {['review','quotes_ready'].includes(data.state)&&<form className="journey-panel" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{void command('publish_quote',{expert_id:form.get('expert_id'),scope_summary:form.get('scope_summary'),total_price_cents:priceCents(form.get('total_price')),expires_at:localInstant(form.get('expires_at')),starts_at:localInstant(form.get('starts_at')),ends_at:localInstant(form.get('ends_at'))});}catch(caught){setError(caught instanceof Error?caught.message:'Check the quote details.');}}}><p className="eyebrow">HUMAN-REVIEWED QUOTE</p><h2>Publish a quote</h2><p>Review the request and evidence yourself. This test version does not generate an AI damage assessment or repair price.</p><label className="care-field">Verified expert<select name="expert_id" required disabled={busy||uncertain}><option value="">Choose expert</option>{list.experts.filter(expert=>expert.active).map(expert=><option key={expert.id} value={expert.id}>{expert.business_name}</option>)}</select></label><label className="care-field">Work and inspection scope<textarea name="scope_summary" minLength={10} maxLength={2000} required disabled={busy||uncertain}/></label><div className="operations-form-grid"><label className="care-field">Total price (AUD)<input name="total_price" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="495.00" required disabled={busy||uncertain}/></label><label className="care-field">Quote expires<input name="expires_at" type="datetime-local" required disabled={busy||uncertain}/></label><label className="care-field">Proposed start<input name="starts_at" type="datetime-local" required disabled={busy||uncertain}/></label><label className="care-field">Proposed end<input name="ends_at" type="datetime-local" required disabled={busy||uncertain}/></label></div><p className="care-help">Times use this device’s timezone and are saved as an exact instant. Publishing is not an appointment confirmation.</p><button className="care-entry-button" type="submit" disabled={busy||uncertain||!list.experts.some(expert=>expert.active)}>Publish reviewed quote</button></form>}
    {selectedQuote&&<section className="journey-panel"><p className="eyebrow">SELECTED QUOTE</p><h2>{selectedQuote.expert_name} · {money(selectedQuote.total_price_cents)}</h2><p>{selectedQuote.scope_summary}</p></section>}
    {data.state==='booking_requested'&&<section className="journey-panel operations-confirm"><p className="eyebrow">CAPACITY CHECK REQUIRED</p><h2>Requested, not confirmed</h2><p>Contact or check the expert’s real availability outside this test version. The database will also reject overlapping confirmed work.</p><label><input type="checkbox" checked={availability} onChange={event=>setAvailability(event.target.checked)} disabled={busy||uncertain}/> I checked this expert and window, and availability is confirmed.</label><button className="care-entry-button" type="button" disabled={!availability||busy||uncertain} onClick={()=>void command('confirm',{availability_confirmed:true})}>Confirm appointment</button></section>}
    {data.state==='scheduled'&&<section className="journey-panel"><h2>Confirmed appointment</h2><p>Only record work as started when the vehicle is with the expert and the appointment time has begun.</p><button className="care-entry-button" type="button" disabled={busy||uncertain} onClick={()=>void command('start',{})}>Record work started</button></section>}
    {data.state==='in_progress'&&<section className="journey-panel"><p className="eyebrow">COMPLETION EVIDENCE</p><h2>Record the result</h2>{data.completion_photos.length?<><div className="journey-private-photos">{data.completion_photos.map(slot=><PrivateJourneyPhoto key={`${account}:${data.id}:complete:${slot}`} id={data.id} slot={slot} account={account} completion/>)}</div><button className="care-entry-button" type="button" disabled={busy||uncertain} onClick={()=>void command('complete',{})}>Complete job with this evidence</button></>:<><DamagePhotos files={files} disabled={busy||uncertain} onChange={setFiles} onProcessing={setPreparing}/><button className="care-entry-button" type="button" disabled={!files.length||preparing||busy||uncertain} onClick={()=>void run(`/api/v1/care/journey/${data.id}/photos?kind=completion`,undefined,files)}>Save completion evidence</button></>}</section>}
    {!['completed','cancelled','in_progress'].includes(data.state)&&<div className="operations-actions"><button className="journey-text-button" type="button" disabled={busy||uncertain} onClick={()=>void command('cancel',{})}>Cancel request or booking</button></div>}
    <section className="journey-panel"><h2>Recorded updates</h2><ol className="journey-events"><li><span>Request received</span><time>{date(data.request.created_at)}</time></li>{data.events.map(event=><li key={event.id}><span>{events[event.type]}</span><time>{date(event.occurred_at)}</time></li>)}</ol></section>
   </>}</section></div>
  </>}
 </main>;
}
