import {journeyAccess,journeyPhoto,customerCompletionVisible} from '@/server/care/journey/repository';
import {journeyBoundary,JourneyError} from '@/server/care/journey/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string;slot:string}>}){return journeyBoundary(async()=>{
 const{id,slot}=await params;if(!/^[1-3]$/.test(slot))throw new JourneyError('NOT_FOUND');
 const access=await journeyAccess(request,id);const completion=new URL(request.url).searchParams.get('kind')==='completion';if(completion)await customerCompletionVisible(access);const photo=await journeyPhoto(access,Number(slot),completion);
 return new Response(new Uint8Array(photo.bytes),{headers:{'Content-Type':photo.mime,'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','X-Skycar-Account':access.account}});
});}
