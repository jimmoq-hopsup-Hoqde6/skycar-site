"use client";
/* eslint-disable @next/next/no-img-element -- Private images use local object URLs, never the public image optimizer. */
import {useEffect,useState} from 'react';
import './journey.css';
// Display only. Bytes come from the proxy route, which re-checks the account on every read
// (the X-Skycar-Account header must match the verified page account).
type Loaded={status:'loading'}|{status:'ready';src:string}|{status:'missing'}|{status:'unavailable'};
export function PrivateJourneyPhoto({id,slot,account,completion=false}:{id:string;slot:number;account:string;completion?:boolean}){
 const[state,setState]=useState<Loaded>({status:'loading'});const[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();let url:string|undefined;
  void fetch(`/api/v1/care/journey/${id}/photos/${slot}${completion?'?kind=completion':''}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(async response=>{
   if(response.status===404){if(!controller.signal.aborted)setState({status:'missing'});return;}
   if(!response.ok||response.headers.get('X-Skycar-Account')!==account)throw new Error();
   const blob=await response.blob();if(controller.signal.aborted)return;url=URL.createObjectURL(blob);setState({status:'ready',src:url});
  }).catch(()=>{if(!controller.signal.aborted)setState({status:'unavailable'});});
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[id,slot,account,completion,attempt]);
 const label=`${completion?'Completed work':'Request'} photo ${slot}`;
 return <figure className="journey-photo" data-state={state.status} aria-busy={state.status==='loading'}>
  {state.status==='ready'&&<img src={state.src} alt={label}/>}
  {state.status==='loading'&&<div className="journey-photo-state" role="status"><span>Loading {label.toLowerCase()}…</span></div>}
  {state.status==='missing'&&<div className="journey-photo-state" role="status"><span>{label} is no longer available.</span></div>}
  {state.status==='unavailable'&&<div className="journey-photo-state" role="alert"><span>{label} could not be loaded.</span><button type="button" onClick={()=>{setState({status:'loading'});setAttempt(value=>value+1);}}>Try again</button></div>}
 </figure>;
}
