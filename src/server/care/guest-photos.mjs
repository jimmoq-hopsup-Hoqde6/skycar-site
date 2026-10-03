import { createHash } from 'node:crypto';
import { GuestError } from '../../domain/care/guest.mjs';

export const PHOTO_MAX_BYTES = 900_000;
export async function readGuestPhotos(files) {
  if (files.length > 3) throw new GuestError('VALIDATION_FAILED');
  return Promise.all(files.map(async file => {
    if (!(file instanceof File) || file.size < 128 || file.size > PHOTO_MAX_BYTES) throw new GuestError('VALIDATION_FAILED');
    const bytes = Buffer.from(await file.arrayBuffer());
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!((jpeg && file.type === 'image/jpeg') || (png && file.type === 'image/png') || (webp && file.type === 'image/webp'))) throw new GuestError('VALIDATION_FAILED');
    return {bytes, mimeType:file.type, hash:createHash('sha256').update(bytes).digest('hex')};
  }));
}

// Attachments have three immutable slots beneath a server-generated request ID.
// There are no public URLs or guest reads; trusted operations can review them.
async function immutableUpload(bucket, path, photo) {
  const result = await bucket.upload(path, photo.bytes, {contentType:photo.mimeType,upsert:false});
  if (!result.error) return;
  const existing = await bucket.download(path);
  if (existing.error || !existing.data) throw new GuestError('UNAVAILABLE');
  const hash = createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex');
  if (hash !== photo.hash) throw new GuestError('IDEMPOTENCY_CONFLICT');
}
export async function storeCarePhotos(bucket, prefix, photos) {
  if (!photos.length) return;
  const bytes = Buffer.from(JSON.stringify(photos.map((photo,index) => ({slot:index+1,mime_type:photo.mimeType,size_bytes:photo.bytes.length,sha256:photo.hash}))));
  // Write-once manifest binds order, count and content across partial retries.
  await immutableUpload(bucket,`${prefix}/manifest.json`,{bytes,mimeType:'application/json',hash:createHash('sha256').update(bytes).digest('hex')});
  for (const [index, photo] of photos.entries()) {
    await immutableUpload(bucket,`${prefix}/photo-${index + 1}`,photo);
  }
}

export async function storeGuestPhotos(bucket,requestId,photos) {return storeCarePhotos(bucket,`guest-requests/${requestId}`,photos);}
