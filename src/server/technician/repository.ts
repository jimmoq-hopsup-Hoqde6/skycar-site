import 'server-only';
import {createSupabaseServerClient,createSupabaseTrustedServerClient} from '@/server/supabase/server';
import {featureEnabled} from '@/server/env';
import {technicianFault} from './http.mjs';
import {photoManifest,journeyPhoto} from '@/server/care/journey/repository';
import {readTechnicianJob,readTechnicianProfile} from '@/domain/technician/inbox.mjs';

async function access(id?:string) {
  if(!featureEnabled('CARE'))throw technicianFault('UNAVAILABLE');
  const session=await createSupabaseServerClient();const auth=await session.auth.getUser();
  if(auth.error||!auth.data.user)throw technicianFault('UNAUTHENTICATED');
  const actor=auth.data.user.id;
  const roles=await session.from('user_roles').select('role').eq('user_id',actor).eq('role','technician');
  if(roles.error)throw technicianFault('UNAVAILABLE');
  if(!roles.data?.length)throw technicianFault('FORBIDDEN');
  const db=createSupabaseTrustedServerClient();
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
  return {account:result.actor,data:{...result.data,job:{...result.data.job,photos:photos.map(p=>p.slot)}}};
}
export async function readTechnicianPhoto(id:string,slot:number) {
  const result=await detailAccess(id);
  try{const photo=await journeyPhoto(result.media,slot);return {...photo,account:result.actor};}
  catch(error){throw technicianFault(error instanceof Error&&'code' in error?String(error.code):'UNAVAILABLE');}
}
