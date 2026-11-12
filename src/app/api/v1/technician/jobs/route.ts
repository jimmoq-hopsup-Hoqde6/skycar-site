import {createTechnicianHandlers} from '@/server/technician/http.mjs';
import {readTechnician,readTechnicianPhoto} from '@/server/technician/repository';
export const runtime='nodejs';
export const GET=createTechnicianHandlers({read:readTechnician,photo:readTechnicianPhoto}).list;
