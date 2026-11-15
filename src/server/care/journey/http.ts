import { isTrustedWriteOrigin } from '../../http/request-origin.mjs';
import { PhotoError } from './photo-service.mjs';
export class JourneyError extends Error { code: string; retryAfter?: number; constructor(code: string, retryAfter?: number) {super(code);this.code=code;this.retryAfter=retryAfter;} }
const errors: Record<string,[number,string]> = {
 UNAUTHENTICATED:[401,'Sign in, or open your guest request in the browser used to submit it.'],
 FORBIDDEN:[403,'An authorised Skycar operations account is required.'],
 NOT_FOUND:[404,'This request is unavailable in this browser or account.'],
 VALIDATION_FAILED:[400,'Check the details, price and appointment times.'],
 CSRF_FAILED:[403,'Submit this action from Skycar.'],
 INVALID_TRANSITION:[409,'This request has changed. Refresh its latest status.'],
 IDEMPOTENCY_CONFLICT:[409,'This command key was used with different details.'],
 QUOTE_EXPIRED:[409,'That quote has expired. Refresh to see current options.'],
 SLOT_UNAVAILABLE:[409,'This expert already has work in that time window. Choose another appointment.'],
 EXPERT_UNAVAILABLE:[409,'The expert’s service area, insurance or availability needs review.'],
 EVIDENCE_REQUIRED:[409,'Upload completion evidence before marking the work complete.'],
 LINK_CONFLICT:[409,'This technician account or expert already has a different link.'],
 // 20261115100000: update_details re-checks the service area with the same codes as submit.
 OUT_OF_AREA:[422,'Skycar does not cover that postcode yet. Your service details were not changed.'],
 COVERAGE_UNAVAILABLE:[503,"We can't check your service area right now. Your service details were not changed. Please try again in a moment."],
 DETAILS_REQUIRED:[409,'The customer must save a service postcode before a technician is invited.'],
 PAYLOAD_TOO_LARGE:[413,'Choose up to three smaller photos.'],
 RATE_LIMITED:[429,'Too many photo uploads. Wait a little, then retry the same photos.'],
 UNAVAILABLE:[503,'We could not confirm the result. Retry the same action safely.'],
};
// Same as submit (src/server/care/http.ts): an unavailable coverage list is a fail-closed answer, not an
// uncertain write, so the client must not keep the key for a blind retry.
const NOT_RETRYABLE=new Set(['COVERAGE_UNAVAILABLE']);
export function journeyJson(data:unknown,status=200,account?:string) {return Response.json({data},{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff',...(account ? {'X-Skycar-Account':account} : {})}});}
export async function journeyBoundary(action:()=>Promise<Response>) {
 try{return await action();}catch(error){
  const known=error instanceof JourneyError || error instanceof PhotoError;
  const code=known && error.code in errors ? error.code : 'UNAVAILABLE';
  const [status,message]=errors[code];
  const retryAfter:Record<string,string>=known && code==='RATE_LIMITED' && Number.isInteger(error.retryAfter) ? {'Retry-After':String(error.retryAfter)} : {};
  return Response.json({error:{code,message,retryable:(status>=500&&!NOT_RETRYABLE.has(code))||status===429}},{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff',...retryAfter}});
 }
}
export async function boundedBody(request:Request,limit=16384) {
 if(!isTrustedWriteOrigin(request)) throw new JourneyError('CSRF_FAILED');
 const reader=request.body?.getReader();if(!reader) throw new JourneyError('VALIDATION_FAILED');
 const chunks:Uint8Array[]=[];let size=0;
 try {while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new JourneyError('PAYLOAD_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
export async function commandBody(request:Request) {
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new JourneyError('VALIDATION_FAILED');
 let value;try{value=JSON.parse((await boundedBody(request)).toString('utf8'));}catch(e){if(e instanceof JourneyError)throw e;throw new JourneyError('VALIDATION_FAILED');}
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new JourneyError('VALIDATION_FAILED');
 return value as Record<string,unknown>;
}
export function identifier(value:unknown):string {if(typeof value!=='string'|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new JourneyError('VALIDATION_FAILED');return value.toLowerCase();}
