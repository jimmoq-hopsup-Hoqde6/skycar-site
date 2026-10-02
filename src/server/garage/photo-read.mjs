import { GarageError, requireUuid } from '../../domain/garage/vehicles.mjs';
import { VEHICLE_PHOTO_MAX_BYTES, VEHICLE_PHOTO_TYPES } from '../../domain/garage/photo.mjs';

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function garagePhotoReader(client, userId) {
  return {
    async read(vehicleId) {
      // Use the session client and RLS for both ownership and Storage reads.
      const vehicle = await client.from('vehicles').select('id').eq('owner_id', userId).eq('id', vehicleId).maybeSingle();
      if (vehicle.error) throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Unable to load this photo. Please try again.');
      if (!vehicle.data) throw new GarageError('NOT_FOUND', 404, 'Vehicle not found.');
      const asset = await client.from('media_assets').select('id,mime_type,size_bytes')
        .eq('vehicle_id', vehicleId).eq('purpose', 'vehicle_original').eq('processing_state', 'stored')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
      if (asset.error) throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Unable to load this photo. Please try again.');
      if (!asset.data) return null;
      const { id, mime_type: mimeType, size_bytes: sizeBytes } = asset.data;
      requireUuid(id);
      if (!VEHICLE_PHOTO_TYPES.includes(mimeType) || sizeBytes > VEHICLE_PHOTO_MAX_BYTES) {
        throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'This photo cannot be previewed.');
      }
      const path = `${userId}/vehicles/${vehicleId}/${id}/original.${extensions[mimeType]}`;
      const stored = await client.storage.from('private-media').download(path);
      if (stored.error || !stored.data || stored.data.size !== Number(sizeBytes)) {
        throw new GarageError('TEMPORARILY_UNAVAILABLE', 503, 'Unable to load this photo. Please try again.');
      }
      return { blob: stored.data, mimeType };
    },
  };
}

export function createGaragePhotoReadHandler(getContext) {
  return async function handle(_request, id) {
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
    try {
      const { repository, userId } = await getContext();
      const photo = await repository.read(requireUuid(id));
      headers['X-Skycar-Account'] = userId;
      if (!photo) return new Response(null, { status: 204, headers });
      return new Response(photo.blob, { headers: { ...headers, 'Content-Type': photo.mimeType } });
    } catch (error) {
      const known = error instanceof GarageError;
      return Response.json({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Unable to load this photo.' } }, { status: known ? error.status : 500, headers });
    }
  };
}
