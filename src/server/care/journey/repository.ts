import 'server-only';
import { createHash } from 'node:crypto';
import { createSupabaseServerClient,createSupabaseTrustedServerClient } from '@/server/supabase/server';
import { featureEnabled,requireSupabaseSecretConfig } from '@/server/env';
import { verifyGuestCookie } from './access.mjs';
import { JourneyError,identifier } from './http';
import { storeCarePhotos } from '@/server/care/guest-photos.mjs';

type Photo = {bytes:Buffer;mimeType:string;hash:string};
type ManifestEntry = {slot:number;mime_type:string;size_bytes:number;sha256:string};
export async function operationsAccess() {
 if(!featureEnabled('CARE'))throw new JourneyError('UNAVAILABLE');
 const session=await createSupabaseServerClient();
 const {data,error}=await session.auth.getUser();
 if(error || !data.user)throw new JourneyError('UNAUTHENTICATED');
 const roles=await session.from('user_roles').select('role').eq('user_id',data.user.id).eq('role','admin');
 if(roles.error || !roles.data?.length)throw new JourneyError('FORBIDDEN');
 return {db:createSupabaseTrustedServerClient(),actor:data.user.id};
}
export async function journeyAccess(request:Request,idValue:string,adminOnly=false) {
 if(!featureEnabled('CARE'))throw new JourneyError('UNAVAILABLE');
 const id=identifier(idValue);
 const db=createSupabaseTrustedServerClient();
 const account=await db.from('care_requests').select('id,customer_id,vehicle_id,service,description,preferred_window,created_at').eq('id',id).maybeSingle();
 if(account.error)throw new JourneyError('UNAVAILABLE');
 let actor:string|null=null;let admin=false;
 const session=await createSupabaseServerClient();const auth=await session.auth.getUser();
 if(!auth.error && auth.data.user) {
   actor=auth.data.user.id;
   const roles=await session.from('user_roles').select('role').eq('user_id',actor);
   if(roles.error)throw new JourneyError('UNAVAILABLE');
   admin=roles.data.some(role=>role.role==='admin');
   if(account.data && !admin && (account.data.customer_id!==actor || !roles.data.some(role=>role.role==='customer')))throw new JourneyError('NOT_FOUND');
 }
 if(adminOnly && !admin)throw new JourneyError(actor ? 'FORBIDDEN' : 'UNAUTHENTICATED');
 if(account.data) {
   if(!actor)throw new JourneyError('UNAUTHENTICATED');
   const vehicle=await db.from('vehicles').select('make,model,year,owner_id').eq('id',account.data.vehicle_id).single();
   if(vehicle.error || vehicle.data.owner_id!==account.data.customer_id)throw new JourneyError('NOT_FOUND');
   return {db,id,actor,admin,guestKey:null,account:actor,kind:'account' as const,source:{service:account.data.service,description:account.data.description,vehicle:`${vehicle.data.make} ${vehicle.data.model} ${vehicle.data.year||''}`.trim(),created_at:account.data.created_at},initialDetails:{} as Record<string,string>};
 }
 const guest=await db.from('care_guest_requests').select('id,idempotency_key,payload,created_at').eq('id',id).maybeSingle();
 if(guest.error)throw new JourneyError('UNAVAILABLE');
 if(!guest.data)throw new JourneyError('NOT_FOUND');
 if(!admin && !verifyGuestCookie(request.headers.get('cookie'),requireSupabaseSecretConfig().secretKey,id,guest.data.idempotency_key))throw new JourneyError('NOT_FOUND');
 const p=guest.data.payload;
 return {db,id,actor:admin ? actor : null,admin,guestKey:admin ? null : guest.data.idempotency_key,account:admin ? actor! : `guest:${id}`,kind:'guest' as const,source:{service:p.service,description:p.description,vehicle:p.vehicle,created_at:guest.data.created_at},initialDetails:{name:p.name,phone:p.phone,suburb:p.suburb,postcode:p.postcode} as Record<string,string>};
}
export type JourneyAccess = Awaited<ReturnType<typeof journeyAccess>>;
function photoPrefix(access:JourneyAccess,completion=false) {return `${completion ? 'care-completion' : access.kind==='guest' ? 'guest-requests' : 'care-requests'}/${access.id}`;}
export async function photoManifest(access:JourneyAccess,completion=false):Promise<ManifestEntry[]> {
 const result=await access.db.storage.from('private-media').download(`${photoPrefix(access,completion)}/manifest.json`);
 if(result.error){if(String(result.error.statusCode)==='404'||result.error.message==='Object not found')return [];throw new JourneyError('UNAVAILABLE');}
 if(result.data.size>4096)throw new JourneyError('UNAVAILABLE');
 let list;try{list=JSON.parse(await result.data.text());}catch{throw new JourneyError('UNAVAILABLE');}
 if(!Array.isArray(list)||list.length<1||list.length>3||list.some((v,i)=>!v||v.slot!==i+1||!['image/jpeg','image/png','image/webp'].includes(v.mime_type)||!Number.isInteger(v.size_bytes)||v.size_bytes<128||v.size_bytes>900000||typeof v.sha256!=='string'||!/^[0-9a-f]{64}$/.test(v.sha256)))throw new JourneyError('UNAVAILABLE');
 return list;
}
export async function journeyPhoto(access:JourneyAccess,slot:number,completion=false) {
 const manifest=await photoManifest(access,completion);const meta=manifest.find(v=>v.slot===slot);if(!meta)throw new JourneyError('NOT_FOUND');
 const result=await access.db.storage.from('private-media').download(`${photoPrefix(access,completion)}/photo-${slot}`);
 if(result.error || !result.data)throw new JourneyError('UNAVAILABLE');
 const bytes=Buffer.from(await result.data.arrayBuffer());
 if(bytes.length!==meta.size_bytes || createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new JourneyError('UNAVAILABLE');
 return {bytes,mime:meta.mime_type};
}
export async function saveJourneyPhotos(access:JourneyAccess,photos:Photo[],completion=false) {
 const journey=await access.db.from('care_journeys').select('state').eq('id',access.id).maybeSingle();
 if(journey.error)throw new JourneyError('UNAVAILABLE');
 if(completion){if(!access.admin)throw new JourneyError('FORBIDDEN');if(journey.data?.state!=='in_progress')throw new JourneyError('INVALID_TRANSITION');}
 else if(journey.data && !['review','quotes_ready'].includes(journey.data.state))throw new JourneyError('INVALID_TRANSITION');
 try{await storeCarePhotos(access.db.storage.from('private-media'),photoPrefix(access,completion),photos);}catch(error){throw new JourneyError(error instanceof Error && 'code' in error ? String(error.code) : 'UNAVAILABLE');}
}
export async function journeySnapshot(access:JourneyAccess) {
 const results=await Promise.all([
  access.db.from('care_journeys').select('state,customer_details,selected_quote_id,starts_at,ends_at,revision,updated_at').eq('id',access.id).maybeSingle(),
  access.db.from('care_reviewed_quotes').select('id,expert_name,expert_description,scope_summary,total_price_cents,currency,status,expires_at,starts_at,ends_at,created_at').eq('journey_id',access.id).order('total_price_cents').limit(50),
  access.db.from('care_journey_events').select('id,type,occurred_at').eq('journey_id',access.id).order('id').limit(100),
 ]);
 if(results.some(r=>r.error))throw new JourneyError('UNAVAILABLE');
 const j=results[0].data; const quotes=results[1].data || [];const now=Date.now();
 const photos=await photoManifest(access);const completion=await photoManifest(access,true);
 return {id:access.id,kind:access.kind,request:access.source,state:j?.state||'review',details:j?.customer_details||access.initialDetails,revision:j?.revision||0,
  quotes:quotes.filter(q=>q.status==='selected'||(q.status==='issued'&&Date.parse(q.expires_at)>now&&Date.parse(q.starts_at)>now)),
  selected_quote_id:j?.selected_quote_id||null,appointment:j?.starts_at ? {starts_at:j.starts_at,ends_at:j.ends_at}:null,
  events:results[2].data||[],photos:photos.map(v=>v.slot),completion_photos:completion.map(v=>v.slot),
  assessment:{mode:'expert_review'},payment:{status:'not_requested'}};
}
export async function journeyCommand(access:JourneyAccess,action:string,key:string,payload:unknown) {
 // Check every declared completion image before the database completion transition.
 if(action==='complete'){const list=await photoManifest(access,true);if(!list.length)throw new JourneyError('EVIDENCE_REQUIRED');await Promise.all(list.map(p=>journeyPhoto(access,p.slot,true)));}
 const {data,error}=await access.db.rpc('care_journey_command',{p_action:action,p_id:access.id,p_actor:access.actor,p_guest_key:access.guestKey,p_key:key,p_payload:payload});
 if(error)throw new JourneyError(error.code==='P0001' ? error.message : 'UNAVAILABLE');
 return data;
}
