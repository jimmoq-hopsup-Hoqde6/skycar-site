import 'server-only';
import {createSupabaseServerClient,createSupabaseTrustedServerClient} from '@/server/supabase/server';
import {featureEnabled} from '@/server/env';
import {technicianFault,requireTechnicianAccount} from './http.mjs';
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
async function access(id?:string) {
  const {db,actor}=await sessionAccess();
  const result=await db.rpc('care_technician_read',{p_actor:actor,p_id:id??null});
  if(result.error)throw technicianFault(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return {db,actor,data:result.data};
}
async function detailAccess(id:string) {
  const result=await access(id);
  try{readTechnicianProfile(result.data.profile);readTechnicianJob(result.data.job,{id,detail:true,withPhotos:false});}catch{throw technicianFault('UNAVAILABLE');}
  return {...result,media:{db:result.db,id,kind:result.data.job.kind as 'account'|'guest'}};
}
export async function readTechnician(id?:string) {
  if(!id){const result=await access();return {account:result.actor,data:result.data};}
  const result=await detailAccess(id);let photos;
  try{photos=await photoManifest(result.media);}catch{throw technicianFault('UNAVAILABLE');}
  const quotes=await result.db.from('care_reviewed_quotes').select('id,scope_summary,total_price_cents,currency,status,expires_at,starts_at,ends_at').eq('journey_id',id).eq('expert_id',result.data.profile.expert_id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(20);
  if(quotes.error)throw technicianFault('UNAVAILABLE');
  return {account:result.actor,data:{...result.data,job:{...result.data.job,photos:photos.map(p=>p.slot)},own_quotes:quotes.data}};
}
export async function readTechnicianPhoto(id:string,slot:number) {
  const result=await detailAccess(id);
  try{const photo=await journeyPhoto(result.media,slot);return {...photo,account:result.actor};}
  catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
}

export async function technicianCommand(id:string,key:string,body:{action:string;payload:Record<string,unknown>},expectedAccount:string) {
  const {db,actor}=await sessionAccess();requireTechnicianAccount(actor,expectedAccount);
  const result=await db.rpc(body.action==='start'?'care_technician_work_command':'care_technician_job_command',{p_actor:actor,p_key:key,p_action:body.action,p_id:id,p_payload:body.payload});
  if(result.error)throw technicianFault(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return {account:actor,data:result.data};
}
