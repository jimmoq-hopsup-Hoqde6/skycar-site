import { randomUUID } from 'node:crypto';
import { GarageError, requireUuid } from '../../domain/garage/vehicles.mjs';
import { readVehiclePhoto } from '../../domain/garage/photo.mjs';

export function createGaragePhotoHandler(getContext) {
  return async function handle(request, id) {
    const requestId = randomUUID();
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
    try {
      const { repository } = await getContext();
      const vehicleId = requireUuid(id);
      const upload = await readVehiclePhoto(request);
      const data = await repository.save(vehicleId, upload, requestId);
      return Response.json({ data, meta: { requestId } }, { status: data.replayed ? 200 : 201, headers });
    } catch (error) {
      const known = error instanceof GarageError;
      return Response.json({ error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'Something went wrong. Please try again.',
        fieldErrors: known ? error.fieldErrors : {},
        retryable: !known || error.status >= 500,
      }, meta: { requestId } }, { status: known ? error.status : 500, headers });
    }
  };
}
