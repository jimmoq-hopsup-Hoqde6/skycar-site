import {journeyAccess,journeyPhotoSignedUrl,customerCompletionVisible} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson} from '@/server/care/journey/http';
import {handlePhotoUrl} from '@/server/care/journey/photo-service.mjs';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string;slot:string}>}){return journeyBoundary(async()=>{
 const{id,slot}=await params;
 const result=await handlePhotoUrl(request,id,slot,{access:journeyAccess,completionVisible:customerCompletionVisible,sign:journeyPhotoSignedUrl});
 return journeyJson(result.data,result.status,result.account);
});}
