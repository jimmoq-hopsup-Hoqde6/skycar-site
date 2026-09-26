import { createHash } from 'node:crypto';
import { isTrustedWriteOrigin } from '../../server/http/request-origin.mjs';
import { GarageError, requireUuid } from './vehicles.mjs';

export const VEHICLE_PHOTO_MAX_BYTES = 10_000_000;
export const VEHICLE_PHOTO_MIN_BYTES = 128;
export const VEHICLE_PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function detectedType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function readVehiclePhoto(request) {
  if (!isTrustedWriteOrigin(request)) {
    throw new GarageError('ORIGIN_REJECTED', 403, 'Reload Skycar and try again from this site.');
  }
  const mimeType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!VEHICLE_PHOTO_TYPES.includes(mimeType)) {
    throw new GarageError('UNSUPPORTED_MEDIA_TYPE', 415, 'Upload a JPEG, PNG or WebP image.');
  }
  const key = requireUuid(request.headers.get('idempotency-key'), 'idempotencyKey');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > VEHICLE_PHOTO_MAX_BYTES)) {
    throw new GarageError('PAYLOAD_TOO_LARGE', 413, 'The vehicle photo must be 10 MB or smaller.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new GarageError('INVALID_IMAGE', 400, 'Choose an image to upload.');
  const chunks = [];
  let sizeBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > VEHICLE_PHOTO_MAX_BYTES) {
        await reader.cancel();
        throw new GarageError('PAYLOAD_TOO_LARGE', 413, 'The vehicle photo must be 10 MB or smaller.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (sizeBytes < VEHICLE_PHOTO_MIN_BYTES) throw new GarageError('INVALID_IMAGE', 400, 'The selected image is incomplete.');
  const bytes = Buffer.concat(chunks);
  if (detectedType(bytes) !== mimeType) throw new GarageError('INVALID_IMAGE', 400, 'The image contents do not match its file type.');
  return {
    key,
    bytes,
    mimeType,
    extension: extensions[mimeType],
    sizeBytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function publicVehiclePhoto(value) {
  if (!value || typeof value !== 'object') throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'The vehicle photo could not be confirmed.');
  const result = {
    id: value.id,
    vehicle_id: value.vehicle_id,
    purpose: value.purpose,
    mime_type: value.mime_type,
    size_bytes: value.size_bytes,
    processing_state: value.processing_state,
    created_at: value.created_at,
    original_status: value.original_status,
    display_status: value.display_status,
    replayed: value.replayed === true,
  };
  if (!result.id || !result.vehicle_id || result.purpose !== 'vehicle_original' || result.processing_state !== 'stored'
      || result.original_status !== 'stored' || result.display_status !== 'unavailable') {
    throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'The vehicle photo could not be confirmed.');
  }
  return result;
}
