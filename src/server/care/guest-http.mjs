import { GuestError, guestInput, guestKey, guestReceipt } from '../../domain/care/guest.mjs';
import { readGuestPhotos } from './guest-photos.mjs';
import { isTrustedWriteOrigin } from '../http/request-origin.mjs';
const replies = {
  VALIDATION_FAILED: [400,'Check your contact, vehicle and service details.'],
  CSRF_FAILED: [403,'Submit this request from Skycar.'],
  PAYLOAD_TOO_LARGE: [413,'Your photos and details are too large. Choose up to three smaller images.'],
  UNSUPPORTED_MEDIA_TYPE: [415,'Use JSON or a photo upload.'],
  RATE_LIMITED: [429,'Too many requests. Please try again later.'],
  IDEMPOTENCY_CONFLICT: [409,'This request key was already used for different details.'],
  UNAVAILABLE: [503,'Guest requests are temporarily unavailable. Your request has not been confirmed.'],
  CONFIGURATION_UNAVAILABLE: [503,'Service requests are unavailable right now. Nothing was saved. Please try again later.'],
};
export function guestHandler({enabled, save}) {
  return async request => {
    const json = (body,status) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    try {
      if (!enabled()) throw new GuestError('UNAVAILABLE');
      if (!isTrustedWriteOrigin(request)) throw new GuestError('CSRF_FAILED');
      const contentType = request.headers.get('content-type')?.split(';')[0].trim();
      const multipart = contentType === 'multipart/form-data';
      if (!multipart && contentType !== 'application/json') throw new GuestError('UNSUPPORTED_MEDIA_TYPE');
      const reader = request.body?.getReader();
      if (!reader) throw new GuestError('VALIDATION_FAILED');
      let bytes = new Uint8Array();
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          if (bytes.length + value.length > (multipart ? 2_800_000 : 16384)) { await reader.cancel(); throw new GuestError('PAYLOAD_TOO_LARGE'); }
          const next = new Uint8Array(bytes.length + value.length); next.set(bytes); next.set(value,bytes.length); bytes = next;
        }
      } finally { reader.releaseLock(); }
      let input, photos = [];
      try {
        if (multipart) {
          const data = await new Response(bytes, {headers:{'Content-Type':request.headers.get('content-type')}}).formData();
          if ([...data.keys()].some(key => !['details','photos'].includes(key)) || data.getAll('details').length !== 1 || typeof data.get('details') !== 'string') throw new GuestError('VALIDATION_FAILED');
          input = JSON.parse(data.get('details'));
          photos = await readGuestPhotos(data.getAll('photos'));
        } else input = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      }
      catch { throw new GuestError('VALIDATION_FAILED'); }
      const key = guestKey(request.headers.get('idempotency-key'));
      const receipt = guestReceipt(await save(key,guestInput(input),request,photos));
      return json({data:receipt},201);
    } catch(error) {
      const code = error instanceof GuestError && error.code in replies ? error.code : 'UNAVAILABLE';
      const [status,message] = replies[code];
      if (status>=500) console.error(JSON.stringify({event:'guest_request_failed',code}));
      return json({error:{code,message,retryable:status===503 && code!=='CONFIGURATION_UNAVAILABLE'}},status);
    }
  };
}
