import {createTechnicianHandlers} from '@/server/technician/http.mjs';
import {readTechnician,readTechnicianPhoto,technicianCommand} from '@/server/technician/repository';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  return createTechnicianHandlers({read:readTechnician,photo:readTechnicianPhoto}).detail(request,(await params).id);
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  return createTechnicianHandlers({read:readTechnician,photo:readTechnicianPhoto,command:technicianCommand}).command(request,(await params).id);
}
