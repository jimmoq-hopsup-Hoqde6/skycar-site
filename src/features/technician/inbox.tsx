"use client";
/* eslint-disable @next/next/no-img-element -- Private images are fetched after access verification and use local object URLs. */
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {readTechnicianInbox,readTechnicianDetail} from '@/domain/technician/inbox.mjs';
import {api,states,date,JourneyApiError} from '@/features/care/journey/types';
import './inbox.css';

type Profile={expert_id:string;business_name:string;description:string;services:string[];postcodes:string[];insurance_valid_until:string};
type Job={id:string;kind:'account'|'guest';vehicle:string;service:'repair'|'cleaning';description:string;postcode:string;state:string;access:'invited'|'selected';created_at:string;appointment:{starts_at:string;ends_at:string}|null;contact:Record<string,string>|null;photos?:number[]};
type Inbox={profile:Profile;jobs:Job[];has_more:boolean};
type Detail={profile:Profile;job:Job};

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
  const load=useCallback(async()=>{
    read.current?.abort();const controller=new AbortController();read.current=controller;const version=++epoch.current;
    setInbox(null);setDetail(null);setAccount('');setLoading(true);setError('');setStatus(0);
    try{
      const result=await api(`/api/v1/technician/jobs${id?`/${id}`:''}`,{signal:controller.signal});if(version!==epoch.current)return;
      if(!result.account||!/^[0-9a-f-]{36}$/i.test(result.account))throw new Error('The technician account could not be verified.');
      if(id)setDetail(readTechnicianDetail(result.data,id));else setInbox(readTechnicianInbox(result.data));setAccount(result.account);
    }catch(caught){if(version!==epoch.current||controller.signal.aborted)return;setError(caught instanceof Error?caught.message:'Technician jobs could not be loaded.');if(caught instanceof JourneyApiError)setStatus(caught.status);}
    finally{if(version===epoch.current)setLoading(false);}
  },[id]);
  const invalidate=useCallback(()=>{epoch.current++;read.current?.abort();},[]);
  useEffect(()=>{const refresh=()=>{void load();};const visible=()=>{if(document.visibilityState==='visible')refresh();};queueMicrotask(refresh);
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);
    return()=>{invalidate();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);};
  },[load,invalidate]);
  const profile=inbox?.profile||detail?.profile;const job=detail?.job;
  const next=id?`/technician/jobs/${id}`:'/technician/jobs';
  return <main className="technician-shell">
    <nav className="technician-nav" aria-label="Technician navigation"><Link className="technician-wordmark" href="/technician/jobs">skycar<span>●</span></Link><Link href="/technician/jobs">My work</Link><Link href="/auth/sign-out">Sign out</Link></nav>
    <header><p className="technician-eyebrow">TECHNICIAN WORKSPACE</p><h1>{id?'Job review':'Your job inbox'}</h1><p>Review the work Skycar has shared with your account.</p></header>
    <div className="technician-toolbar"><span role="status">{loading?'Verifying your account and jobs…':profile?'Latest saved status':'Access not verified'}</span><button type="button" disabled={loading} onClick={()=>void load()}>Refresh jobs</button></div>
    {error&&<section className="technician-error" role="alert"><h2>{status===403?'Technician access required':status===404?'Job unavailable':'Unable to load technician jobs'}</h2><p>{error}</p>{[401,403].includes(status)&&<Link href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in as a technician</Link>}{status===404&&<Link href="/technician/jobs">Return to your inbox</Link>}</section>}
    {profile&&<section className="technician-profile"><h2>{profile.business_name}</h2><p>{profile.description}</p><p>{profile.services.map(service=>service==='repair'?'Repair':'Cleaning').join(' · ')} · Service postcodes: {profile.postcodes.join(', ')}</p></section>}
    {inbox&&<section aria-label="Your technician jobs">{inbox.jobs.length===0?<div className="technician-panel"><h2>No jobs shared yet</h2><p>Jobs appear after Skycar operations invites your linked expert to review a request, or the customer selects your expert for a booking.</p></div>:<ul className="technician-jobs">{inbox.jobs.map(item=><li key={item.id}><Link href={`/technician/jobs/${item.id}`}><span className="technician-eyebrow">{item.service==='repair'?'REPAIR':'CLEANING'} · {item.access==='invited'?'INVITED TO REVIEW':'SELECTED EXPERT'}</span><h2>{item.vehicle}</h2><p>{item.description}</p><strong>{states[item.state].title}</strong><span>Service postcode {item.postcode}</span><span className="technician-open">Review job →</span></Link></li>)}</ul>}{inbox.has_more&&<p>Showing your latest 50 jobs. Ask operations about older work.</p>}</section>}
    {job&&<>
      <section className="technician-panel"><p className="technician-eyebrow">{job.access==='invited'?'INVITATION TO REVIEW — NO BOOKING':'YOUR SELECTED JOB'}</p><h2>{job.vehicle}</h2><h3>{states[job.state].title}</h3><p>{states[job.state].detail}</p><p className="technician-description">{job.description}</p><p>Service postcode {job.postcode}</p>{job.appointment&&<p><strong>{date(job.appointment.starts_at)}</strong><br/>Until {date(job.appointment.ends_at)} · Adelaide time<br/>{['scheduled','in_progress','completed'].includes(job.state)?'Confirmed appointment':'Appointment requires confirmation'}</p>}</section>
      <section className="technician-panel"><h2>Private request photos</h2>{job.photos?.length?<div className="technician-photos">{job.photos.map(slot=><PrivatePhoto key={`${account}:${id}:${slot}`} account={account} id={job.id} slot={slot}/>)}</div>:<p>No request photos are saved.</p>}</section>
      <section className="technician-panel"><h2>Service contact</h2>{job.contact?<address>{job.contact.name}<br/>{job.contact.phone}<br/>{job.contact.address}<br/>{job.contact.suburb} {job.contact.postcode}</address>:<p>Contact and street address are shared with the selected technician after appointment confirmation.</p>}</section>
      <section className="technician-panel"><h2>Expected payout</h2><p>Unavailable. A technician payout has not been recorded for this job.</p></section>
      <p className="technician-note">This first inbox supports private review. Quote replies, accept/decline and work updates will be connected next. An invitation does not reserve an appointment.</p>
    </>}
  </main>;
}
