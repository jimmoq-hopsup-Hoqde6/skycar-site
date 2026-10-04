"use client";
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {DamagePhotos} from '../damage-photos';
import {PrivateJourneyPhoto} from './private-photo';
import {api,readJourney,states,events,money,date,JourneyApiError,type Journey,type Quote} from './types';
import {readCustomerCompletionReviewResult} from '@/domain/care/completion-review.mjs';
import '../request-form.css';
import '../guest-request-form.css';
import './journey.css';
type Attempt={key:string;account:string;action?:string;body?:string;photos?:File[]};
export function CustomerJourney({id}:{id:string}){
 const[data,setData]=useState<Journey|null>(null);const[account,setAccount]=useState('');const[loading,setLoading]=useState(true);
 const[error,setError]=useState('');const[busy,setBusy]=useState(false);const[uncertain,setUncertain]=useState(false);
 const[files,setFiles]=useState<File[]>([]);const[preparing,setPreparing]=useState(false);const[chosen,setChosen]=useState<Quote|null>(null);
 const[issueDetails,setIssueDetails]=useState('');
 const verifiedScope=useRef('');const attempt=useRef<Attempt|null>(null);const epoch=useRef(0);const locked=useRef(false);const read=useRef<AbortController|null>(null);
 const clearPrivate=useCallback(()=>{
  verifiedScope.current='';attempt.current=null;
  setData(null);setAccount('');setChosen(null);setFiles([]);setIssueDetails('');setPreparing(false);setUncertain(false);
 },[]);
 const load=useCallback(async()=>{
  read.current?.abort();const controller=new AbortController();read.current=controller;const version=++epoch.current;
  setData(null);setAccount('');setLoading(true);setError('');setChosen(null);
  try{const result=await api(`/api/v1/care/journey/${id}`,{signal:controller.signal});if(version!==epoch.current)return;if(!result.account)throw new Error('We could not verify access to this request.');
   const scope=`${id}:${result.account}`;
   if(verifiedScope.current!==scope){attempt.current=null;setUncertain(false);setFiles([]);setIssueDetails('');}
   verifiedScope.current=scope;
   setData(readJourney(result.data,id));setAccount(result.account);
  }catch(e){if(version!==epoch.current||controller.signal.aborted)return;setError(e instanceof Error?e.message:'Unable to load request.');if(e instanceof JourneyApiError&&[401,403,404].includes(e.status))clearPrivate();}
  finally{if(version===epoch.current){setLoading(false);setPreparing(false);}}
 },[id,clearPrivate]);
 const invalidate=useCallback(()=>{epoch.current++;read.current?.abort();},[]);
 useEffect(()=>{const refresh=()=>{void load();};const visible=()=>{if(document.visibilityState==='visible')refresh();};queueMicrotask(refresh);window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);return()=>{invalidate();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);};},[load,invalidate]);
 async function send(action?:string,payload?:unknown,upload=false){
  if(locked.current||!account||preparing)return;
  if(!attempt.current)attempt.current={key:crypto.randomUUID(),account,action,...(upload?{photos:[...files]}:{body:JSON.stringify({action,payload})})};
  const original=attempt.current;if(original.account!==account)return;
  locked.current=true;setBusy(true);setError('');const version=epoch.current;
  try{
   let body:BodyInit=original.body||'';const headers:Record<string,string>={'Idempotency-Key':original.key};
   if(original.photos){const form=new FormData();original.photos.forEach(file=>form.append('photos',file));body=form;}else headers['Content-Type']='application/json';
   const result=await api(`/api/v1/care/journey/${id}${original.photos?'/photos':''}`,{method:'POST',headers,body});
   if(version!==epoch.current)return;if(result.account!==account)throw new JourneyApiError('Your account changed. Refresh before continuing.',403,false);
   if(original.action==='confirm_completion'||original.action==='report_completion_issue')readCustomerCompletionReviewResult(result.data,id,original.action);
   attempt.current=null;setUncertain(false);setFiles([]);setIssueDetails('');await load();
  }catch(e){
   if(version!==epoch.current)return;
   if(e instanceof JourneyApiError&&[401,403,404].includes(e.status))clearPrivate();
   else{const retry=e instanceof JourneyApiError?e.retryable:true;setUncertain(retry);if(!retry)attempt.current=null;}
   setError(e instanceof Error?e.message:'Could not confirm this action.');
  }
  finally{locked.current=false;setBusy(false);if(attempt.current)setUncertain(true);}
 }
 const state=data?states[data.state]:null;const selected=data?.quotes.find(q=>q.id===data.selected_quote_id);
 return <main className="journey-shell">
  <nav className="journey-nav"><Link className="care-entry-wordmark" href="/">skycar<span>●</span></Link><Link href="/garage/jobs">My Jobs ↗</Link></nav>
  <header className="journey-header"><p className="eyebrow">YOUR CAR CARE, CONNECTED</p><h1>{data?.request.vehicle||'Your service journey'}</h1><p>Photos, expert quotes and every confirmed update. Together.</p></header>
  <div className="journey-toolbar"><span>{loading?'Checking your request…':data?'Latest recorded status':'Request unavailable'}</span><button type="button" disabled={loading||busy} onClick={()=>void load()}>Refresh</button></div>
  {error&&<div className="care-entry-warning" role="alert"><p>{error}</p>{!data&&<Link href={`/auth/sign-in?next=${encodeURIComponent(`/care/journey/${id}`)}`}>Sign in for a Garage request</Link>}</div>}
  {uncertain&&<div className="care-entry-warning" role="status"><p>The previous action has not been confirmed. Its original details are kept for a safe retry.</p><button disabled={busy||!account} onClick={()=>void send()}>Check same action</button></div>}
  {data&&state&&<>
   <ol className="journey-progress" aria-label="Service progress">{['Review','Quote','Appointment','Service','Complete'].map((label,index)=><li key={label} aria-current={index===state.step?'step':undefined} data-done={index<state.step}><span>{index<state.step?'✓':index+1}</span>{label}</li>)}</ol>
   <section className="journey-status"><p className="eyebrow">{data.request.service==='repair'?'REPAIR':'CLEANING'} · {data.kind==='guest'?'GUEST REQUEST':'GARAGE REQUEST'}</p><h2>{state.title}</h2><p>{state.detail}</p>{data.appointment&&<div className="journey-appointment"><strong>{date(data.appointment.starts_at)}</strong><span>Until {date(data.appointment.ends_at)} · Adelaide time</span><span>{['scheduled','in_progress','completed'].includes(data.state)?'Confirmed appointment':'Proposed appointment — confirmation required'}</span></div>}</section>
   {data.state==='quotes_ready'&&<section className="journey-section"><div className="journey-section-title"><div><p className="eyebrow">YOUR OPTIONS</p><h2>Choose the care that suits you.</h2></div></div>{!data.quotes.length?<p>There are no current quotes to select. An updated quote is needed before you can request an appointment.</p>:<div className="journey-quote-grid">{data.quotes.filter(q=>q.status==='issued').map(q=><article className="journey-quote" key={q.id}><p className="eyebrow">EXPERT-REVIEWED QUOTE</p><h3>{q.expert_name}</h3><p>{q.expert_description}</p><strong className="journey-price">{money(q.total_price_cents)}</strong><span>Total quoted price</span><p className="journey-scope">{q.scope_summary}</p><dl><dt>Proposed appointment</dt><dd>{date(q.starts_at)}<br/>to {date(q.ends_at)}</dd><dt>Quote valid until</dt><dd>{date(q.expires_at)}</dd></dl><button className="care-entry-button" disabled={busy||uncertain} onClick={()=>setChosen(q)}>Review this quote ↗</button></article>)}</div>}
   {chosen&&<form className="journey-panel journey-choice" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void send('select_quote',{quote_id:chosen.id,address:form.get('address')});}}><h3>{chosen.expert_name} · {money(chosen.total_price_cents)}</h3><p>{chosen.scope_summary}</p><label className="care-field">Service street address<input name="address" minLength={5} maxLength={250} required autoComplete="street-address" placeholder="Street address for this appointment" disabled={busy||uncertain}/></label><p className="care-help">{data.details.suburb} {data.details.postcode}. Your selected window is a request until operations confirms availability. No payment is taken here.</p><button className="care-entry-button" disabled={busy||uncertain} type="submit">Request this appointment</button><button className="journey-text-button" disabled={busy||uncertain} onClick={()=>setChosen(null)} type="button">Back to quotes</button></form>}</section>}
   {selected&&<section className="journey-panel"><p className="eyebrow">YOUR SELECTED EXPERT</p><h2>{selected.expert_name}</h2><strong className="journey-price">{money(selected.total_price_cents)}</strong><p>{selected.scope_summary}</p><p>{data.details.address} {data.details.suburb} {data.details.postcode}</p><p className="care-help">No payment has been taken through Skycar.</p></section>}
   <div className="journey-columns"><section className="journey-panel"><p className="eyebrow">THE WORK</p><h2>Your request</h2><p className="journey-description">{data.request.description}</p><div className="journey-private-photos">{data.photos.map(slot=><PrivateJourneyPhoto key={`${account}:${slot}`} id={id} slot={slot} account={account}/>)}</div>
   {!data.photos.length&&['review','quotes_ready'].includes(data.state)&&<><DamagePhotos files={files} disabled={busy||uncertain} onChange={setFiles} onProcessing={setPreparing}/><button className="care-entry-button" disabled={!files.length||preparing||busy||uncertain} onClick={()=>void send(undefined,undefined,true)}>Save photos with request</button><p className="care-help">Choose all your photos before saving. Saved photos stay with this request.</p></>}
   <div className="journey-review-note"><strong>Reviewed by an expert</strong><p>Photos help explain visible damage. Any inspection needed and the proposed repair work should be included in the expert’s quote.</p></div></section>
   <section className="journey-panel"><p className="eyebrow">WHERE &amp; WHO</p><h2>Service details</h2>{['review','quotes_ready'].includes(data.state)?<form key={`${account}:${data.revision}`} onSubmit={e=>{e.preventDefault();void send('update_details',Object.fromEntries(new FormData(e.currentTarget)));}}><fieldset disabled={busy||uncertain}><label className="care-field">Contact name<input name="name" required minLength={2} maxLength={100} defaultValue={data.details.name||''} autoComplete="name"/></label><label className="care-field">Phone<input name="phone" type="tel" required minLength={8} maxLength={24} defaultValue={data.details.phone||''} autoComplete="tel"/></label><label className="care-field">Suburb<input name="suburb" required minLength={2} maxLength={100} defaultValue={data.details.suburb||''} autoComplete="address-level2"/></label><label className="care-field">Postcode<input name="postcode" required pattern="[0-9]{4}" maxLength={4} defaultValue={data.details.postcode||''} autoComplete="postal-code"/></label><button className="care-entry-button" type="submit">Save service details</button></fieldset></form>:<p>{data.details.name}<br/>{data.details.phone}<br/>{data.details.suburb} {data.details.postcode}</p>}<p className="care-help">{data.kind==='guest'?'Keep this link in this browser to return without an account.':'This request is connected to your Garage vehicle.'}</p></section></div>
   {!!data.completion_photos.length&&<section className="journey-panel"><p className="eyebrow">THE RESULT</p><h2>Completion photos</h2><div className="journey-private-photos">{data.completion_photos.map(slot=><PrivateJourneyPhoto key={`${account}:complete:${slot}`} id={id} slot={slot} account={account} completion/>)}</div></section>}
   {data.state==='completed'&&data.completion_review.state==='awaiting_review'&&<section className="journey-panel journey-completion-review"><p className="eyebrow">YOUR REVIEW</p><h2>How does the completed work look?</h2><p>Check the completion photos before choosing. Neither option charges, releases or refunds money.</p>
    <form onSubmit={event=>{event.preventDefault();void send('confirm_completion',{});}}><fieldset disabled={busy||uncertain}><label className="journey-review-choice"><input type="checkbox" required/> The completed work looks good and I confirm this service record.</label><button className="care-entry-button" type="submit">Confirm completed work</button></fieldset></form>
    <form onSubmit={event=>{event.preventDefault();void send('report_completion_issue',{details:issueDetails});}}><fieldset disabled={busy||uncertain}><label className="care-field">Report an issue privately<textarea value={issueDetails} onChange={event=>setIssueDetails(event.target.value)} minLength={10} maxLength={2000} required placeholder="Describe what needs Skycar operations to review."/></label><p className="care-help">Skycar operations will review this report. This does not automatically create a refund or change payment.</p><button className="journey-text-button" type="submit">Report completion issue</button></fieldset></form>
   </section>}
   {data.state==='completed'&&data.completion_review.state==='confirmed'&&<section className="journey-panel journey-completion-outcome"><p className="eyebrow">REVIEW SAVED</p><h2>Completed work confirmed</h2><p>Your confirmation is saved with this service record. No payment action was taken.</p></section>}
   {data.state==='completed'&&data.completion_review.state==='issue_reported'&&<section className="journey-panel journey-completion-outcome"><p className="eyebrow">PRIVATE ISSUE SAVED</p><h2>Skycar operations review requested</h2><p>Your report is saved privately for operations:</p><blockquote>{data.completion_review.issue_details}</blockquote><p className="care-help">No refund or payment change was made automatically.</p></section>}
   <section className="journey-panel"><h2>Recorded updates</h2><ol className="journey-events"><li><span>Request received</span><time>{date(data.request.created_at)}</time></li>{data.events.map(event=><li key={event.id}><span>{events[event.type]}</span><time>{date(event.occurred_at)}</time></li>)}</ol></section>
   <footer className="journey-footer"><p>Request reference <span>{id}</span></p>{['review','quotes_ready','booking_requested','scheduled'].includes(data.state)&&<button className="journey-text-button" disabled={busy||uncertain} onClick={()=>void send('request_cancel',{})}>Request cancellation</button>}</footer>
  </>}
 </main>;
}
