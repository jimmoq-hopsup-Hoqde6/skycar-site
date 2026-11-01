"use client";
import {useEffect,useState} from 'react';
import {api,JourneyApiError} from './types';
import {PrivateJourneyPhoto} from './private-photo';
import './journey.css';
// Photos the customer sent with a signed-in request, shown on the My Jobs request page.
// Slots come from the existing journey read; bytes come from the proxy route. Nothing here
// decides whether photos should exist: no photos (or no access) simply renders nothing.
type Slots={status:'loading'}|{status:'none'}|{status:'error'}|{status:'ready';account:string;slots:number[]};
function validSlots(value:unknown):value is number[]{return Array.isArray(value)&&value.length<=3&&value.every(slot=>Number.isInteger(slot)&&slot>=1&&slot<=3);}
export function RequestPhotos({id}:{id:string}){
 const[state,setState]=useState<Slots>({status:'loading'});const[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();
  void api(`/api/v1/care/journey/${encodeURIComponent(id)}`,{signal:controller.signal}).then(({data,account})=>{
   if(controller.signal.aborted)return;
   const body=data as {id?:unknown;photos?:unknown}|null;
   if(!account||!body||body.id!==id||!validSlots(body.photos)){setState({status:'error'});return;}
   setState(body.photos.length?{status:'ready',account,slots:body.photos}:{status:'none'});
  }).catch(error=>{
   if(controller.signal.aborted)return;
   // Access problems are already reported by the request page; do not echo them here.
   setState(error instanceof JourneyApiError&&[401,403,404].includes(error.status)?{status:'none'}:{status:'error'});
  });
  return()=>controller.abort();
 },[id,attempt]);
 if(state.status==='none')return null;
 return <section className="request-photos" aria-labelledby="request-photos-title">
  <h2 id="request-photos-title">Photos you sent</h2>
  {state.status==='loading'&&<p role="status">Checking for photos…</p>}
  {state.status==='error'&&<div role="status"><p>We could not check this request’s photos.</p><button type="button" className="request-photos-retry" onClick={()=>{setState({status:'loading'});setAttempt(value=>value+1);}}>Try again</button></div>}
  {state.status==='ready'&&<div className="journey-private-photos">{state.slots.map(slot=><PrivateJourneyPhoto key={`${id}:${state.account}:${slot}`} id={id} slot={slot} account={state.account}/>)}</div>}
 </section>;
}
