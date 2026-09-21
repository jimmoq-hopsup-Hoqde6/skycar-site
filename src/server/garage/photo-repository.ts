import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GarageError } from '../../domain/garage/vehicles.mjs';
import { publicVehiclePhoto } from '../../domain/garage/photo.mjs';

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

function databaseError(error: { message?: string } | null): never {
  if (error?.message?.includes('IDEMPOTENCY_CONFLICT')) {
    throw new GarageError('IDEMPOTENCY_CONFLICT', 409, 'This upload key was already used for a different vehicle photo.');
  }
  if (error?.message?.includes('VEHICLE_ARCHIVED')) {
    throw new GarageError('VEHICLE_ARCHIVED', 409, 'This vehicle has been archived.');
  }
  if (error?.message?.includes('NOT_FOUND')) {
    throw new GarageError('NOT_FOUND', 404, 'Vehicle not found.');
  }
  temporary();
}

async function quarantine(client: SupabaseClient, userId: string, key: string) {
  await client.rpc('garage_fail_vehicle_photo', { p_actor: userId, p_key: key });
}

export function garagePhotoRepository(client: SupabaseClient, userId: string) {
  return {
    async save(vehicleId: string, upload: Upload, requestId: string) {
      const id = assetId(userId, upload.key);
      const objectPath = `${userId}/vehicles/${vehicleId}/${id}/original.${upload.extension}`;
      const { data: reservation, error: reserveError } = await client.rpc('garage_reserve_vehicle_photo', {
        p_actor: userId,
        p_vehicle_id: vehicleId,
        p_asset_id: id,
        p_object_path: objectPath,
        p_mime_type: upload.mimeType,
        p_size_bytes: upload.sizeBytes,
        p_content_sha256: upload.sha256,
        p_key: upload.key,
      });
      if (reserveError) databaseError(reserveError);
      if (reservation?.processing_state === 'stored') {
        return publicVehiclePhoto({
          ...reservation,
          original_status: 'stored',
          display_status: 'unavailable',
          replayed: true,
        });
      }
      if (!reservation || reservation.processing_state !== 'uploading') temporary();

      const bucket = client.storage.from('private-media');
      const stored = await bucket.upload(objectPath, upload.bytes, { contentType: upload.mimeType, upsert: false });
      if (stored.error) {
        const existing = await bucket.download(objectPath);
        if (existing.error || !existing.data) {
          await quarantine(client, userId, upload.key);
          temporary();
        }
        const existingBytes = Buffer.from(await existing.data.arrayBuffer());
        const existingHash = createHash('sha256').update(existingBytes).digest('hex');
        if (existingBytes.byteLength !== upload.sizeBytes || existingHash !== upload.sha256) {
          await quarantine(client, userId, upload.key);
          throw new GarageError('IDEMPOTENCY_CONFLICT', 409, 'This upload key was already used for a different vehicle photo.');
        }
      }

      const { data, error } = await client.rpc('garage_finalize_vehicle_photo', {
        p_actor: userId,
        p_key: upload.key,
        p_request_id: requestId || randomUUID(),
      });
      // On an uncertain database result the durable uploading reservation and
      // deterministic object path are retained. An exact retry reconciles them;
      // deleting here could race another successful finalizer.
      if (error) databaseError(error);
      return publicVehiclePhoto(data);
    },
  };
}
