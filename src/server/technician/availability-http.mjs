import { isTrustedWriteOrigin } from '../http/request-origin.mjs';
import { ApiFault, API_ROUTE_TEMPLATES, apiResult, withApiBoundary } from '../http/api-boundary.mjs';
import { readAvailabilityCommand, readAvailabilityResult, readAvailabilitySchedule } from '../../domain/technician/availability.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 393216;

export function availabilityFault(code) {
  const errors = {
    UNAUTHENTICATED: [401, 'Sign in with your linked technician account.'],
    FORBIDDEN: [403, 'An active technician role is required.'],
    NOT_FOUND: [404, 'No active linked technician profile is available for this account.'],
    VALIDATION_FAILED: [400, 'Check the Adelaide hours, dates and offsets.'],
    CSRF_FAILED: [403, 'Save these hours from Skycar.'],
    PAYLOAD_TOO_LARGE: [413, 'The schedule is too large.'],
    REVISION_CONFLICT: [409, 'These hours changed after you opened them. Refresh before saving.'],
    IDEMPOTENCY_CONFLICT: [409, 'This save was already used with different hours.'],
  };
  const [status, message] = errors[code] || [503, 'Technician availability could not be verified. Please retry.'];
  return new ApiFault(Object.hasOwn(errors, code) ? code : 'TECHNICIAN_UNAVAILABLE', status, message);
}

function identifier(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw availabilityFault('VALIDATION_FAILED');
  return value.toLowerCase();
}

export function createAvailabilityHandlers(dependencies, options = {}) {
  const boundary = async (request, action) => {
    const response = await withApiBoundary(request, API_ROUTE_TEMPLATES.technicianAvailability, action, options);
    response.headers.set('Vary', 'Cookie');
    return response;
  };
  return {
    read: request => boundary(request, async () => {
      if (new URL(request.url).search) throw availabilityFault('VALIDATION_FAILED');
      const result = await dependencies.read();
      try { identifier(result.account); } catch { throw availabilityFault('UNAVAILABLE'); }
      let data;
      try { data = readAvailabilitySchedule(result.data); } catch { throw availabilityFault('UNAVAILABLE'); }
      return apiResult(data, { headers: { Vary: 'Cookie', 'X-Skycar-Account': result.account } });
    }),
    replace: request => boundary(request, async () => {
      if (new URL(request.url).search) throw availabilityFault('VALIDATION_FAILED');
      const commandKey = identifier(request.headers.get('idempotency-key'));
      const expectedAccount = identifier(request.headers.get('x-skycar-account'));
      if (!isTrustedWriteOrigin(request, options.origin)) throw availabilityFault('CSRF_FAILED');
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw availabilityFault('VALIDATION_FAILED');
      const reader = request.body?.getReader();
      if (!reader) throw availabilityFault('VALIDATION_FAILED');
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY) { await reader.cancel(); throw availabilityFault('PAYLOAD_TOO_LARGE'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let command;
      try {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        command = readAvailabilityCommand(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)), options.now?.() ?? new Date());
      } catch (error) {
        if (error instanceof ApiFault) throw error;
        throw availabilityFault('VALIDATION_FAILED');
      }
      const result = await dependencies.replace(commandKey, command, expectedAccount);
      try { identifier(result.account); } catch { throw availabilityFault('UNAVAILABLE'); }
      if (result.account !== expectedAccount) throw availabilityFault('FORBIDDEN');
      let data;
      try { data = readAvailabilityResult(result.data); } catch { throw availabilityFault('UNAVAILABLE'); }
      return apiResult(data, { headers: { Vary: 'Cookie', 'X-Skycar-Account': result.account } });
    }),
  };
}
