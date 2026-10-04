import {journeyAccess,journeySnapshot,journeyCommand} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson,commandBody,identifier,JourneyError} from '@/server/care/journey/http';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Context){return journeyBoundary(async()=>{const access=await journeyAccess(request,(await params).id);return journeyJson(await journeySnapshot(access),200,access.account);});}
export async function POST(request:Request,{params}:Context){return journeyBoundary(async()=>{
 const access=await journeyAccess(request,(await params).id);const body=await commandBody(request);
 if(Object.keys(body).some(k=>!['action','payload'].includes(k))||!['update_details','select_quote','request_cancel'].includes(String(body.action)))throw new JourneyError('VALIDATION_FAILED');
 return journeyJson(await journeyCommand(access,String(body.action),identifier(request.headers.get('idempotency-key')),body.payload),200,access.account);
});}
