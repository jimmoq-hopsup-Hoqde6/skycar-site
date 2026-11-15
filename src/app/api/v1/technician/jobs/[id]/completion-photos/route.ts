import {createTechnicianHandlers} from '@/server/technician/http.mjs';
import {uploadTechnicianCompletion} from '@/server/technician/repository';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 return createTechnicianHandlers({upload:uploadTechnicianCompletion}).upload(request,(await params).id);
}
