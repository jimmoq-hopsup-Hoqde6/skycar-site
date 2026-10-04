import {journeyAccess,saveJourneyPhotos} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson,boundedBody,JourneyError} from '@/server/care/journey/http';
import {readGuestPhotos} from '@/server/care/guest-photos.mjs';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return journeyBoundary(async()=>{
 const completion=new URL(request.url).searchParams.get('kind')==='completion';
 const access=await journeyAccess(request,(await params).id,completion);
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='multipart/form-data')throw new JourneyError('VALIDATION_FAILED');
 const bytes=await boundedBody(request,2_800_000);
 let photos;
 try {const data=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();if([...data.keys()].some(k=>k!=='photos'))throw new Error();photos=await readGuestPhotos(data.getAll('photos'));if(!photos.length)throw new Error();}catch{throw new JourneyError('VALIDATION_FAILED');}
 await saveJourneyPhotos(access,photos,completion);
 return journeyJson({stored:photos.length},201,access.account);
});}
