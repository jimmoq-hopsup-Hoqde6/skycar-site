import { randomUUID } from 'node:crypto';
import { GarageError, parseVehicleQuery, publicVehicle, requireUuid, validateVehicleInput } from '../../domain/garage/vehicles.mjs';

async function readWrite(request) {
  const origin = request.headers.get('origin');
  if (origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new GarageError('ORIGIN_REJECTED', 403, 'Reload Skycar and try again from this site.');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new GarageError('UNSUPPORTED_MEDIA_TYPE', 415, 'Send a JSON request.');
  }
  const key = requireUuid(request.headers.get('idempotency-key'), 'idempotencyKey');
  const reader = request.body?.getReader();
  if (!reader) throw new GarageError('INVALID_JSON', 400, 'Provide a JSON body.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new GarageError('PAYLOAD_TOO_LARGE', 413, 'This request is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new GarageError('INVALID_JSON', 400, 'Provide valid JSON.'); }
  return { key, input };
}

// Session + repository are injected so the same HTTP boundary is exercised in tests.
export function createGarageHandler(getContext) {
  return async function handle(request, operation, id) {
    const requestId = randomUUID();
    const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
    try {
      const { repository } = await getContext();
      let data;
      if (operation === 'list') data = await repository.list(parseVehicleQuery(request.url));
      else if (operation === 'get') data = publicVehicle(await repository.get(requireUuid(id)));
      else if (operation === 'history') data = await repository.history(requireUuid(id), parseVehicleQuery(request.url, true));
      else {
        const { key, input } = await readWrite(request);
        const vehicleId = operation === 'create' ? null : requireUuid(id);
        const payload = validateVehicleInput(input, operation);
        data = publicVehicle(await repository.mutate(operation, vehicleId, payload, key, requestId));
      }
      return Response.json({ data, meta: { requestId } }, { status: operation === 'create' ? 201 : 200, headers });
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
