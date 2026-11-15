import {createTechnicianHandlers} from '@/server/technician/http.mjs';
import {readTechnicianCompletionPhoto} from '@/server/technician/repository';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string;slot:string}>}){
 const {id,slot}=await params;return createTechnicianHandlers({completionPhoto:readTechnicianCompletionPhoto}).photo(request,id,slot,true);
}
