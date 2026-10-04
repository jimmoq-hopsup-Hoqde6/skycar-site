import {operationsAccess,journeyAccess,journeyCommand,journeySnapshot} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson,commandBody,identifier,JourneyError} from '@/server/care/journey/http';
export const runtime='nodejs';
export async function GET(request:Request){return journeyBoundary(async()=>{
 const {db,actor}=await operationsAccess();const id=new URL(request.url).searchParams.get('id');
 if(id){
  const key=identifier(id);const access=await journeyAccess(request,key,true);
  const invitations=await db.from('care_technician_invitations').select('expert_id,active').eq('journey_id',key);
  if(invitations.error)throw new JourneyError('UNAVAILABLE');
  return journeyJson({...await journeySnapshot(access),technician_invitations:invitations.data},200,actor);
 }
 const [accounts,guests,experts]=await Promise.all([
  db.from('care_requests').select('id,service,description,created_at').order('created_at',{ascending:false}).limit(50),
  db.from('care_guest_requests').select('id,payload,created_at').order('created_at',{ascending:false}).limit(50),
  db.from('care_experts').select('id,business_name,description,services,postcodes,insurance_valid_until,active').order('business_name').limit(200),
 ]);
 if([accounts,guests,experts].some(r=>r.error))throw new JourneyError('UNAVAILABLE');
 const ids=[...(accounts.data||[]),...(guests.data||[])].map(r=>r.id);
 const journeys=ids.length?await db.from('care_journeys').select('id,state').in('id',ids):{data:[],error:null};
 if(journeys.error)throw new JourneyError('UNAVAILABLE');
 const states=new Map(journeys.data?.map(j=>[j.id,j.state]));
 const queue=[...(accounts.data||[]).map(r=>({...r,kind:'account',state:states.get(r.id)||'review'})),...(guests.data||[]).map(r=>({id:r.id,service:r.payload.service,description:r.payload.description,created_at:r.created_at,kind:'guest',state:states.get(r.id)||'review'}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const links=await db.from('care_technician_accounts').select('expert_id').eq('active',true);
 if(links.error)throw new JourneyError('UNAVAILABLE');
 const linked=new Set(links.data.map(link=>link.expert_id));
 return journeyJson({queue,experts:experts.data?.map(expert=>({...expert,technician_account_linked:linked.has(expert.id)})),integrations:{assessment:'Manual expert review — Ravin API not connected',payments:'Not connected — no customer payments taken',notifications:'In-app updates only'}},200,actor);
});}
export async function POST(request:Request){return journeyBoundary(async()=>{
 const {db,actor}=await operationsAccess();const body=await commandBody(request);const action=String(body.action);
 if(Object.keys(body).some(k=>!['action','id','payload'].includes(k))||!['create_expert','publish_quote','confirm','start','complete','cancel','bind_technician','invite_technician','revoke_technician_invitation'].includes(action))throw new JourneyError('VALIDATION_FAILED');
 const key=identifier(request.headers.get('idempotency-key'));
 if(['bind_technician','invite_technician','revoke_technician_invitation'].includes(action)){
  if(action==='bind_technician'&&Object.hasOwn(body,'id'))throw new JourneyError('VALIDATION_FAILED');
  const result=await db.rpc('care_technician_admin_command',{p_actor:actor,p_key:key,p_action:action,p_id:action==='bind_technician'?null:identifier(body.id),p_payload:body.payload});
  if(result.error)throw new JourneyError(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return journeyJson(result.data,200,actor);
 }
 if(action==='create_expert'){
  const result=await db.rpc('care_journey_command',{p_action:action,p_id:null,p_actor:actor,p_guest_key:null,p_key:key,p_payload:body.payload});
  if(result.error)throw new JourneyError(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return journeyJson(result.data,201,actor);
 }
 const access=await journeyAccess(request,identifier(body.id),true);
 return journeyJson(await journeyCommand(access,action,key,body.payload),200,actor);
});}
