export type Quote={id:string;expert_name:string;expert_description:string;scope_summary:string;total_price_cents:number;currency:'AUD';status:string;expires_at:string;starts_at:string;ends_at:string};
export type Journey={id:string;kind:'guest'|'account';state:string;revision:number;request:{vehicle:string;service:string;description:string;created_at:string};details:Record<string,string>;quotes:Quote[];selected_quote_id:string|null;appointment:{starts_at:string;ends_at:string}|null;events:{id:number;type:string;occurred_at:string}[];photos:number[];completion_photos:number[];completion_review:{state:null|'awaiting_review'|'confirmed'|'issue_reported';issue_details?:string};technician_invitations?:{expert_id:string;active:boolean}[]};
export const states:Record<string,{title:string;detail:string;step:number}>={
 review:{title:'Your request is under review',detail:'Your details and photos help an expert review the work and prepare a quote.',step:0},
 quotes_ready:{title:'Review your quotes',detail:'Compare the proposed work, total price and appointment window before choosing.',step:1},
 booking_requested:{title:'Your appointment is requested',detail:'Skycar operations will check the expert’s availability and confirm the appointment here.',step:2},
 scheduled:{title:'Your appointment is confirmed',detail:'Your expert and appointment window are recorded below.',step:2},
 in_progress:{title:'Your car is being cared for',detail:'Work has started. Completion photos will be added when the job is finished.',step:3},
 completed:{title:'Your service is complete',detail:'Review the completion photos and keep the service record with your car.',step:4},
 cancellation_requested:{title:'Cancellation requested',detail:'Skycar operations needs to confirm your cancellation. An existing appointment remains held until then.',step:2},
 cancelled:{title:'Your request is cancelled',detail:'This service will not proceed. No payment was taken through Skycar.',step:0},
};
export const events:Record<string,string>={details_updated:'Service details updated',quote_issued:'Expert quote issued',quote_withdrawn:'Expert proposal withdrawn',booking_requested:'Appointment requested',booking_confirmed:'Appointment confirmed',work_started:'Work started',work_completed:'Work completed',completion_confirmed:'Completion confirmed by customer',completion_issue_reported:'Completion issue reported',cancellation_requested:'Cancellation requested',booking_cancelled:'Request cancelled'};
export function readJourney(value:unknown,id:string):Journey {
 const d=value as Journey;const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const review=d?.completion_review;const validReview=review&&typeof review==='object'&&!Array.isArray(review)&&['state',...(Object.hasOwn(review,'issue_details')?['issue_details']:[])].every(k=>Object.hasOwn(review,k))&&Object.keys(review).every(k=>['state','issue_details'].includes(k))&&[null,'awaiting_review','confirmed','issue_reported'].includes(review.state)&&
  (review.state==='issue_reported'?typeof review.issue_details==='string'&&review.issue_details.length>=10&&review.issue_details.length<=2000:!Object.hasOwn(review,'issue_details'));
 if(!d||d.id!==id||!Object.hasOwn(states,d.state)||!['guest','account'].includes(d.kind)||!d.request||typeof d.request.vehicle!=='string'||typeof d.request.description!=='string'||!['repair','cleaning'].includes(d.request.service)||!d.details||typeof d.details!=='object'||Object.values(d.details).some(v=>typeof v!=='string')||!Array.isArray(d.quotes)||d.quotes.some(q=>!q||typeof q.id!=='string'||typeof q.expert_name!=='string'||typeof q.scope_summary!=='string'||!Number.isInteger(q.total_price_cents)||q.total_price_cents<1||q.currency!=='AUD'||!date(q.expires_at)||!date(q.starts_at)||!date(q.ends_at))||!Array.isArray(d.events)||d.events.some(e=>!e||!Object.hasOwn(events,e.type)||!date(e.occurred_at))||![d.photos,d.completion_photos].every(a=>Array.isArray(a)&&a.length<=3&&a.every(n=>Number.isInteger(n)&&n>=1&&n<=3))||(d.appointment!==null&&(!d.appointment||!date(d.appointment.starts_at)||!date(d.appointment.ends_at)))||!validReview||(d.state==='completed'&&review.state===null)||(d.state!=='completed'&&review.state!==null))throw new Error('We could not verify the latest service details.');
 return d;
}
export const money=(cents:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(cents/100);
export const date=(value:string)=>new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short',timeZone:'Australia/Adelaide'});
export class JourneyApiError extends Error {constructor(message:string,public status:number,public retryable:boolean){super(message);}}
export async function api(path:string,options:RequestInit={}) {
 let response:Response;
 try{response=await fetch(path,{...options,cache:'no-store',credentials:'same-origin',signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{throw new JourneyApiError('We could not confirm the result. Please retry the same action.',0,true);}
 let envelope;try{envelope=await response.json();}catch{throw new JourneyApiError('We could not verify the response. Please refresh or retry the same action.',response.status,true);}
 if(!response.ok)throw new JourneyApiError(envelope.error?.message||'The request could not be completed.',response.status,envelope.error?.retryable===true||response.status>=500);
 return {data:envelope.data,account:response.headers.get('X-Skycar-Account')};
}
