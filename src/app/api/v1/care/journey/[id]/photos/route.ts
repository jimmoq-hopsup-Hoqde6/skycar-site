import {journeyAccess,saveJourneyPhotos,reserveJourneyPhotoSlot,releaseJourneyPhotoSlot,journeyRecordedPhotoSet} from '@/server/care/journey/repository';
import {journeyBoundary,journeyJson,boundedBody} from '@/server/care/journey/http';
import {handlePhotoUpload} from '@/server/care/journey/photo-service.mjs';
import {readGuestPhotos} from '@/server/care/guest-photos.mjs';
import {isTrustedWriteOrigin} from '@/server/http/request-origin.mjs';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return journeyBoundary(async()=>{
 const result=await handlePhotoUpload(request,(await params).id,{access:journeyAccess,isTrustedWrite:isTrustedWriteOrigin,recordedSet:journeyRecordedPhotoSet,reserveQuota:reserveJourneyPhotoSlot,releaseQuota:releaseJourneyPhotoSlot,readBody:boundedBody,readPhotos:readGuestPhotos,save:saveJourneyPhotos});
 return journeyJson(result.data,result.status,result.account);
});}
