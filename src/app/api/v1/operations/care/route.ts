import {operationsAccess,journeyAccess,journeyCommand,journeySnapshot} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson,commandBody,identifier,JourneyError} from '@/server/care/journey/http';
export const runtime='nodejs';
export async function GET(request:Request){return journeyBoundary(async()=>{
 const {db,actor}=await operationsAccess();const id=new URL(request.url).searchParams.get('id');
 if(id)return journeyJson(await journeySnapshot(await journeyAccess(request,identifier(id),true)),200,actor);
 const [accounts,guests,journeys,experts]=await Promise.all([
  db.from('care_requests').select('id,service,description,created_at').order('created_at',{ascending:false}).limit(50),
  db.from('care_guest_requests').select('id,payload,created_at').order('created_at',{ascending:false}).limit(50),
  db.from('care_journeys').select('id,state').order('updated_at',{ascending:false}).limit(200),
  db.from('care_experts').select('id,business_name,description,services,postcodes,insurance_valid_until,active').order('business_name').limit(200),
 ]);
 if([accounts,guests,journeys,experts].some(r=>r.error))throw new JourneyError('UNAVAILABLE');
 const states=new Map(journeys.data?.map(j=>[j.id,j.state]));
 const queue=[...(accounts.data||[]).map(r=>({...r,kind:'account',state:states.get(r.id)||'review'})),...(guests.data||[]).map(r=>({id:r.id,service:r.payload.service,description:r.payload.description,created_at:r.created_at,kind:'guest',state:states.get(r.id)||'review'}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));
 return journeyJson({queue,experts:experts.data,integrations:{assessment:'Manual expert review — Ravin API not connected',payments:'Not connected — no customer payments taken',notifications:'In-app updates only'}},200,actor);
});}
export async function POST(request:Request){return journeyBoundary(async()=>{
 const {db,actor}=await operationsAccess();const body=await commandBody(request);const action=String(body.action);
 if(Object.keys(body).some(k=>!['action','id','payload'].includes(k))||!['create_expert','publish_quote','confirm','start','complete','cancel'].includes(action))throw new JourneyError('VALIDATION_FAILED');
 const key=identifier(request.headers.get('idempotency-key'));
 if(action==='create_expert'){
  const result=await db.rpc('care_journey_command',{p_action:action,p_id:null,p_actor:actor,p_guest_key:null,p_key:key,p_payload:body.payload});
  if(result.error)throw new JourneyError(result.error.code==='P0001'?result.error.message:'UNAVAILABLE');
  return journeyJson(result.data,201,actor);
 }
 const access=await journeyAccess(request,identifier(body.id),true);
 return journeyJson(await journeyCommand(access,action,key,body.payload),200,actor);
});}
