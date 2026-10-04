"use client";
/* eslint-disable @next/next/no-img-element -- Private images are fetched after access verification and use local object URLs. */
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {readTechnicianInbox,readTechnicianDetail} from '@/domain/technician/inbox.mjs';
import {quotePriceCents,quoteInstant,readTechnicianCommand,readTechnicianCommandResult} from '@/domain/technician/commands.mjs';
import {api,states,date,money,JourneyApiError} from '@/features/care/journey/types';
import './inbox.css';

type Profile={expert_id:string;business_name:string;description:string;services:string[];postcodes:string[];insurance_valid_until:string};
type Job={id:string;kind:'account'|'guest';vehicle:string;service:'repair'|'cleaning';description:string;postcode:string;state:string;access:'invited'|'selected';created_at:string;appointment:{starts_at:string;ends_at:string}|null;contact:Record<string,string>|null;photos?:number[]};
type Inbox={profile:Profile;jobs:Job[];has_more:boolean};
type OwnQuote={id:string;scope_summary:string;total_price_cents:number;currency:string;status:string;expires_at:string;starts_at:string;ends_at:string};
type Detail={profile:Profile;job:Job;own_quotes?:OwnQuote[]};
type Attempt={key:string;account:string;id:string;action:'quote'|'decline'|'start';body:string};

function PrivatePhoto({id,slot,account}:{id:string;slot:number;account:string}){
  const element=useRef<HTMLImageElement>(null);const[failed,setFailed]=useState(false);
  useEffect(()=>{const controller=new AbortController();let url:string|undefined;const image=element.current;
    void fetch(`/api/v1/technician/jobs/${id}/photos/${slot}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{
      if(!response.ok||response.headers.get('X-Skycar-Account')!==account)throw new Error();
      const blob=await response.blob();if(controller.signal.aborted)return;url=URL.createObjectURL(blob);if(image)image.src=url;
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>{controller.abort();if(image)image.removeAttribute('src');if(url)URL.revokeObjectURL(url);};
  },[id,slot,account]);
  return <figure>{failed?<figcaption>Private photo unavailable. Refresh to retry.</figcaption>:<img ref={element} alt={`Request photo ${slot}`}/>}</figure>;
}

export function TechnicianInbox({id}:{id?:string}){
  const[inbox,setInbox]=useState<Inbox|null>(null);const[detail,setDetail]=useState<Detail|null>(null);const[account,setAccount]=useState('');
  const[loading,setLoading]=useState(true);const[error,setError]=useState('');const[status,setStatus]=useState(0);
  const epoch=useRef(0);const read=useRef<AbortController|null>(null);
  const attempt=useRef<Attempt|null>(null);const verifiedAccount=useRef('');const locked=useRef(false);
  const[checkedAt,setCheckedAt]=useState(0);const[busy,setBusy]=useState(false);const[uncertain,setUncertain]=useState(false);const[notice,setNotice]=useState('');
  const clearPrivate=useCallback(()=>{attempt.current=null;verifiedAccount.current='';setUncertain(false);setAccount('');setInbox(null);setDetail(null);},[]);
  const load=useCallback(async()=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;const version=++epoch.current;
    setInbox(null);setDetail(null);setAccount('');setLoading(true);setError('');setStatus(0);
    try{
      const result=await api(`/api/v1/technician/jobs${id?`/${id}`:''}`,{signal:controller.signal});if(version!==epoch.current)return;
      if(!result.account||!/^[0-9a-f-]{36}$/i.test(result.account))throw new Error('The technician account could not be verified.');
      if(verifiedAccount.current&&verifiedAccount.current!==result.account){attempt.current=null;setUncertain(false);setNotice('');}verifiedAccount.current=result.account;
      if(id)setDetail(readTechnicianDetail(result.data,id));else setInbox(readTechnicianInbox(result.data));setAccount(result.account);setCheckedAt(Date.now());
    }catch(caught){if(version!==epoch.current||controller.signal.aborted)return;setError(caught instanceof Error?caught.message:'Technician jobs could not be loaded.');if(caught instanceof JourneyApiError){setStatus(caught.status);if([401,403,404].includes(caught.status))clearPrivate();}}
    finally{if(version===epoch.current)setLoading(false);}
  },[id,clearPrivate]);
  const invalidate=useCallback(()=>{epoch.current++;read.current?.abort();},[]);
  useEffect(()=>{const refresh=()=>{void load();};const visible=()=>{if(document.visibilityState==='visible')refresh();};queueMicrotask(refresh);
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);
    return()=>{invalidate();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);};
  },[load,invalidate]);
  async function send(action?:'quote'|'decline'|'start',payload?:Record<string,unknown>){
    if(locked.current||loading||!account||!id)return;
    if(!attempt.current){
      if(!action||(action==='start'?(detail?.job.access!=='selected'||detail.job.state!=='scheduled'):detail?.job.access!=='invited'))return;
      try{const command=readTechnicianCommand({action,payload});attempt.current={key:crypto.randomUUID(),account,id,action,body:JSON.stringify(command)};}
      catch{setError('Check the scope, AUD price and proposed times.');return;}
    }
    const original=attempt.current;if(original.account!==account||original.id!==id)return;
    locked.current=true;setBusy(true);setError('');setNotice('');const version=epoch.current;
    try{
      const result=await api(`/api/v1/technician/jobs/${original.id}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':original.key,'X-Skycar-Account':original.account},body:original.body});
      if(version!==epoch.current)return;
      if(result.account!==original.account)throw new JourneyApiError('Your technician account changed. Refresh before continuing.',403,false);
      readTechnicianCommandResult(result.data,original.id,original.action);attempt.current=null;setUncertain(false);
      if(original.action==='decline'){setDetail(null);setInbox(null);setNotice('You declined this request. It has been removed from your review inbox.');}
      else{setNotice(original.action==='start'?'Work has started. The customer can see this saved progress.':'Your proposal is saved for the customer to review. The appointment is not confirmed.');await load();}
    }catch(caught){
      if(version!==epoch.current)return;
      if(caught instanceof JourneyApiError&&[401,403,404].includes(caught.status)){clearPrivate();setStatus(caught.status);}
      else if(caught instanceof JourneyApiError&&!caught.retryable){attempt.current=null;setUncertain(false);}
      setError(caught instanceof Error?caught.message:'The action could not be confirmed. Retry the same action.');
    }finally{locked.current=false;setBusy(false);if(attempt.current)setUncertain(true);}
  }
  const profile=inbox?.profile||detail?.profile;const job=detail?.job;
  const next=id?`/technician/jobs/${id}`:'/technician/jobs';
  return <main className="technician-shell">
    <nav className="technician-nav" aria-label="Technician navigation"><Link className="technician-wordmark" href="/technician/jobs">skycar<span>●</span></Link><Link href="/technician/jobs">My work</Link><Link href="/auth/sign-out">Sign out</Link></nav>
    <header><p className="technician-eyebrow">TECHNICIAN WORKSPACE</p><h1>{id?'Job review':'Your job inbox'}</h1><p>Review the work Skycar has shared with your account.</p></header>
    <div className="technician-toolbar"><span role="status">{loading?'Verifying your account and jobs…':profile?'Latest saved status':'Access not verified'}</span><button type="button" disabled={loading||busy} onClick={()=>void load()}>Refresh jobs</button></div>
    {error&&<section className="technician-error" role="alert"><h2>{status===403?'Technician access required':status===404?'Job unavailable':'Unable to load technician jobs'}</h2><p>{error}</p>{[401,403].includes(status)&&<Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in as a technician</Link>}{status===404&&<Link href="/technician/jobs">Return to your inbox</Link>}</section>}
    {notice&&<section className="technician-panel" role="status"><p>{notice}</p>{!detail&&<Link href="/technician/jobs">Return to your inbox</Link>}</section>}
    {uncertain&&<section className="technician-panel" role="status"><p>The previous action has not been confirmed. Its original details are kept for a safe retry.</p><button disabled={busy||loading||!account} onClick={()=>void send()}>Retry same action</button></section>}
    {profile&&<section className="technician-profile"><h2>{profile.business_name}</h2><p>{profile.description}</p><p>{profile.services.map(service=>service==='repair'?'Repair':'Cleaning').join(' · ')} · Service postcodes: {profile.postcodes.join(', ')}</p></section>}
    {inbox&&<section aria-label="Your technician jobs">{inbox.jobs.length===0?<div className="technician-panel"><h2>No jobs shared yet</h2><p>Jobs appear after Skycar operations invites your linked expert to review a request, or the customer selects your expert for a booking.</p></div>:<ul className="technician-jobs">{inbox.jobs.map(item=><li key={item.id}><Link href={`/technician/jobs/${item.id}`}><span className="technician-eyebrow">{item.service==='repair'?'REPAIR':'CLEANING'} · {item.access==='invited'?'INVITED TO REVIEW':'SELECTED EXPERT'}</span><h2>{item.vehicle}</h2><p>{item.description}</p><strong>{states[item.state].title}</strong><span>Service postcode {item.postcode}</span><span className="technician-open">Review job →</span></Link></li>)}</ul>}{inbox.has_more&&<p>Showing your latest 50 jobs. Ask operations about older work.</p>}</section>}
    {job&&<>
      <section className="technician-panel"><p className="technician-eyebrow">{job.access==='invited'?'INVITATION TO REVIEW — NO BOOKING':'YOUR SELECTED JOB'}</p><h2>{job.vehicle}</h2><h3>{states[job.state].title}</h3><p>{states[job.state].detail}</p><p className="technician-description">{job.description}</p><p>Service postcode {job.postcode}</p>{job.appointment&&<p><strong>{date(job.appointment.starts_at)}</strong><br/>Until {date(job.appointment.ends_at)} · Adelaide time<br/>{['scheduled','in_progress','completed'].includes(job.state)?'Confirmed appointment':'Appointment requires confirmation'}</p>}</section>
      {!!detail?.own_quotes?.length&&<section className="technician-panel"><h2>Your saved proposals</h2><p>Only your expert’s quotes are shown. A proposal does not reserve a slot.</p>{detail.own_quotes.map(quote=><article key={quote.id} className="technician-saved-quote"><strong>{money(quote.total_price_cents)} · {quote.status}</strong><p>{quote.scope_summary}</p><p>{date(quote.starts_at)} to {date(quote.ends_at)} · Adelaide time<br/>Valid until {date(quote.expires_at)}</p></article>)}</section>}
      {job.access==='invited'&&<section className="technician-panel"><h2>Propose your work and appointment</h2><p>Submit the complete AUD price and a time you can offer. Skycar operations confirms capacity after the customer selects a proposal.</p><form key={`${account}:${id}`} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{void send('quote',{scope_summary:form.get('scope_summary'),total_price_cents:quotePriceCents(form.get('total_price')),expires_at:quoteInstant(form.get('expires_at')),starts_at:quoteInstant(form.get('starts_at')),ends_at:quoteInstant(form.get('ends_at'))});}catch(caught){setError(caught instanceof Error?caught.message:'Check your proposal.');}}}>
        <fieldset disabled={busy||uncertain||loading}><label>Work and inspection scope<textarea name="scope_summary" required minLength={10} maxLength={2000}/></label><label>Total quote price (AUD)<input name="total_price" required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="495.00"/></label><div className="technician-form-grid"><label>Quote valid until<input name="expires_at" type="datetime-local" required/></label><label>Proposed appointment start<input name="starts_at" type="datetime-local" required/></label><label>Proposed appointment end<input name="ends_at" type="datetime-local" required/></label></div><p>Enter times in this device’s timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Saved appointments display in Adelaide time.</p><button type="submit">Send proposal to customer</button></fieldset>
      </form><form onSubmit={event=>{event.preventDefault();void send('decline',{});}}><fieldset disabled={busy||uncertain||loading}><label className="technician-check"><input type="checkbox" required/> I cannot take this request and want to withdraw my current proposal.</label><button type="submit">Decline request</button></fieldset></form></section>}
      {job.access==='selected'&&job.state==='scheduled'&&<section className="technician-panel"><h2>Start your confirmed work</h2><p>Start when you are ready to work at the confirmed appointment. The customer will see the saved progress.</p>{job.appointment&&Date.parse(job.appointment.starts_at)<=checkedAt?<form key={`${account}:${id}:start`} onSubmit={event=>{event.preventDefault();void send('start',{});}}><fieldset disabled={busy||uncertain||loading}><label className="technician-check"><input type="checkbox" required/> I am ready to start this confirmed job.</label><button type="submit">Start work</button></fieldset></form>:<p>Work can start at the appointment time. Refresh jobs when it is due.</p>}</section>}
      <section className="technician-panel"><h2>Private request photos</h2>{job.photos?.length?<div className="technician-photos">{job.photos.map(slot=><PrivatePhoto key={`${account}:${id}:${slot}`} account={account} id={job.id} slot={slot}/>)}</div>:<p>No request photos are saved.</p>}</section>
      <section className="technician-panel"><h2>Service contact</h2>{job.contact?<address>{job.contact.name}<br/>{job.contact.phone}<br/>{job.contact.address}<br/>{job.contact.suburb} {job.contact.postcode}</address>:<p>Contact and street address are shared with the selected technician after appointment confirmation.</p>}</section>
      <section className="technician-panel"><h2>Expected payout</h2><p>Unavailable. A technician payout has not been recorded for this job.</p></section>
      <p className="technician-note">An invitation and proposal do not reserve an appointment. Completion photos and customer review will be connected next.</p>
    </>}
  </main>;
}
