import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GarageError } from '@/domain/garage/vehicles.mjs';
import { publicVehiclePhoto } from '@/domain/garage/photo.mjs';
import { garageRepository } from './repository';

type Upload = {
  key: string;
  bytes: Buffer;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
};

function temporary(): never {
  throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Your vehicle photo is temporarily unavailable. Please retry the same upload.');
}

function assetId(userId: string, key: string) {
  const hex = createHash('sha256').update(`skycar:vehicle-photo:${userId}:${key}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function replay(row: Record<string, unknown>, upload: Upload, vehicleId: string) {
  if (row.vehicle_id !== vehicleId || row.mime_type !== upload.mimeType || row.size_bytes !== upload.sizeBytes || row.content_sha256 !== upload.sha256) {
    throw new GarageError('IDEMPOTENCY_CONFLICT', 409, 'This upload key was already used for a different vehicle photo.');
  }
  return publicVehiclePhoto({ ...row, original_status: 'stored', display_status: 'unavailable', replayed: true });
}

export function garagePhotoRepository(client: SupabaseClient, userId: string) {
  return {
    async save(vehicleId: string, upload: Upload, requestId: string) {
      const { data: prior, error: priorError } = await client.from('media_assets')
        .select('id,vehicle_id,purpose,mime_type,size_bytes,processing_state,created_at,content_sha256')
        .eq('owner_id', userId).eq('idempotency_key', upload.key).maybeSingle();
      if (priorError) temporary();
      if (prior) return replay(prior, upload, vehicleId);

      const vehicle = await garageRepository(client, userId).get(vehicleId);
      if (vehicle.archived_at) throw new GarageError('VEHICLE_ARCHIVED', 409, 'This vehicle has been archived.');

      const id = assetId(userId, upload.key);
      const objectPath = `${userId}/vehicles/${vehicleId}/${id}/original.${upload.extension}`;
      const bucket = client.storage.from('private-media');
      const stored = await bucket.upload(objectPath, upload.bytes, { contentType: upload.mimeType, upsert: false });
      if (stored.error) {
        const existing = await bucket.download(objectPath);
        if (existing.error || !existing.data) temporary();
        const existingBytes = Buffer.from(await existing.data.arrayBuffer());
        const existingHash = createHash('sha256').update(existingBytes).digest('hex');
        if (existingBytes.byteLength !== upload.sizeBytes || existingHash !== upload.sha256) {
          throw new GarageError('IDEMPOTENCY_CONFLICT', 409, 'This upload key was already used for a different vehicle photo.');
        }
      }

      const { data, error } = await client.rpc('garage_record_vehicle_photo', {
        p_vehicle_id: vehicleId,
        p_asset_id: id,
        p_object_path: objectPath,
        p_mime_type: upload.mimeType,
        p_size_bytes: upload.sizeBytes,
        p_content_sha256: upload.sha256,
        p_key: upload.key,
        p_request_id: requestId || randomUUID(),
      });
      if (error) {
        if (error.message === 'IDEMPOTENCY_CONFLICT') throw new GarageError('IDEMPOTENCY_CONFLICT', 409, 'This upload key was already used for a different vehicle photo.');
        if (error.message === 'NOT_FOUND') throw new GarageError('NOT_FOUND', 404, 'Vehicle not found.');
        if (error.message === 'VEHICLE_ARCHIVED') throw new GarageError('VEHICLE_ARCHIVED', 409, 'This vehicle has been archived.');
        temporary();
      }
      return publicVehiclePhoto(data);
    },
  };
}
