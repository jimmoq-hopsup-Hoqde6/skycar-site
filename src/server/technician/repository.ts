import 'server-only';
import {createSupabaseServerClient,createSupabaseTrustedServerClient} from '@/server/supabase/server';
import {featureEnabled} from '@/server/env';
import {technicianFault,requireTechnicianAccount} from './http.mjs';
import {storeCarePhotos} from '@/server/care/guest-photos.mjs';
import {verifyCompletionEvidence} from '@/server/care/completion-evidence.mjs';
import {photoManifest,journeyPhoto} from '@/server/care/journey/repository';
import {readTechnicianJob,readTechnicianProfile} from '@/domain/technician/inbox.mjs';

async function sessionAccess() {
  if(!featureEnabled('CARE'))throw technicianFault('UNAVAILABLE');
  const session=await createSupabaseServerClient();const auth=await session.auth.getUser();
  if(auth.error||!auth.data.user)throw technicianFault('UNAUTHENTICATED');
  const actor=auth.data.user.id;
  const roles=await session.from('user_roles').select('role').eq('user_id',actor).eq('role','technician');
  if(roles.error)throw technicianFault('UNAVAILABLE');
  if(!roles.data?.length)throw technicianFault('FORBIDDEN');
  const db=createSupabaseTrustedServerClient();
  return {db,actor};
}
async function access(id?:string,expectedAccount?:string) {
  const {db,actor}=await sessionAccess();if(expectedAccount!==undefined)requireTechnicianAccount(actor,expectedAccount);
  const result=await db.rpc('care_technician_read',{p_actor:actor,p_id:id??null});
  if(result.error)throw technicianFault(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return {db,actor,data:result.data};
}
async function detailAccess(id:string,expectedAccount?:string) {
  const result=await access(id,expectedAccount);
  try{readTechnicianProfile(result.data.profile);readTechnicianJob(result.data.job,{id,detail:true,withPhotos:false});}catch{throw technicianFault('UNAVAILABLE');}
  return {...result,media:{db:result.db,id,kind:result.data.job.kind as 'account'|'guest'}};
}
export async function readTechnician(id?:string) {
  if(!id){const result=await access();return {account:result.actor,data:result.data};}
  const result=await detailAccess(id);let photos;
  try{photos=await photoManifest(result.media);}catch{throw technicianFault('UNAVAILABLE');}
  const quotes=await result.db.from('care_reviewed_quotes').select('id,scope_summary,total_price_cents,currency,status,expires_at,starts_at,ends_at').eq('journey_id',id).eq('expert_id',result.data.profile.expert_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(20);
  if(quotes.error)throw technicianFault('UNAVAILABLE');
  let completion=result.data.job.access==='selected'&&['in_progress','completed'].includes(result.data.job.state)?await photoManifest(result.media,true):[];
  if(completion.length){try{await verifyCompletionEvidence(completion,(slot:number)=>journeyPhoto(result.media,slot,true));}catch{if(result.data.job.state==='in_progress')completion=[];else throw technicianFault('UNAVAILABLE');}}
  return {account:result.actor,data:{...result.data,completion_photos:completion.map(p=>p.slot),job:{...result.data.job,photos:photos.map(p=>p.slot)},own_quotes:quotes.data}};
}
export async function readTechnicianPhoto(id:string,slot:number) {
  const result=await detailAccess(id);
  try{const photo=await journeyPhoto(result.media,slot);return {...photo,account:result.actor};}
  catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
}

function requireCompletionJob(job:{access:string;state:string},upload=false){
 if(job.access!=='selected')throw technicianFault('NOT_FOUND');
 if(!(upload?job.state==='in_progress':['in_progress','completed'].includes(job.state)))throw technicianFault('INVALID_TRANSITION');
}
export async function uploadTechnicianCompletion(id:string,photos:{bytes:Buffer;mimeType:string;hash:string}[],expectedAccount:string){
 const result=await detailAccess(id,expectedAccount);requireCompletionJob(result.data.job,true);
 const permission=await result.db.rpc('care_technician_completion_upload_access',{p_actor:result.actor,p_id:id});
 if(permission.error)throw technicianFault(permission.error.code==='P0001'?permission.error.message:'UNAVAILABLE');if(permission.data!==true)throw technicianFault('UNAVAILABLE');
 try{await storeCarePhotos(result.db.storage.from('private-media'),`care-completion/${id}`,photos);}
 catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
 return {account:result.actor,stored:photos.length};
}
export async function readTechnicianCompletionPhoto(id:string,slot:number){
 const result=await detailAccess(id);requireCompletionJob(result.data.job);
 try{const photo=await journeyPhoto(result.media,slot,true);return {...photo,account:result.actor};}
 catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
}
export async function technicianCommand(id:string,key:string,body:{action:string;payload:Record<string,unknown>},expectedAccount:string) {
  const {db,actor}=await sessionAccess();requireTechnicianAccount(actor,expectedAccount);
  let payload=body.payload;
  if(body.action==='complete'){
   const detail=await db.rpc('care_technician_read',{p_actor:actor,p_id:id});
   if(detail.error)throw technicianFault(detail.error.code==='P0001'?detail.error.message:'UNAVAILABLE');
   try{readTechnicianProfile(detail.data.profile);readTechnicianJob(detail.data.job,{id,detail:true,withPhotos:false});}catch{throw technicianFault('UNAVAILABLE');}
   requireCompletionJob(detail.data.job);
   const media={db,id,kind:detail.data.job.kind as 'account'|'guest'};
   try{payload={evidence:await verifyCompletionEvidence(await photoManifest(media,true),(slot:number)=>journeyPhoto(media,slot,true))};}
   catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
  }
  const result=await db.rpc(['start','complete'].includes(body.action)?'care_technician_work_command':'care_technician_job_command',{p_actor:actor,p_key:key,p_action:body.action,p_id:id,p_payload:payload});
  if(result.error)throw technicianFault(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return {account:actor,data:result.data};
}
