import {ApiFault,API_ROUTE_TEMPLATES,apiResult,withApiBoundary} from '../http/api-boundary.mjs';
import {readTechnicianInbox,readTechnicianDetail} from '../../domain/technician/inbox.mjs';
export function technicianFault(code) {
  const errors={UNAUTHENTICATED:[401,'Sign in with your invited technician account.'],FORBIDDEN:[403,'An active, linked technician account is required.'],NOT_FOUND:[404,'This job is unavailable to your technician account.'],VALIDATION_FAILED:[400,'Choose a valid technician job.']};
  const [status,message]=errors[code]||[503,'Technician access could not be verified. Please retry.'];
  return new ApiFault(Object.hasOwn(errors,code)?code:'TECHNICIAN_UNAVAILABLE',status,message);
}
function identifier(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw technicianFault('VALIDATION_FAILED');return value.toLowerCase();}
function query(request){if(new URL(request.url).search)throw technicianFault('VALIDATION_FAILED');}
export function createTechnicianHandlers(dependencies,options={}) {
  const boundary=async(request,route,action)=>{const response=await withApiBoundary(request,route,action,options);response.headers.set('Vary','Cookie');return response;};
  const read=(request,id)=>boundary(request,id?API_ROUTE_TEMPLATES.technicianJob:API_ROUTE_TEMPLATES.technicianJobs,async()=>{
    query(request);const key=id===undefined?undefined:identifier(id);const result=await dependencies.read(key);
    try{identifier(result.account);}catch{throw technicianFault('UNAVAILABLE');}
    let data;try{data=key?readTechnicianDetail(result.data,key):readTechnicianInbox(result.data);}catch{throw technicianFault('UNAVAILABLE');}
    return apiResult(data,{headers:{Vary:'Cookie','X-Skycar-Account':result.account}});
  });
  return {
    list:request=>read(request),
    detail:(request,id)=>read(request,id),
    async photo(request,id,slot){
      // Binary replies still recheck the session/link/job before reading private storage.
      try{
        query(request);const key=identifier(id);if(!/^[1-3]$/.test(slot))throw technicianFault('VALIDATION_FAILED');
        const result=await dependencies.photo(key,Number(slot));try{identifier(result.account);}catch{throw technicianFault('UNAVAILABLE');}
        if(!['image/jpeg','image/png','image/webp'].includes(result.mime)||!result.bytes||result.bytes.byteLength<128||result.bytes.byteLength>900000)throw technicianFault('UNAVAILABLE');
        return new Response(result.bytes,{headers:{'Content-Type':result.mime,'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff','X-Skycar-Account':result.account}});
      }catch(error){return boundary(request,API_ROUTE_TEMPLATES.technicianJobPhoto,()=>{throw error;});}
    },
  };
}
