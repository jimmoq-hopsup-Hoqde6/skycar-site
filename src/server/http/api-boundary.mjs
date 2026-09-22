import { randomUUID } from 'node:crypto';

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_RESULT = Symbol('skycar.api-result');

// Route values written to application logs must come from this reviewed registry.
// Never add a concrete customer, vehicle, job or request identifier here.
export const API_ROUTE_TEMPLATES = Object.freeze({
  health: '/api/v1/health',
  garageVehiclePhoto: '/api/v1/garage/vehicles/[vehicleId]/photo',
  careRequestOffers: '/api/v1/care/requests/[requestId]/offers',
});

const REGISTERED_ROUTE_TEMPLATES = new Set(Object.values(API_ROUTE_TEMPLATES));

function boundedFieldErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([field, message]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field) || typeof message !== 'string') return [];
    return [[field, message.slice(0, 240)]];
  }).slice(0, 32));
}

export class ApiFault extends Error {
  constructor(code, status, message, options = {}) {
    if (!CODE_PATTERN.test(code)
      || !Number.isInteger(status) || status < 400 || status > 599
      || typeof message !== 'string' || message.length < 1 || message.length > 240) {
      throw new TypeError('Invalid public API fault.');
    }
    super(message);
    this.name = 'ApiFault';
    this.code = code;
    this.status = status;
    this.fieldErrors = boundedFieldErrors(options.fieldErrors);
    this.retryable = typeof options.retryable === 'boolean' ? options.retryable : this.status >= 500;
  }
}

export function apiResult(data, options = {}) {
  const status = options.status ?? 200;
  if (!Number.isInteger(status) || status < 200 || status > 299) throw new TypeError('Invalid API success status.');
  return { [API_RESULT]: true, data, status, headers: options.headers };
}

function responseHeaders(requestId, supplied = {}) {
  const headers = new Headers(supplied);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Request-Id', requestId);
  return headers;
}

function json(body, status, requestId, headers) {
  return Response.json(body, { status, headers: responseHeaders(requestId, headers) });
}

function writeLog(logger, level, entry) {
  try {
    logger[level](JSON.stringify(entry));
  } catch {
    // Telemetry must not change the API result.
  }
}

function assertRouteTemplate(route) {
  if (!REGISTERED_ROUTE_TEMPLATES.has(route)) {
    throw new Error('API route logging requires a registered static route template.');
  }
  return route;
}

/**
 * Execute one API route with the shared Skycar response and observability contract.
 * The log schema is intentionally allow-listed: never pass request headers, URLs,
 * bodies, actor identifiers or caught error messages into it.
 */
export async function withApiBoundary(request, route, handler, options = {}) {
  const candidateRequestId = (options.makeRequestId ?? randomUUID)();
  const requestId = UUID_PATTERN.test(candidateRequestId) ? candidateRequestId : randomUUID();
  const startedAt = (options.now ?? Date.now)();
  const routeTemplate = assertRouteTemplate(route);
  const logger = options.logger ?? console;
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let retryable = true;

  try {
    const result = await handler({ requestId });
    const response = result?.[API_RESULT] === true ? result : apiResult(result);
    const data = response.data ?? null;
    status = response.status;
    code = 'OK';
    retryable = false;
    return json({ data, meta: { requestId } }, status, requestId, response.headers);
  } catch (error) {
    const fault = error instanceof ApiFault
      ? error
      : new ApiFault('INTERNAL_ERROR', 500, 'Something went wrong. Please try again.', { retryable: true });
    status = fault.status;
    code = fault.code;
    retryable = fault.retryable;
    return json({
      error: {
        code: fault.code,
        message: fault.message,
        fieldErrors: fault.fieldErrors,
        retryable: fault.retryable,
      },
      meta: { requestId },
    }, fault.status, requestId);
  } finally {
    const completedAt = (options.now ?? Date.now)();
    const entry = {
      event: 'api_request_completed',
      requestId,
      method: /^[A-Z]{1,16}$/.test(request.method) ? request.method : 'UNKNOWN',
      route: routeTemplate,
      status,
      code,
      retryable,
      durationMs: Math.max(0, completedAt - startedAt),
    };
    writeLog(logger, status >= 500 ? 'error' : 'info', entry);
  }
}
