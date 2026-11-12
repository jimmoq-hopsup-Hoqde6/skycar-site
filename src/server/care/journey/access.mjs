import { createHmac, timingSafeEqual } from 'node:crypto';
export function guestCapability(secret,id,key) { return createHmac('sha256',secret).update(`skycar:guest-access:v1:${id}:${key}`).digest('hex'); }
export function guestCookieName(id) { return `skycar_guest_${id.replaceAll('-','')}`; }
export function guestCookie(secret,id,key,secure=true) {
 return `${guestCookieName(id)}=${guestCapability(secret,id,key)}; Path=/api/v1/care/journey/${id}; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`;
}
export function verifyGuestCookie(header,secret,id,key) {
 const found=(header||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${guestCookieName(id)}=`));
 const value=found?.slice(found.indexOf('=')+1);
 if(!value || !/^[0-9a-f]{64}$/.test(value)) return false;
 return timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(guestCapability(secret,id,key),'hex'));
}
