"use client";
/* eslint-disable @next/next/no-img-element -- Private images use local object URLs, never the public image optimizer. */
import {useEffect,useRef,useState} from 'react';
export function PrivateJourneyPhoto({id,slot,account,completion=false}:{id:string;slot:number;account:string;completion?:boolean}){
 const image=useRef<HTMLImageElement>(null);const[failed,setFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();let url:string|undefined;const element=image.current;
  void fetch(`/api/v1/care/journey/${id}/photos/${slot}${completion?'?kind=completion':''}`,{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(async response=>{
   if(!response.ok||response.headers.get('X-Skycar-Account')!==account)throw new Error();const blob=await response.blob();if(controller.signal.aborted)return;url=URL.createObjectURL(blob);if(element)element.src=url;
  }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
  return()=>{controller.abort();if(element)element.removeAttribute('src');if(url)URL.revokeObjectURL(url);};
 },[id,slot,account,completion]);
 return <figure>{failed?<figcaption>Photo unavailable. Refresh to retry.</figcaption>:<img ref={image} alt={`${completion?'Completed work':'Request'} photo ${slot}`}/>}</figure>;
}
